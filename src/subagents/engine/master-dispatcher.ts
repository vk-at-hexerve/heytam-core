/**
 * Subagent Master Dispatcher
 * Wraps all 30 slave agents and executes multi-step workflows.
 *
 * STRICT MODE: Every step is credential-checked BEFORE execution.
 * If any required credential is missing → the workflow is BLOCKED immediately.
 * No fake simulations, no wasted LLM calls, no nonsense output.
 */
import { executeSubagent } from './agent-runner.js';
import { suggestWorkflow, type SuggestedWorkflow } from './workflow-suggester.js';
import { AGENT_REGISTRY, getAgentMeta } from './agent-registry.js';
import { checkAgentCredentials } from './credential-checker.js';
import { PhiTokenVault } from '../../mastra/utils/phi-scrubber.js';
import { normalizeTenantId, assertTenantAccess } from '../../mastra/utils/tenant-access.js';
import type { TenantKeys, AgentResult } from '../schema.js';
import { extractPhoneNumbers } from '../utils/phone-parser.js';
import crypto from 'crypto';

export interface DispatchOptions {
  prompt: string;
  tenantId?: string;
  tenantContext?: string;
  tenantKeys?: TenantKeys;
  overrideWorkflow?: SuggestedWorkflow;
  triggerData?: Record<string, any>;
  subscribedToolIds?: string[] | Set<string>;
  allAgentsSubscribed?: boolean;
  plan?: string;
}

export interface WorkflowRunStep {
  order: number;
  agentId: string;
  agentName: string;
  result: AgentResult;
  durationMs: number;
}

export interface OrchestratorRunResult {
  runId: string;
  tenantId?: string;
  workflow: SuggestedWorkflow;
  steps: WorkflowRunStep[];
  finalOutput: string;
  status: 'completed' | 'failed' | 'blocked';
  timestamp: string;
  phiSessionId?: string;
  blockedAt?: {
    stepOrder: number;
    agentId: string;
    agentName: string;
    missingCredentials: Array<{ label: string; purpose: string; configPath: string; requiredFields: string[] }>;
  };
}

const phiVault = new PhiTokenVault();

/**
 * Main dispatch entry point.
 *
 * Flow:
 * 1. PHI-scrub the prompt
 * 2. Suggest or use the provided workflow
 * 3. PRE-FLIGHT: Check credentials for EVERY step before running any
 *    → If any step is missing credentials: BLOCK immediately, return clear error
 * 4. Execute each step sequentially (real actions only)
 * 5. Return structured results with trace
 */
