/**
 * Inbox & Email Reading Tools — Gmail API & Inbound Processing
 * All credentials provided per-request by the tenant.
 */
import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { google } from 'googleapis';
import type { TenantKeys } from '../schema.js';

export function createInboxTools(keys: TenantKeys) {
  function getGmailClient() {
    if (!keys.googleClientId || !keys.googleClientSecret || !keys.googleRefreshToken) {
      if (keys.googleAccessToken) {
        const oauth2Client = new google.auth.OAuth2(keys.googleClientId || 'dummy', keys.googleClientSecret || 'dummy');
        oauth2Client.setCredentials({ access_token: keys.googleAccessToken });
        return google.gmail({ version: 'v1', auth: oauth2Client });
      }
      throw new Error('Google credentials not provided by tenant.');
    }
    const oauth2Client = new google.auth.OAuth2(keys.googleClientId, keys.googleClientSecret);
    oauth2Client.setCredentials({ refresh_token: keys.googleRefreshToken });
    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  return {
    readLatestEmails: createTool({
      id: 'read-latest-emails',
      description: 'Read recent emails from Gmail. Use to process incoming inquiries, complaints, or booking requests.',
      inputSchema: z.object({
        maxResults: z.number().default(10).describe('Number of emails to retrieve.'),
        query: z.string().optional().describe('Gmail search query e.g. "is:unread"'),
      }),
      execute: async ({ maxResults = 10, query }: { maxResults?: number; query?: string }) => {
        try {
          const gmail = getGmailClient();
          const { data } = await gmail.users.messages.list({ userId: 'me', maxResults, q: query });
          const messages = await Promise.all(
            (data.messages || []).map(async (m) => {
              const { data: msg } = await gmail.users.messages.get({
                userId: 'me',
                id: m.id!,
                format: 'metadata',
                metadataHeaders: ['From', 'Subject', 'Date'],
              });
              const h = msg.payload?.headers || [];
              return {
                id: m.id,
                from: h.find((x) => x.name === 'From')?.value,
                subject: h.find((x) => x.name === 'Subject')?.value,
                date: h.find((x) => x.name === 'Date')?.value,
                snippet: msg.snippet,
              };
            })
          );
          return { success: true, emails: messages, count: messages.length };
        } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err.message : 'Failed to read emails' };
        }
      },
    }),

    readEmailBody: createTool({
      id: 'read-email-body',
      description: 'Read the full body of a specific Gmail email by its message ID.',
      inputSchema: z.object({ messageId: z.string().describe('Gmail message ID.') }),
      execute: async ({ messageId }: { messageId: string }) => {
        try {
          const gmail = getGmailClient();
          const { data } = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
          const extractText = (parts: any[]): string => {
            let text = '';
            for (const part of parts) {
              if (part.mimeType === 'text/plain' && part.body?.data) {
                text += Buffer.from(part.body.data, 'base64').toString('utf-8');
              } else if (part.parts) {
                text += extractText(part.parts);
              }
            }
            return text;
          };
          const body = data.payload?.parts
            ? extractText(data.payload.parts)
            : data.payload?.body?.data
              ? Buffer.from(data.payload.body.data, 'base64').toString('utf-8')
              : 'No body content';
          return { success: true, body, snippet: data.snippet };
        } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err.message : 'Failed to read email body' };
        }
      },
    }),

    markEmailAsRead: createTool({
      id: 'mark-email-as-read',
      description: 'Mark a Gmail email as read after processing it.',
      inputSchema: z.object({ messageId: z.string().describe('Gmail message ID to mark as read.') }),
      execute: async ({ messageId }: { messageId: string }) => {
        try {
          const gmail = getGmailClient();
          await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: { removeLabelIds: ['UNREAD'] },
          });
          return { success: true, message: `Message ${messageId} marked as read.` };
        } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err.message : 'Failed to mark email read' };
        }
      },
    }),

    sendGmailReply: createTool({
      id: 'send-gmail-reply',
      description: 'Send a Gmail reply to an email thread.',
      inputSchema: z.object({
        to: z.string().describe('Recipient email address.'),
        subject: z.string().describe('Email subject line.'),
        body: z.string().describe('Plain text body.'),
        threadId: z.string().optional().describe('Gmail thread ID to reply within.'),
      }),
      execute: async ({ to, subject, body, threadId }: { to: string; subject: string; body: string; threadId?: string }) => {
        try {
          const gmail = getGmailClient();
          const rawEmail = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset="UTF-8"`, ``, body].join('\n');
          const { data } = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: Buffer.from(rawEmail).toString('base64url'), ...(threadId ? { threadId } : {}) },
          });
          return { success: true, messageId: data.id, threadId: data.threadId };
        } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err.message : 'Failed to send Gmail reply' };
        }
      },
    }),
  };
}
