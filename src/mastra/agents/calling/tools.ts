import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const initiateCallTool = createTool({
  id: 'initiate-call',
  description: 'Initiate an outbound phone call to a lead',
  inputSchema: z.object({
    phoneNumber: z.string().describe('The phone number to call'),
    leadId: z.string().describe('The CRM ID of the lead'),
    context: z.string().describe('Context or script for the AI agent on the call'),
  }),
  outputSchema: z.object({
    callId: z.string().describe('The unique identifier for the initiated call'),
    status: z.string().describe('The initial status of the call'),
  }),
  background: {
    enabled: true,
    defaultDisposition: 'deferred',
  },
  execute: async ({ phoneNumber, leadId, context }) => {
    console.log(`[Calling Tool] Initiating background call to ${phoneNumber} for lead ${leadId}...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    return {
      callId: `call_${Math.random().toString(36).substring(2, 9)}`,
      status: 'queued',
    };
  },
});
