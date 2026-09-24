import { Mastra } from '@mastra/core';
import { PostgresStore } from '@mastra/pg';
import { heytamSupervisor } from './agents/heytam/index.js';
import { crmLeadSignalProvider } from './signals/crm-lead-signals.js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Postgres Storage for memory, threads, and registries
const storage = new PostgresStore({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/heytam',
});

// PubSub removed as it defaults to internal memory pubsub in this version

// Initialize Mastra instance
export const mastra = new Mastra({
  storage,
  agents: { heytamSupervisor },
});

// mastra.schedules.create({
//   id: 'hourly-marketing-sync',
//   cron: '0 * * * *', // Every hour
//   agentId: 'Marketing-Optimization-Agent',
// });

// mastra.schedules.create({
//   id: 'daily-morning-briefing',
//   cron: '0 9 * * *', // Every day at 9:00 AM
//   agentId: 'HeyTam',
// });
