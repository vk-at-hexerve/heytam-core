/**
 * CRM & Data Tools — Google Sheets + MongoDB
 * All credentials provided per-request by the tenant.
 */
import { z } from 'zod';
import { createTool } from '@mastra/core/tools';
import { google } from 'googleapis';
import { MongoClient } from 'mongodb';
import type { TenantKeys } from '../schema.js';

type CrmRecord = Record<string, string | number | boolean | string[] | null>;

export function createCrmTools(keys: TenantKeys) {
  function getSheetsClient() {
    if (!keys.googleClientId || !keys.googleClientSecret || !keys.googleRefreshToken)
      throw new Error('Google credentials not provided by tenant.');
    const oauth2Client = new google.auth.OAuth2(keys.googleClientId, keys.googleClientSecret);
    oauth2Client.setCredentials({ refresh_token: keys.googleRefreshToken });
    return google.sheets({ version: 'v4', auth: oauth2Client });
  }

  return {
    readGoogleSheet: createTool({
      id: 'read-google-sheet',
      description: 'Read data from a Google Sheet. Use to pull lead lists, client data, or campaign data.',
      inputSchema: z.object({ range: z.string().describe('A1 notation range e.g. "Sheet1!A1:E50".') }),
      execute: async ({ range }: { range: string }) => {
        try {
          const sheets = getSheetsClient();
          const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: keys.googleSheetId, range });
          return { success: true, rows: data.values || [], rowCount: (data.values || []).length };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        }
      },
    }),

    writeToGoogleSheet: createTool({
      id: 'write-to-google-sheet',
      description: 'Append new rows to a Google Sheet. Use to log interactions, leads, or confirmations.',
      inputSchema: z.object({
        range: z.string().describe('A1 notation range e.g. "Sheet1!A1".'),
        values: z.array(z.array(z.string())).describe('2D array e.g. [["John","Doe","john@example.com"]].'),
      }),
      execute: async ({ range, values }: { range: string; values: string[][] }) => {
        try {
          const sheets = getSheetsClient();
          const { data } = await sheets.spreadsheets.values.append({
            spreadsheetId: keys.googleSheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
          });
          return { success: true, updatedRows: data.updates?.updatedRows };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        }
      },
    }),

    updateGoogleSheetRow: createTool({
      id: 'update-google-sheet-row',
      description: 'Update an existing row/cell in a Google Sheet (e.g. lead status update).',
      inputSchema: z.object({
        range: z.string().describe('Cell range e.g. "Sheet1!D5".'),
        values: z.array(z.array(z.string())).describe('New values to write.'),
      }),
      execute: async ({ range, values }: { range: string; values: string[][] }) => {
        try {
          const sheets = getSheetsClient();
          await sheets.spreadsheets.values.update({
            spreadsheetId: keys.googleSheetId,
            range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
          });
          return { success: true, message: `Updated ${range}` };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        }
      },
    }),

    saveLeadToDatabase: createTool({
      id: 'save-lead-to-database',
      description: 'Save or upsert a lead record to MongoDB.',
      inputSchema: z.object({
        collection: z.string().describe('MongoDB collection name e.g. "leads".'),
        filterKey: z.string().describe('Unique field identifier e.g. "phone" or "email".'),
        filterValue: z.string().describe('Value of the filter key for upsert matching.'),
        data: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]))
          .describe('Lead data object to save or update.'),
      }),
      execute: async ({
        collection, filterKey, filterValue, data,
      }: {
        collection: string; filterKey: string; filterValue: string; data: CrmRecord;
      }) => {
        const activeUri = keys.mongoUri || process.env.MONGODB_URI || process.env.DATABASE_URL;
        const activeDb = keys.mongoDatabase || process.env.MONGODB_DB || 'heytam-ai-agents';
        if (!activeUri) return { success: false, error: 'MongoDB URI not provided.' };
        let client: MongoClient | null = null;
        try {
          client = new MongoClient(activeUri);
          await client.connect();
          const db = client.db(activeDb);
          const result = await db.collection(collection).updateOne(
            { [filterKey]: filterValue },
            {
              $set: { ...data, updatedAt: new Date().toISOString() },
              $setOnInsert: { createdAt: new Date().toISOString() },
            },
            { upsert: true }
          );
          return { success: true, upsertedId: result.upsertedId?.toString(), matched: result.matchedCount };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        } finally {
          await client?.close();
        }
      },
    }),

    queryDatabase: createTool({
      id: 'query-database',
      description: 'Query MongoDB for lead or customer records by filter.',
      inputSchema: z.object({
        collection: z.string().describe('MongoDB collection name.'),
        filter: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]))
          .describe('MongoDB filter e.g. {"email": "john@example.com"}.'),
        limit: z.number().default(10).describe('Max records to return.'),
      }),
      execute: async ({ collection, filter, limit }: { collection: string; filter: CrmRecord; limit: number }) => {
        const activeUri = keys.mongoUri || process.env.MONGODB_URI || process.env.DATABASE_URL;
        const activeDb = keys.mongoDatabase || process.env.MONGODB_DB || 'heytam-ai-agents';
        if (!activeUri) return { success: false, error: 'MongoDB URI not provided.' };
        let client: MongoClient | null = null;
        try {
          client = new MongoClient(activeUri);
          await client.connect();
          const db = client.db(activeDb);
          const docs = await db.collection(collection).find(filter).limit(limit).toArray();
          return { success: true, records: docs.map((d) => ({ ...d, _id: String(d._id) })), count: docs.length };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        } finally {
          await client?.close();
        }
      },
    }),

    addLeadNote: createTool({
      id: 'add-lead-note',
      description: 'Add a timestamped interaction note to a lead record. Call after every conversation.',
      inputSchema: z.object({
        leadIdentifier: z.string().describe('Lead email or phone number as identifier.'),
        agentName: z.string().describe('Name of the agent adding the note.'),
        note: z.string().describe('Interaction summary or note content.'),
      }),
      execute: async ({ leadIdentifier, agentName, note }: { leadIdentifier: string; agentName: string; note: string }) => {
        const activeUri = keys.mongoUri || process.env.MONGODB_URI || process.env.DATABASE_URL;
        const activeDb = keys.mongoDatabase || process.env.MONGODB_DB || 'heytam-ai-agents';
        if (!activeUri) return { success: false, error: 'MongoDB URI not provided.' };
        let client: MongoClient | null = null;
        try {
          client = new MongoClient(activeUri);
          await client.connect();
          const db = client.db(activeDb);
          await db.collection('leads').updateOne(
            { $or: [{ email: leadIdentifier }, { phone: leadIdentifier }] },
            { $push: { notes: { agentName, note, timestamp: new Date().toISOString() } } as any },
            { upsert: true }
          );
          return { success: true, message: 'Note added.' };
        } catch (err: unknown) {
          return { success: false, error: (err as Error).message };
        } finally {
          await client?.close();
        }
      },
    }),
  };
}
