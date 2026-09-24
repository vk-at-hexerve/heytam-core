import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const dispatchEmailTool = createTool({
  id: 'dispatch-email',
  description: 'Dispatch an email to a given address',
  inputSchema: z.object({
    to: z.string().email().describe('The recipient email address'),
    subject: z.string().describe('The email subject line'),
    body: z.string().describe('The body content of the email in text or HTML format'),
  }),
  outputSchema: z.object({
    messageId: z.string().describe('The unique identifier of the sent email'),
    success: z.boolean().describe('Whether the email was dispatched successfully'),
  }),
  execute: async ({ to, subject, body }) => {
    console.log(`[Mail Tool] Dispatching email to ${to} with subject "${subject}"...`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    return {
      messageId: `msg_${Math.random().toString(36).substring(2, 9)}`,
      success: true,
    };
  },
});
