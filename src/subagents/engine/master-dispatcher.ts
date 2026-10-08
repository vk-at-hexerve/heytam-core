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
import { extractPhoneNumbers, normalizePhone } from '../utils/phone-parser.js';
import { google } from 'googleapis';
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
  const registeredBizEmail = tenantKeys.businessEmail || tenantKeys.smtpUser || 'shivamawasthi1129@gmail.com';
  const wantsMyEmail = /my\s+email|to\s+me|send\s+it\s+to\s+my|send\s+to\s+my/i.test(prompt);

  // 1. Recipient email — check explicit 'to/send to' patterns first, then triggerData, then non-owner emails
  const explicitToMatch = prompt.match(/(?:to\s+(?:this\s+)?email|send\s+to|recipient|client|customer|to\s*[:–\-])\s*[:–\-]?\s*["']?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})["']?/i);
  const myEmailMatch = prompt.match(/my\s+email\s+is\s*["']?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})["']?/i);
  const allEmails = [...prompt.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)]
    .map(m => m[0]);

  let recipientEmail: string | null = null;
  if (wantsMyEmail) {
    recipientEmail = registeredBizEmail;
  } else if (explicitToMatch?.[1]) {
    recipientEmail = explicitToMatch[1];
  } else if (triggerData?.recipientEmail) {
    recipientEmail = triggerData.recipientEmail;
  } else {
    const nonSender = allEmails.filter(e => e.toLowerCase() !== senderEmail && (!myEmailMatch || e.toLowerCase() !== myEmailMatch[1].toLowerCase()));
    recipientEmail = nonSender[0] || (myEmailMatch ? myEmailMatch[1] : allEmails[0]) || null;
  }
  const userCalendarEmail = myEmailMatch?.[1] || (wantsMyEmail ? registeredBizEmail : null);

  // 2. Recipient Name
  const nameMatch = prompt.match(/(?:hi|hello|dear|name\s*[:–\-])\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
  let recipientName = triggerData?.recipientName 
    || nameMatch?.[1]?.trim() 
    || (recipientEmail ? recipientEmail.split('@')[0] : null);

  // 3. Subject line — check triggerData, then search prompt
  const subjectMatch = prompt.match(/subject\s*[:–\-]\s*(.+?)(?:\n|\s*,?\s*(?:email|body|message)\s*[:–\-]|,\s*and|$)/i);
  const subjectLine = triggerData?.subject || subjectMatch?.[1]?.trim() || null;

  // 4. Email body — ONLY set if explicitly pre-written in triggerData or explicitly quoted in prompt
  const quotedBodyMatch = prompt.match(/(?:body|message|content)\s*[:–\-]\s*["']([\s\S]+?)["']/i);
  const hasCustomMessage = triggerData?.message && triggerData.message !== 'Hi from HeyTam — your AI workforce.';
  const emailBody = hasCustomMessage
    ? triggerData.message
    : (quotedBodyMatch?.[1]?.trim() || null);

  // 5. Phone numbers (with international E.164 and multiple phone support)
  const allExtractedPhones = extractPhoneNumbers(prompt, tenantKeys?.twilioFromPhone);
  const triggerPhones = (triggerData?.recipientPhones && Array.isArray(triggerData.recipientPhones))
    ? triggerData.recipientPhones
    : (triggerData?.recipientPhone ? [triggerData.recipientPhone] : []);
  const combinedPhones = Array.from(new Set([...allExtractedPhones, ...triggerPhones]));
  let primaryPhone = combinedPhones[0] || null;

  // 6. Live Google Sheet / Spreadsheet Ingestion
  let rawSheetSource = prompt.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\s\n"'>]+/)?.[0]
    || triggerData?.googleSheetId
    || tenantKeys?.googleSheetId;

  let sheetId: string | null = null;
  let sheetGid: string | null = null;
  let sheetCsvData: string | null = null;
  let sheetUrl: string | null = null;
  let clientEmail: string | null = null;

  if (rawSheetSource) {
    const rawTrimmed = String(rawSheetSource).trim();
    const idMatch = rawTrimmed.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i);
    sheetId = idMatch ? idMatch[1] : (rawTrimmed.startsWith('http') ? null : rawTrimmed);
    const gidMatch = rawTrimmed.match(/[?&#]gid=([0-9]+)/i);
    sheetGid = gidMatch ? gidMatch[1] : null;

    if (sheetId) {
      sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}${sheetGid ? `?gid=${sheetGid}` : ''}`;

      // 1. Try Google Sheets API with OAuth if available
      if (tenantKeys?.googleRefreshToken || tenantKeys?.googleAccessToken) {
        try {
          const oauth2Client = new google.auth.OAuth2(
            tenantKeys.googleClientId || process.env.GOOGLE_CLIENT_ID,
            tenantKeys.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET
          );
          oauth2Client.setCredentials({
            refresh_token: tenantKeys.googleRefreshToken,
            access_token: tenantKeys.googleAccessToken,
          });
          const sheetsApi = google.sheets({ version: 'v4', auth: oauth2Client });
          const range = tenantKeys.googleSheetRange || 'Sheet1!A1:Z100';
          const { data } = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range,
          });
          if (data.values && data.values.length > 0) {
            const maxRows = Number(tenantKeys.maxLeadsPerRun) || 50;
            sheetCsvData = data.values
              .slice(0, maxRows)
              .map((row: any[]) => row.map((cell: any) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
              .join('\n');
            console.log(`[Dispatcher] ✅ Successfully fetched ${data.values.length} rows via Google Sheets API v4.`);
          }
        } catch (apiErr: any) {
          console.warn('[Dispatcher] ⚠️ Google Sheets API fetch failed, trying public CSV export:', apiErr.message);
        }
      }

      // 2. Fall back to public CSV export if not already loaded
      if (!sheetCsvData) {
        try {
          const csvUrl = sheetGid
            ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetGid}`
            : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
          console.log(`[Dispatcher] 📊 Fetching spreadsheet data from: ${csvUrl}`);
          const resp = await fetch(csvUrl, { redirect: 'follow' });
          if (resp.ok) {
            sheetCsvData = await resp.text();
            console.log(`[Dispatcher] ✅ Successfully fetched ${sheetCsvData.length} bytes of live spreadsheet data.`);
          } else {
            console.warn(`[Dispatcher] ⚠️ Google Sheet CSV export returned status ${resp.status}`);
          }
        } catch (sheetErr) {
          console.error('[Dispatcher] ❌ Error fetching Google Sheet CSV:', sheetErr);
        }
      }
    }
  }

  // 7. Resolve specific lead data from loaded Google Sheet (e.g. Abhishek Sharma)
  if (sheetCsvData) {
    const leadQueryMatch = prompt.match(/(?:lead\s+of|lead\s+for|lead\s+named?|person|contact|client)\s+([A-Za-z\s]+?)(?:and|\s+then|\s+on|\s+to|,|\.|$)/i);
    const leadQuery = leadQueryMatch ? leadQueryMatch[1].trim().toLowerCase() : null;
    const queryTokens = leadQuery ? leadQuery.split(/\s+/).filter(w => w.length >= 3) : [];

    const parseCsvLine = (line: string): string[] => {
      const res: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === ',' && !inQuotes) { res.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      res.push(cur.trim());
      return res;
    };

    const lines = sheetCsvData.split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) {
      const headers = parseCsvLine(lines[0]);
      const getVal = (vals: string[], colNames: string[]): string => {
        for (const name of colNames) {
          const idx = headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
          if (idx !== -1 && vals[idx]) return vals[idx].replace(/^"|"$/g, '').trim();
        }
        return '';
      };

      let matchedVals: string[] | null = null;
      if (queryTokens.length > 0) {
        for (let i = 1; i < lines.length; i++) {
          const vals = parseCsvLine(lines[i]);
          const rowText = vals.join(' ').toLowerCase();
          // Match if all search tokens (or the full query) appear in this row
          if (queryTokens.every(tok => rowText.includes(tok)) || (leadQuery && rowText.includes(leadQuery))) {
            matchedVals = vals;
            break;
          }
        }
      } else if (!primaryPhone) {
        matchedVals = parseCsvLine(lines[1]);
      }

      if (matchedVals) {
        const foundFirst = getVal(matchedVals, ['First Name']);
        const foundLast = getVal(matchedVals, ['Last Name']);
        const foundName = `${foundFirst} ${foundLast}`.trim() || getVal(matchedVals, ['Name', 'Client', 'Patient']);
        const foundEmail = getVal(matchedVals, ['Email']);
        const foundPhone = getVal(matchedVals, ['Phone Number', 'Phone', 'Mobile']);

        if (foundName && (!recipientName || recipientName === 'User' || recipientName.includes('@'))) {
          recipientName = foundName;
        }
        if (foundEmail) {
          clientEmail = foundEmail;
          if (!recipientEmail || wantsMyEmail) {
            // Keep both
            recipientEmail = wantsMyEmail ? registeredBizEmail : foundEmail;
          }
        }
        if (foundPhone) {
          const norm = normalizePhone(foundPhone);
          if (norm) {
            primaryPhone = norm;
            if (!combinedPhones.includes(norm)) {
              combinedPhones.unshift(norm);
            }
          }
        }
        console.log(`[Dispatcher] 🎯 Resolved lead from sheet: Name="${foundName}", Phone="${foundPhone}", Email="${foundEmail}"`);
      }
    }
  }

  // Build an explicit intent block that will survive PHI scrubbing
  const intentBlock = [
    recipientEmail      ? `RECIPIENT_EMAIL: ${recipientEmail}` : '',
    clientEmail         ? `CLIENT_EMAIL: ${clientEmail}` : '',
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
      twilioVoice: tenantKeys?.twilioVoice,
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
      const chainContext = [
        out.messageToUser,
        out.capturedData ? `Captured Data: ${JSON.stringify(out.capturedData)}` : null,
      ].filter(Boolean).join('\n');
      previousOutput = chainContext;
    } else {
      previousOutput = String(result.output);
    }
  }

  // Build clean, professional user-facing summary
  const lastStep = completedSteps[completedSteps.length - 1];
  let cleanUserMessage = '';
  if (lastStep?.result?.output && typeof lastStep.result.output === 'object') {
    cleanUserMessage = (lastStep.result.output as any).messageToUser || '';
  } else if (lastStep?.result?.output) {
    cleanUserMessage = String(lastStep.result.output);
  }

  const allActions = completedSteps.flatMap(s => s.result?.actionsExecuted || []);
  const distinctActions = Array.from(new Set(allActions.filter(a => a && !a.startsWith('REAL: HeyTam Core Supervisor'))));

  let finalPresentation = cleanUserMessage;
  if (distinctActions.length > 0) {
    finalPresentation = `${cleanUserMessage}\n\nExecution Status:\n` + distinctActions.map(a => `• ${a}`).join('\n');
  }

  // Restore PHI in final output
  const restoredFinal = await phiVault.restore(finalPresentation || previousOutput, sessionId);

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
