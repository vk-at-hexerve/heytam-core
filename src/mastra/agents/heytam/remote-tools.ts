import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Distributed Agent Orchestration Tools

export const delegateToCallingAgent = createTool({
  id: 'delegate-calling',
  description: 'Delegates a telephony or calling task to the distributed Calling Agent container via HTTP REST.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Calling Agent.'),
  }),
  execute: async ({ prompt }) => {
    const url = process.env.CALLING_AGENT_URL || 'http://calling-agent:3001/execute';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await response.json();
    return data;
  },
});

export const delegateToMailAgent = createTool({
  id: 'delegate-mail',
  description: 'Delegates an email or communication task to the distributed Mail Agent container via HTTP REST.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Mail Agent.'),
  }),
  execute: async ({ prompt }) => {
    const url = process.env.MAIL_AGENT_URL || 'http://mail-agent:3002/execute';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await response.json();
    return data;
  },
});

export const delegateToMarketingAgent = createTool({
  id: 'delegate-marketing',
  description: 'Delegates a marketing or ad-campaign analysis task to the distributed Marketing Agent container via HTTP REST.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Marketing Agent.'),
  }),
  execute: async ({ prompt }) => {
    const url = process.env.MARKETING_AGENT_URL || 'http://marketing-agent:3003/execute';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await response.json();
    return data;
  },
});