export async function dispatchWorkflow(options: DispatchOptions): Promise<OrchestratorRunResult> {
  const { prompt, tenantId, tenantContext = 'HeyTam AI Workforce', tenantKeys = {}, overrideWorkflow, triggerData } = options;
  const timestamp = new Date().toISOString();
  const runId = crypto.randomUUID();

  // Tenant validation
  const safeTenantId = normalizeTenantId(tenantId);
  if (safeTenantId) {
    assertTenantAccess(safeTenantId);
  }

  // ─── Extract structured intent from ORIGINAL prompt + triggerData BEFORE PHI scrubbing ─────
  // The PHI scrubber replaces emails, phone numbers, and names with tokens.
  // We must extract this data first and explicitly re-inject it into the agent input.
  const senderEmail = (tenantKeys.smtpUser || '').toLowerCase();

  // 1. Recipient email — check explicit 'to/send to' patterns first, then triggerData, then non-owner emails
  const explicitToMatch = prompt.match(/(?:to\s+(?:this\s+)?email|send\s+to|recipient|client|customer|to\s*[:–\-])\s*[:–\-]?\s*["']?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})["']?/i);
  const myEmailMatch = prompt.match(/my\s+email\s+is\s*["']?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})["']?/i);
  const allEmails = [...prompt.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)]
    .map(m => m[0])
    .filter(e => e.toLowerCase() !== senderEmail && (!myEmailMatch || e.toLowerCase() !== myEmailMatch[1].toLowerCase()));

  const recipientEmail = explicitToMatch?.[1] ||
    ((triggerData?.recipientEmail && triggerData.recipientEmail.toLowerCase() !== senderEmail)
      ? triggerData.recipientEmail
      : (allEmails[0] || null));
  const userCalendarEmail = myEmailMatch?.[1] || null;

  // 2. Recipient Name
  const nameMatch = prompt.match(/(?:hi|hello|dear|name\s*[:–\-])\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
  const recipientName = triggerData?.recipientName 
    || nameMatch?.[1]?.trim() 
    || (recipientEmail ? recipientEmail.split('@')[0] : null);

  // 3. Subject line — check triggerData, then search prompt
  const subjectMatch = prompt.match(/subject\s*[:–\-]\s*(.+?)(?:\n|\s*,?\s*(?:email|body|message)\s*[:–\-]|,\s*and|$)/i);
  const subjectLine = triggerData?.subject || subjectMatch?.[1]?.trim() || null;

  // 4. Email body — check triggerData, then search prompt
  const bodyMatch = prompt.match(/(?:email|body|message)\s*[:–\-]\s*([\s\S]+?)(?:\s+and\s+set|\s+set\s+the|===|$)/i);
  const hasCustomMessage = triggerData?.message && triggerData.message !== 'Hi from HeyTam — your AI workforce.';
  const emailBody = hasCustomMessage
    ? triggerData.message
    : (bodyMatch?.[1]?.trim() || triggerData?.notes || null);

  // 5. Phone numbers (with international E.164 and multiple phone support)
  const allExtractedPhones = extractPhoneNumbers(prompt, tenantKeys?.twilioFromPhone);
  const triggerPhones = (triggerData?.recipientPhones && Array.isArray(triggerData.recipientPhones))
    ? triggerData.recipientPhones
    : (triggerData?.recipientPhone ? [triggerData.recipientPhone] : []);
  const combinedPhones = Array.from(new Set([...allExtractedPhones, ...triggerPhones]));
  const primaryPhone = combinedPhones[0] || null;

  // 6. Live Google Sheet / Spreadsheet Ingestion
  const sheetMatch = prompt.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  let sheetCsvData: string | null = null;
  let sheetUrl: string | null = null;
  if (sheetMatch) {
    sheetUrl = sheetMatch[0];
    const sheetId = sheetMatch[1];
    try {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      console.log(`[Dispatcher] 📊 Detected Google Sheet. Fetching live data from: ${csvUrl}`);
      const resp = await fetch(csvUrl, { redirect: 'follow' });
      if (resp.ok) {
        sheetCsvData = await resp.text();
        console.log(`[Dispatcher] ✅ Successfully fetched ${sheetCsvData.length} bytes of live spreadsheet data.`);
      } else {
        console.warn(`[Dispatcher] ⚠️ Google Sheet fetch returned status ${resp.status}`);
      }
    } catch (sheetErr) {
      console.error('[Dispatcher] ❌ Error fetching Google Sheet CSV:', sheetErr);
    }
  }

  // Build an explicit intent block that will survive PHI scrubbing
  const intentBlock = [
    recipientEmail      ? `RECIPIENT_EMAIL: ${recipientEmail}` : '',
    userCalendarEmail   ? `CALENDAR_OWNER_EMAIL: ${userCalendarEmail}` : '',
    recipientName       ? `RECIPIENT_NAME: ${recipientName}` : '',
    combinedPhones.length > 1 ? `RECIPIENT_PHONES: ${combinedPhones.join(', ')}` : '',
    primaryPhone        ? `RECIPIENT_PHONE: ${primaryPhone}` : '',
    subjectLine         ? `EMAIL_SUBJECT: ${subjectLine}` : '',
    emailBody           ? `EMAIL_BODY: ${emailBody}` : '',
    sheetUrl            ? `GOOGLE_SHEET_URL: ${sheetUrl}` : '',
    sheetCsvData        ? `GOOGLE_SHEET_DATA:\n${sheetCsvData}` : '',
  ].filter(Boolean).join('\n');

  // ─── PHI scrubbing (runs on the prompt, not the intent block) ─────────────────
  const { scrubbedText, sessionId } = await phiVault.scrubAndStore(prompt);

  // Rebuild input: explicit intent block + scrubbed prompt
  // The intent block is NOT scrubbed — it carries the raw recipient data the agents need
  const enrichedInput = intentBlock
    ? `=== EXTRACTED TASK PARAMETERS ===\n${intentBlock}\n=== USER REQUEST ===\n${scrubbedText}`
    : scrubbedText;

  // Resolve workflow (subscription-aware)
  const workflow = (overrideWorkflow && Array.isArray(overrideWorkflow.steps) && overrideWorkflow.steps.length > 0)
    ? overrideWorkflow
    : suggestWorkflow(enrichedInput, {
        subscribedToolIds: options.subscribedToolIds,
        allAgentsSubscribed: options.allAgentsSubscribed,
        plan: options.plan,
      });


  // ─── PRE-FLIGHT CREDENTIAL CHECK ────────────────────────────────────────────
  // Check ALL steps BEFORE running a single one.
  // If any step requires credentials that are not configured → BLOCK the entire run.
  for (const step of workflow.steps) {
    const credCheck = checkAgentCredentials(step.agentId, tenantKeys);
    if (!credCheck.ready) {
      const agentName = step.agentName || step.agentId;
      const blockMessage = credCheck.blockMessage!;
      console.warn(`[Dispatcher] ⛔ BLOCKED Step ${step.order} (${agentName}): credentials missing.`);

      return {
        runId,
        tenantId: safeTenantId,
        workflow,
        steps: [],
        finalOutput: blockMessage,
        status: 'blocked',
        timestamp,
        phiSessionId: sessionId,
        blockedAt: {
          stepOrder: step.order,
          agentId: step.agentId,
          agentName,
          missingCredentials: credCheck.missingCredentials,
        },
      };
    }
  }
  // ─── END PRE-FLIGHT ──────────────────────────────────────────────────────────

  const completedSteps: WorkflowRunStep[] = [];
  let previousOutput = enrichedInput;
  let finalStatus: 'completed' | 'failed' = 'completed';

  // Execute each step sequentially
  for (const step of workflow.steps) {
    const stepStart = Date.now();
    const currentInput = completedSteps.length === 0
      ? enrichedInput
      : `=== EXTRACTED TASK PARAMETERS ===\n${intentBlock}\n=== ORIGINAL REQUEST ===\n${scrubbedText}\n\n=== PREVIOUS AGENT OUTPUT (${completedSteps[completedSteps.length - 1].agentName}) ===\n${previousOutput}`;

    const result = await executeSubagent({
      agentId: step.agentId,
      agentName: step.agentName,
      input: currentInput,
      tenantContext,
      tenantKeys,
      tenantId: safeTenantId,
      runId,
      stepOrder: step.order,
    });

    const durationMs = Date.now() - stepStart;

    completedSteps.push({ ...step, result, durationMs });

    if (result.status === 'error') {
      finalStatus = 'failed';
      break;
    }

    // Chain output to next step
    if (typeof result.output === 'object' && result.output !== null) {
      const out = result.output as any;
      const details = [
        out.messageToUser,
        out.capturedData ? `Captured Data: ${JSON.stringify(out.capturedData)}` : null,
        out.chainOfThought ? `Analysis: ${out.chainOfThought}` : null,
      ].filter(Boolean).join('\n');
      previousOutput = details;
    } else {
      previousOutput = String(result.output);
    }
  }

  // Restore PHI in final output
  const restoredFinal = await phiVault.restore(previousOutput, sessionId);

  return {
    runId,
    tenantId: safeTenantId,
    workflow,
    steps: completedSteps,
    finalOutput: restoredFinal,
    status: finalStatus,
    timestamp,
    phiSessionId: sessionId,
  };
}

/**
 * Execute a single slave agent directly.
 * Also runs credential pre-flight before executing.
 */
export async function dispatchSingleAgent(
  agentId: string,
  prompt: string,
  tenantId?: string,
  tenantContext?: string,
  tenantKeys?: TenantKeys
): Promise<AgentResult> {
  const safeTenantId = normalizeTenantId(tenantId);
  if (safeTenantId) assertTenantAccess(safeTenantId);

  const keys = tenantKeys || {};
  const credCheck = checkAgentCredentials(agentId, keys);
  if (!credCheck.ready) {
    return {
      agentName: agentId,
      agentRole: agentId,
      input: prompt,
      output: credCheck.blockMessage || 'Credentials not configured.',
      status: 'error',
      timestamp: new Date().toISOString(),
      tenantId: safeTenantId,
      actionsExecuted: [`BLOCKED: ${credCheck.blockMessage}`],
    };
  }

  const meta = getAgentMeta(agentId);
  return executeSubagent({
    agentId,
    agentName: meta?.name ?? agentId,
    input: prompt,
    tenantContext: tenantContext || 'HeyTam AI Workforce',
    tenantKeys: keys,
    tenantId: safeTenantId,
  });
}

/**
 * Returns all agents in the registry.
 */
export function getAgentCatalog() {
  return AGENT_REGISTRY;
}
