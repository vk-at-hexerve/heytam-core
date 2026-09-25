import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callWithRetry, type FetchJsonOptions } from '../../utils/http.js';
import { normalizeTenantId, assertTenantAccess } from '../../utils/tenant-access.js';

const buildRequestBody = (prompt: string, tenantId?: string) => {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (normalizedTenantId) {
    assertTenantAccess(normalizedTenantId);
  }

  return JSON.stringify({
    prompt,
    tenantId: normalizedTenantId,
  });
};

const fetchAgent = async (url: string, prompt: string, tenantId?: string) => {
  const requestOptions: FetchJsonOptions = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildRequestBody(prompt, tenantId),
    timeoutMs: Number(process.env.INTER_AGENT_TIMEOUT_MS || 5000),
    retries: Number(process.env.INTER_AGENT_RETRIES || 3),
    retryDelayMs: Number(process.env.INTER_AGENT_RETRY_DELAY_MS || 250),
  };

  return callWithRetry(async () => {
    const response = await fetch(url, requestOptions);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Agent request failed (${response.status}): ${text || response.statusText}`);
    }
    return response.json();
  }, {
    retries: requestOptions.retries,
    timeoutMs: requestOptions.timeoutMs,
    retryDelayMs: requestOptions.retryDelayMs,
  });
};

// Distributed Agent Orchestration Tools

export const delegateToCallingAgent = createTool({
  id: 'delegate-calling',
  description: 'Delegates a telephony or calling task to the distributed Calling Agent container via HTTP REST.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Calling Agent.'),
    tenantId: z.string().optional().describe('The tenant this action belongs to.'),
  }),
  execute: async ({ prompt, tenantId }) => {
    const url = process.env.CALLING_AGENT_URL || 'http://calling-agent:3001/execute';
    return fetchAgent(url, prompt, tenantId);
  },
});

export const delegateToMailAgent = createTool({
  id: 'delegate-mail',
  description: 'Delegates an email or communication task to the distributed Mail Agent container via HTTP REST.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Mail Agent.'),
    tenantId: z.string().optional().describe('The tenant this action belongs to.'),
  }),
  execute: async ({ prompt, tenantId }) => {
    const url = process.env.MAIL_AGENT_URL || 'http://mail-agent:3002/execute';
    return fetchAgent(url, prompt, tenantId);
  },
});

export const delegateToMarketingAgent = createTool({
  id: 'delegate-marketing',
  description: 'Delegates a marketing or ad-campaign analysis task to the distributed Marketing Agent container via HTTP REST.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Marketing Agent.'),
    tenantId: z.string().optional().describe('The tenant this action belongs to.'),
  }),
  execute: async ({ prompt, tenantId }) => {
    const url = process.env.MARKETING_AGENT_URL || 'http://marketing-agent:3003/execute';
    return fetchAgent(url, prompt, tenantId);
  },
});
