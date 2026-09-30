/**
 * Mastra AI Framework — heytam-core
 * Registers the HeyTam supervisor and all 30 slave subagents.
 */
import { Mastra } from '@mastra/core';
import { PostgresStore } from '@mastra/pg';
import { heytamSupervisor } from './agents/heytam/index.js';
import { crmLeadSignalProvider } from './signals/crm-lead-signals.js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Postgres Storage for memory, threads, and registries
const storage = new PostgresStore({
  id: 'heytam-pg-store',
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/heytam',
});

// Initialize Mastra instance with the supervisor (which delegates to all 30 subagents)
export const mastra = new Mastra({
  storage,
  agents: { heytamSupervisor },
});

// ─── Scheduled Crons (uncomment to enable) ──────────────────────────────────

// mastra.schedules.create({
//   id: 'hourly-marketing-sync',
//   cron: '0 * * * *', // Every hour
//   agentId: 'heytamSupervisor',
// });

// mastra.schedules.create({
//   id: 'daily-morning-briefing',
//   cron: '0 9 * * *', // Every day at 9:00 AM
//   agentId: 'heytamSupervisor',
// });

// mastra.schedules.create({
//   id: 'daily-reactivation-scan',
//   cron: '0 8 * * *', // Every day at 8:00 AM — scan inactive patients
//   agentId: 'heytamSupervisor',
// });

export { crmLeadSignalProvider };
