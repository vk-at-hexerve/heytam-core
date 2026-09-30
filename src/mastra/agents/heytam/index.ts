/**
 * HeyTam Supervisor Agent — Mastra AI (heytam-core)
 * 
 * The supervisor delegates to all 30 slave subagents natively (no HTTP).
 * All delegation tools call the internal master-dispatcher directly.
 */
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getAgentModel } from '../../utils/model-provider.js';
import { getHeytamMcpTools } from './mcp.js';
import { normalizeTenantId, assertTenantAccess } from '../../utils/tenant-access.js';
import { dispatchWorkflow, dispatchSingleAgent } from '../../../subagents/engine/master-dispatcher.js';

// Top-level await to get MCP tools
const heytamMcpTools = await getHeytamMcpTools();

// ─── Native Delegation Tools (no HTTP — internal calls) ──────────────────────

const delegateToSubagentTool = createTool({
  id: 'delegate-to-subagent',
  description:
    'Delegate a task to any specialized slave subagent by agentId. Covers all 30 agents: calling, mail, marketing, CRM, booking, etc.',
  inputSchema: z.object({
    agentId: z.string().describe(
      'The slave agent ID. Options: voice-agent, follow-up-agent, booking-agent, lead-concierge, lead-qualifier, sms-concierge, whatsapp-concierge, web-concierge, receptionist-agent, campaign-agent, reactivation-agent, review-agent, referral-agent, growth-analyst, crm-agent, lead-recovery-agent, no-show-prevention-agent, cancellation-recovery-agent, waitlist-agent, rebooking-agent, membership-agent, upsell-agent, revenue-recovery-agent, treatment-advisor, patient-concierge, post-treatment-agent, front-desk-copilot, emr-ehr-integration-agent, integration-guardian'
    ),
    prompt: z.string().describe('The complete instruction and context for the slave agent.'),
    tenantId: z.string().optional().describe('The tenant this action belongs to.'),
  }),
  execute: async ({ agentId, prompt, tenantId }: { agentId: string; prompt: string; tenantId?: string }) => {
    return dispatchSingleAgent(agentId, prompt, tenantId);
  },
});

const dispatchWorkflowTool = createTool({
  id: 'dispatch-workflow',
  description:
    'Parse a natural language prompt into a multi-agent workflow and execute it end-to-end across the slave agent workforce.',
  inputSchema: z.object({
    prompt: z.string().describe('The natural language task or business objective.'),
    tenantId: z.string().optional().describe('The tenant context for scoping this workflow.'),
    tenantContext: z.string().optional().describe('Business context for the agents (e.g. clinic name, specialty).'),
  }),
  execute: async ({ prompt, tenantId, tenantContext }: { prompt: string; tenantId?: string; tenantContext?: string }) => {
    return dispatchWorkflow({ prompt, tenantId, tenantContext });
  },
});

// Legacy delegation tools (kept for backwards compatibility)
const delegateToCallingAgent = createTool({
  id: 'delegate-calling',
  description: 'Delegates a telephony or calling task to the Voice Agent.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Calling/Voice Agent.'),
    tenantId: z.string().optional().describe('The tenant this action belongs to.'),
  }),
  execute: async ({ prompt, tenantId }: { prompt: string; tenantId?: string }) => {
    return dispatchSingleAgent('voice-agent', prompt, tenantId);
  },
});

const delegateToMailAgent = createTool({
  id: 'delegate-mail',
  description: 'Delegates an email or communication task to the Follow-up Agent.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Mail/Follow-up Agent.'),
    tenantId: z.string().optional().describe('The tenant this action belongs to.'),
  }),
  execute: async ({ prompt, tenantId }: { prompt: string; tenantId?: string }) => {
    return dispatchSingleAgent('follow-up-agent', prompt, tenantId);
  },
});

const delegateToMarketingAgent = createTool({
  id: 'delegate-marketing',
  description: 'Delegates a marketing or ad-campaign task to the Campaign Agent.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Marketing/Campaign Agent.'),
    tenantId: z.string().optional().describe('The tenant this action belongs to.'),
  }),
  execute: async ({ prompt, tenantId }: { prompt: string; tenantId?: string }) => {
    return dispatchSingleAgent('campaign-agent', prompt, tenantId);
  },
});

// ─── HeyTam Supervisor Agent ─────────────────────────────────────────────────

export const heytamSupervisor = new Agent({
  id: 'heytamSupervisor',
  name: 'HeyTam',
  instructions: `You are HeyTam, the Lead Supervisor Agent and AI Workforce Commander.

You orchestrate a workforce of 30 specialized slave subagents across 4 pods:
- CALLING POD: voice-agent, receptionist-agent
- MAIL POD: follow-up-agent, lead-concierge, lead-qualifier, sms-concierge, whatsapp-concierge, web-concierge
- MARKETING POD: campaign-agent, reactivation-agent, review-agent, referral-agent, growth-analyst
- CRM POD: crm-agent, lead-recovery-agent, booking-agent, no-show-prevention-agent, cancellation-recovery-agent, waitlist-agent, rebooking-agent, membership-agent, upsell-agent, revenue-recovery-agent, treatment-advisor, patient-concierge, post-treatment-agent, front-desk-copilot, emr-ehr-integration-agent, integration-guardian

DELEGATION RULES:
1. For single-agent tasks: use delegate-to-subagent with the exact agentId.
2. For multi-step workflows: use dispatch-workflow to auto-route the full workflow.
3. For calling tasks: use delegate-calling.
4. For email tasks: use delegate-mail.
5. For marketing tasks: use delegate-marketing.
6. All data is scoped to the tenantId — never cross-reference tenants.
7. PHI is automatically scrubbed before reaching any model.`,
  model: getAgentModel(),
  tools: {
    delegateToSubagent: delegateToSubagentTool,
    dispatchWorkflow: dispatchWorkflowTool,
    delegateToCallingAgent,
    delegateToMailAgent,
    delegateToMarketingAgent,
    ...heytamMcpTools,
  },
});

// ─── Supervisor Prompt Handler ────────────────────────────────────────────────

export async function handleSupervisorPrompt(prompt: string, tenantId?: string): Promise<string> {
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required.');
  }

  const safeTenantId = normalizeTenantId(tenantId);
  if (safeTenantId) {
    assertTenantAccess(safeTenantId);
  }

  const response = await heytamSupervisor.generate([
    {
      role: 'system',
      content: `You are HeyTam, the lead supervisor of a 30-agent AI workforce. Review the request, decide which specialized subagent(s) should handle the work, and dispatch accordingly.${safeTenantId ? `\n\nCurrent tenant context: ${safeTenantId}. Always scope your actions to this tenant and never refer to data from other tenants.` : ''}`,
    },
    {
      role: 'user',
      content: prompt.trim(),
    },
  ]);

  return response.text;
}
