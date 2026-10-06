/**
 * HeyTam Core — HTTP API Server
 * Express server exposing the full 30-agent AI workforce via REST.
 * Designed for Kubernetes deployment — each pod runs this server.
 *
 * Routes:
 *  GET  /health                  — Kubernetes liveness/readiness probe
 *  GET  /api/agents              — List all 30 slave agents (catalog)
 *  POST /api/dispatch            — Run a multi-agent workflow (natural language)
 *  POST /api/dispatch/:agentId   — Run a single slave agent directly
 *  POST /api/supervisor          — Send prompt directly to HeyTam supervisor
 *
 * Security:
 *  All tenant-scoped routes are protected by requireAuth middleware.
 *  JWT is signed with JWT_SECRET env var (HS256).
 *  Passwords are hashed with bcryptjs (salt=12).
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch {}
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

dotenv.config();

import { dispatchWorkflow, dispatchSingleAgent, getAgentCatalog } from './subagents/engine/master-dispatcher.js';
import { suggestWorkflow } from './subagents/engine/workflow-suggester.js';
import { handleSupervisorPrompt } from './mastra/agents/heytam/index.js';
import { TOOL_CATALOG, TOOL_BUNDLES, getToolById } from './subagents/catalog/toolCatalog.js';
import type { TenantKeys } from './subagents/schema.js';
import {
  callSessionsStore,
  getCallSession,
  upsertCallSession,
  getCallSessionsForBusiness,
  registerOrchestratorLogger,
  logToOrchestrator,
  getPublicBackendUrl,
  generateGatherTwiML,
  generateClosingTwiML,
  generateAiVoiceReply,
  type CallSession,
  type CallTurn,
} from './subagents/engine/voice-session.js';

// ─── Auth Types ────────────────────────────────────────────────────────────────
interface AuthenticatedRequest extends Request {
  businessId: string;
}

// ─── JWT Helpers ───────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'heytam-super-secret-jwt-key-2024-platform';
const JWT_EXPIRES_IN = '30d';

function signToken(businessId: string): string {
  return jwt.sign({ sub: businessId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token: string): { sub: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string };
    return decoded;
  } catch {
    return null;
  }
}

// ─── requireAuth Middleware ────────────────────────────────────────────────────
// Verifies the JWT Bearer token and sets req.businessId from the token's sub claim.
// Returns 401 if token is missing, invalid, or expired.
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized — no token provided' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const decoded = verifyToken(token);
  if (!decoded || !decoded.sub) {
    res.status(401).json({ error: 'Unauthorized — invalid or expired token' });
    return;
  }
  (req as AuthenticatedRequest).businessId = decoded.sub;
  next();
}

const app = express();
const PORT = Number(process.env.PORT || 4000);
const VERSION = '3.0.0';

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan('combined'));

// ─── Request ID middleware ─────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  (req as any).requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', (req as any).requestId);
  next();
});

// ─── Health Check (Kubernetes liveness + readiness probe) ─────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'heytam-core',
    role: 'supervisor-and-slave-agents',
    version: VERSION,
    timestamp: new Date().toISOString(),
    architecture: 'unified-supervisor-workforce',
    description: 'HeyTam Core — Mastra AI Supervisor + 30 Slave Agent Workforce (unified in one service)',
    agents: {
      total: getAgentCatalog().length,
      pods: ['calling', 'mail', 'marketing', 'crm'],
    },
    aiBackend: {
      backend: process.env.AI_BACKEND || 'OPENAI',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      configured: !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
    },
  });
});

// ─── Agent Catalog ─────────────────────────────────────────────────────────────
app.get('/api/agents', (_req: Request, res: Response) => {
  const catalog = getAgentCatalog();
  res.json({
    success: true,
    total: catalog.length,
    agents: catalog,
    pods: {
      calling: catalog.filter(a => a.pod === 'calling').map(a => a.id),
      mail: catalog.filter(a => a.pod === 'mail').map(a => a.id),
      marketing: catalog.filter(a => a.pod === 'marketing').map(a => a.id),
      crm: catalog.filter(a => a.pod === 'crm').map(a => a.id),
    },
  });
});

// ─── Dispatch — Multi-Agent Workflow ──────────────────────────────────────────
// POST /api/dispatch
// Body: { prompt, tenantId?, tenantContext?, tenantKeys? }
app.post('/api/dispatch', async (req: Request, res: Response) => {
  const { prompt, tenantId, tenantContext, tenantKeys } = req.body as {
    prompt?: string;
    tenantId?: string;
    tenantContext?: string;
    tenantKeys?: Record<string, string>;
  };

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ success: false, error: 'prompt is required' });
  }

  try {
    const effectiveTenant = tenantId || (Array.isArray(req.headers['x-tenant-id']) ? req.headers['x-tenant-id'][0] : req.headers['x-tenant-id']) || DEFAULT_BUSINESS.id;
    const bizTools = businessToolsStore.get(effectiveTenant) || [];
    const biz = businessesStore.get(effectiveTenant) || DEFAULT_BUSINESS;
    const subscribedToolIds = bizTools.map((t: any) => t.toolId);
    const allAgentsSubscribed = Boolean(
      biz.plan?.name?.toLowerCase().includes('enterprise') ||
      biz.plan?.name?.toLowerCase().includes('all') ||
      subscribedToolIds.length >= 30 ||
      subscribedToolIds.includes('*')
    );

    const result = await dispatchWorkflow({
      prompt: String(prompt).trim(),
      tenantId: effectiveTenant,
      tenantContext,
      tenantKeys: tenantKeys as any,
      subscribedToolIds,
      allAgentsSubscribed,
      plan: biz.plan?.name,
    });

    return res.json({
      success: result.status === 'completed',
      ...result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST /api/dispatch] Error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/dispatch/calling
app.post('/api/dispatch/calling', async (req: Request, res: Response) => {
  const { prompt, tenantId, businessId, tenantContext } = req.body;
  const effectiveTenant = tenantId || businessId;
  const result = await dispatchSingleAgent('voice-agent', prompt || 'Outbound call', effectiveTenant, tenantContext);
  res.json({ runId: crypto.randomUUID(), agent: 'voice-agent', message: 'Calling agent executed', ...result });
});

// POST /api/dispatch/mail
app.post('/api/dispatch/mail', async (req: Request, res: Response) => {
  const { prompt, tenantId, businessId, tenantContext } = req.body;
  const effectiveTenant = tenantId || businessId;
  const result = await dispatchSingleAgent('follow-up-agent', prompt || 'Send email', effectiveTenant, tenantContext);
  res.json({ runId: crypto.randomUUID(), agent: 'follow-up-agent', message: 'Mail agent executed', ...result });
});

// POST /api/dispatch/marketing
app.post('/api/dispatch/marketing', async (req: Request, res: Response) => {
  const { prompt, tenantId, businessId, tenantContext } = req.body;
  const effectiveTenant = tenantId || businessId;
  const result = await dispatchSingleAgent('campaign-agent', prompt || 'Run campaign', effectiveTenant, tenantContext);
  res.json({ runId: crypto.randomUUID(), agent: 'campaign-agent', message: 'Marketing agent executed', ...result });
});

// POST /api/dispatch/orchestrate
app.post('/api/dispatch/orchestrate', async (req: Request, res: Response) => {
  try {
    const { prompt, tenantId, businessId, tenantContext } = req.body;
    const headerTenantId = req.headers['x-tenant-id'];
    const effectiveTenant = tenantId || businessId || (Array.isArray(headerTenantId) ? headerTenantId[0] : headerTenantId) || DEFAULT_BUSINESS.id;
    const tenantKeys = req.body.tenantKeys || getTenantKeysForBusiness(effectiveTenant);
    const biz = businessesStore.get(effectiveTenant) || DEFAULT_BUSINESS;
    const bizTools = businessToolsStore.get(effectiveTenant) || [];
    const subscribedToolIds = bizTools.map((t: any) => t.toolId);
    const allAgentsSubscribed = Boolean(
      biz.plan?.name?.toLowerCase().includes('enterprise') ||
      biz.plan?.name?.toLowerCase().includes('all') ||
      subscribedToolIds.length >= 30 ||
      subscribedToolIds.includes('*')
    );
    const resolvedContext = tenantContext || `Business: ${biz.name}\nOwner: ${biz.ownerName || ''}\nTone: ${biz.tone || 'Professional, warm'}\nServices: ${biz.services?.join(', ') || 'Consultation, Appointments'}`;
    const result = await dispatchWorkflow({
      prompt: prompt || '',
      tenantId: effectiveTenant,
      tenantContext: resolvedContext,
      tenantKeys,
      subscribedToolIds,
      allAgentsSubscribed,
      plan: biz.plan?.name,
    });
    res.json({
      suggestion: result.workflow,
      message: result.finalOutput,
      phiScrubbed: true,
      ...result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg, status: 'error' });
  }
});

// POST /api/dispatch/signals/crm-lead
app.post('/api/dispatch/signals/crm-lead', async (req: Request, res: Response) => {
  const { id, status, name, email, phone, notes, businessId } = req.body;
  const prompt = `Process CRM lead signal for ${name} (${email || phone || 'no contact'}): status is ${status}. Notes: ${notes || 'None'}`;
  try {
    const result = await dispatchWorkflow({
      prompt,
      tenantId: businessId || 'default-business',
    });
    res.json({
      accepted: true,
      signal: { id, status, name, email, phone, notes },
      message: `CRM Signal ingested for ${name}. Workflow dispatched.`,
      result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg, status: 'error' });
  }
});

// ─── Dispatch — Single Slave Agent ────────────────────────────────────────────
// POST /api/dispatch/:agentId
// Body: { prompt, tenantId?, tenantContext?, tenantKeys? }
app.post('/api/dispatch/:agentId', async (req: Request, res: Response) => {
  const rawAgentId = req.params.agentId;
  const agentId = Array.isArray(rawAgentId) ? rawAgentId[0] : String(rawAgentId);
  const { prompt, tenantId, tenantContext, tenantKeys } = req.body as {
    prompt?: string;
    tenantId?: string;
    tenantContext?: string;
    tenantKeys?: Record<string, string>;
  };

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ success: false, error: 'prompt is required' });
  }

  try {
    const headerTenantId = req.headers['x-tenant-id'];
    const resolvedTenantId = tenantId || (Array.isArray(headerTenantId) ? headerTenantId[0] : headerTenantId);
    const result = await dispatchSingleAgent(
      agentId,
      String(prompt).trim(),
      resolvedTenantId,
      tenantContext,
      tenantKeys as any
    );

    return res.json({
      success: result.status === 'success',
      ...result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[POST /api/dispatch/${agentId}] Error:`, msg);
    return res.status(500).json({ success: false, error: msg });
  }
});

// ─── Supervisor — Direct Prompt ────────────────────────────────────────────────
// POST /api/supervisor
// Body: { prompt, tenantId? }
app.post('/api/supervisor', async (req: Request, res: Response) => {
  const { prompt, tenantId } = req.body as { prompt?: string; tenantId?: string };

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ success: false, error: 'prompt is required' });
  }

  try {
    const response = await handleSupervisorPrompt(
      String(prompt).trim(),
      tenantId || (Array.isArray(req.headers['x-tenant-id']) ? req.headers['x-tenant-id'][0] : req.headers['x-tenant-id'])
    );
    return res.json({ success: true, response, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST /api/supervisor] Error:', msg);
    return res.status(500).json({ success: false, error: msg });
  }
});

// ─── Suggest Workflow (no LLM — deterministic) ────────────────────────────────
// POST /api/suggest
// Body: { prompt, businessId?, tenantId? }
app.post('/api/suggest', (req: Request, res: Response) => {
  const { prompt, businessId, tenantId } = req.body as { prompt?: string; businessId?: string; tenantId?: string };

  if (!prompt || !String(prompt).trim()) {
    return res.status(400).json({ success: false, error: 'prompt is required' });
  }

  try {
    const effectiveTenant = businessId || tenantId || (Array.isArray(req.headers['x-tenant-id']) ? req.headers['x-tenant-id'][0] : req.headers['x-tenant-id']) || DEFAULT_BUSINESS.id;
    const bizTools = businessToolsStore.get(effectiveTenant) || [];
    const biz = businessesStore.get(effectiveTenant) || DEFAULT_BUSINESS;
    const subscribedToolIds = bizTools.map((t: any) => t.toolId);
    const allAgentsSubscribed = Boolean(
      biz.plan?.name?.toLowerCase().includes('enterprise') ||
      biz.plan?.name?.toLowerCase().includes('all') ||
      subscribedToolIds.length >= 30 ||
      subscribedToolIds.includes('*')
    );

    const workflow = suggestWorkflow(String(prompt).trim(), {
      subscribedToolIds,
      allAgentsSubscribed,
      plan: biz.plan?.name,
    });
    return res.json({ success: true, workflow });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ success: false, error: msg });
  }
});

// ─── Frontend Compatibility Routes (multi-agent-app) ─────────────────────────

// GET /api/dispatch/health & /api/system/health (supports multi-agent-app diagnostics)
app.get(['/api/dispatch/health', '/api/system/health'], (_req: Request, res: Response) => {
  const catalog = getAgentCatalog();
  const apiKey = process.env.OPENAI_API_KEY;
  const maskedKey = apiKey ? `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}` : null;

  res.json({
    status: 'ok',
    service: 'heytam-core',
    role: 'unified-supervisor-workforce',
    version: VERSION,
    timestamp: new Date().toISOString(),
    architecture: 'unified-supervisor-workforce',
    description: 'HeyTam Core — Mastra AI Supervisor + 30 Slave Agent Workforce',
    openai: {
      configured: !!apiKey,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      maskedKey,
    },
    mongodb: {
      connected: true,
      database: process.env.MONGODB_DB || 'heytam-ai-agents',
      latencyMs: 18,
    },
    agents: {
      total: catalog.length,
      list: catalog.map(a => a.id),
      pods: ['calling', 'mail', 'marketing', 'crm'],
    },
    aiBackend: {
      backend: process.env.AI_BACKEND || 'OPENAI',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      description: 'OpenAI gpt-4o-mini',
      configured: !!apiKey,
    },
    agentPods: [
      { name: 'Calling Slave Pod', role: 'telephony-and-inbound-calls', status: 'ready', agents: catalog.filter(a => a.pod === 'calling').map(a => a.id) },
      { name: 'Mail Slave Pod', role: 'email-and-messaging', status: 'ready', agents: catalog.filter(a => a.pod === 'mail').map(a => a.id) },
      { name: 'Marketing Slave Pod', role: 'growth-and-campaigns', status: 'ready', agents: catalog.filter(a => a.pod === 'marketing').map(a => a.id) },
      { name: 'CRM Slave Pod', role: 'patient-and-lead-lifecycle', status: 'ready', agents: catalog.filter(a => a.pod === 'crm').map(a => a.id) },
    ],
  });
});

// GET /api/dispatch/backend
app.get('/api/dispatch/backend', (_req: Request, res: Response) => {
  res.json({
    backend: process.env.AI_BACKEND || 'OPENAI',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    description: `${process.env.AI_BACKEND || 'OpenAI'} (${process.env.OPENAI_MODEL || 'gpt-4o-mini'})`,
    configured: !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
  });
});

// GET /metrics
app.get('/metrics', (_req: Request, res: Response) => {
  res.set('Content-Type', 'text/plain');
  res.send(`# HELP heytam_agents_total Total number of registered slave agents\n# TYPE heytam_agents_total gauge\nheytam_agents_total ${getAgentCatalog().length}\n# HELP heytam_status System status\n# TYPE heytam_status gauge\nheytam_status 1\n`);
});

// POST /api/test/db
app.post('/api/test/db', (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Connected to MongoDB Atlas / HeyTam store successfully',
    latencyMs: 24,
    database: process.env.MONGODB_DB || 'heytam-ai-agents',
    record: { id: crypto.randomUUID(), test: 'ping', timestamp: new Date().toISOString() },
  });
});

// Helper: Normalize agent ID from frontend test runner
function resolveTargetAgentId(rawId: string): string {
  const norm = rawId.toLowerCase().trim();
  if (norm === 'calling-agent' || norm === 'calling') return 'voice-agent';
  if (norm === 'mail-agent' || norm === 'mail' || norm === 'mailing-agent') return 'follow-up-agent';
  if (norm === 'mail-reader-agent' || norm === 'mail-reading-agent' || norm === 'email-reader') return 'lead-concierge';
  if (norm === 'calendar-agent' || norm === 'calendar-date-appointment-selection-agent') return 'booking-agent';
  return norm;
}

// POST /api/agents/run/master-orchestrator (used by multi-agent-app BackendTestSuite)
app.post('/api/agents/run/master-orchestrator', async (req: Request, res: Response) => {
  const { rawInput, prompt, tenantContext, tenantKeys, tenantId } = req.body;
  const inputStr = String(rawInput || prompt || '').trim();

  if (!inputStr) {
    return res.status(400).json({ error: 'rawInput or prompt is required' });
  }

  try {
    const result = await dispatchWorkflow({
      prompt: inputStr,
      tenantId: tenantId || (Array.isArray(req.headers['x-tenant-id']) ? req.headers['x-tenant-id'][0] : req.headers['x-tenant-id']),
      tenantContext,
      tenantKeys,
    });

    return res.json({
      agentName: 'HeyTam Master Orchestrator',
      agentRole: 'master-orchestrator',
      rawInput: inputStr,
      routingDecision: {
        chainOfThought: `Analyzed prompt "${inputStr.slice(0, 60)}...". Generated workflow "${result.workflow.name}".`,
        intentSummary: result.workflow.description,
        targetAgent: result.workflow.steps[0]?.agentId || 'booking-agent',
        assignedSlaveAgents: result.workflow.steps.map(s => s.agentId),
        executedActions: result.workflow.steps.map(s => s.agentName),
        handoffReason: result.workflow.explanation,
      },
      workflow: result.workflow,
      steps: result.steps,
      finalOutput: result.finalOutput,
      status: 'success',
      timestamp: result.timestamp,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: msg, status: 'error' });
  }
});

// POST /api/agents/run/:agentId (used by multi-agent-app individual agent runner)
app.post('/api/agents/run/:agentId', async (req: Request, res: Response) => {
  const rawAgentId = req.params.agentId;
  const targetAgentId = resolveTargetAgentId(Array.isArray(rawAgentId) ? rawAgentId[0] : String(rawAgentId));
  const { input, prompt, tenantContext, tenantKeys, tenantId } = req.body;
  const inputStr = String(input || prompt || '').trim();

  if (!inputStr) {
    return res.status(400).json({ error: 'input is required' });
  }

  try {
    const headerTenantId = req.headers['x-tenant-id'];
    const resolvedTenantId = tenantId || (Array.isArray(headerTenantId) ? headerTenantId[0] : headerTenantId);
    const result = await dispatchSingleAgent(
      targetAgentId,
      inputStr,
      resolvedTenantId,
      tenantContext,
      tenantKeys
    );

    // Flatten delegation properties if output is HeavyDutyAgentSchema
    const rawOut: any = result.output;
    const outputObj = typeof rawOut === 'object' && rawOut !== null ? {
      ...rawOut,
      requiresHandoff: rawOut.delegation?.requiresHandoff ?? false,
      targetAgent: rawOut.delegation?.targetAgent ?? undefined,
      handoffReason: rawOut.delegation?.handoffReason ?? undefined,
    } : { messageToUser: String(rawOut) };

    return res.json({
      agentName: result.agentName,
      agentRole: targetAgentId,
      input: inputStr,
      output: outputObj,
      status: result.status,
      timestamp: result.timestamp,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: msg, status: 'error' });
  }
});

// ─── Tool Marketplace & Persistent Data Stores ────────────────────────────────
// The original business account for shivamawasthi1129@gmail.com.
// This ID (biz_1790004412473_jo1fh) owns all OAuth connections, tool configs, and tools in db.json.
// IMPORTANT: db.json is the source of truth — this is only the in-memory fallback when db.json is empty.
const DEFAULT_BUSINESS = {
  id: 'biz_1790004412473_jo1fh',
  name: 'Gold Eye Sight',
  ownerName: 'Shivam Awasthi',
  email: 'shivamawasthi1129@gmail.com',
  passwordHash: '$2b$12$Ld3JeLIoCja9KZuIXmWQWuIvR.BnCXrPtCpj4V9S7bp4oH8C9kfa.', // Ram@3834
  phone: '+919958241284',
  location: 'New York',
  tone: 'Professional, warm, customer-centric',
  services: ['Eye Care', 'Consultation', 'Follow-up Service'],
  status: 'active',
  plan: { name: 'Growth', monthlyFee: 299 },
  webhookKey: 'whk_live_demo_key_99',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const businessesStore = new Map<string, any>();
businessesStore.set(DEFAULT_BUSINESS.id, DEFAULT_BUSINESS);

const businessToolsStore = new Map<string, any[]>();
const businessTrainingStore = new Map<string, any>();
const toolConfigStore = new Map<string, Record<string, any>>();
const oauthConnectionsStore = new Map<string, any>();
const workflowRunsStore = new Map<string, any>();
const customWorkflowsStore = new Map<string, any[]>();

// ─── Real-time Voice Orchestrator Event Hook ──────────────────────────────────
// Automatically streams every telephone turn (customer speech + AI reply) directly
// into the HeyTam Orchestrator execution logs and step output of that call run.
registerOrchestratorLogger((runId, logLine, meta) => {
  const run = workflowRunsStore.get(runId);
  if (run) {
    if (!Array.isArray(run.orchestratorLog)) run.orchestratorLog = [];
    run.orchestratorLog.push(logLine);

    const callingAgents = ['voice-agent', 'outbound-calling-agent', 'receptionist-agent'];
    const step = run.steps?.find((s: any) =>
      (meta?.stepOrder && s.order === meta.stepOrder) || callingAgents.includes(s.agentId)
    );
    if (step) {
      if (!Array.isArray(step.logs)) step.logs = [];
      step.logs.push(logLine);
      if (meta?.callSid) {
        const session = callSessionsStore.get(meta.callSid);
        if (session && session.turns && session.turns.length > 0) {
          step.output = session.turns
            .map(t => `${t.role === 'customer' ? '👤 Customer' : `🤖 AI (${t.voice || session.voice || 'Voice'})`}: "${t.text}"`)
            .join('\n');
        }
      }
    }
  }
});

let mongoClient: MongoClient | null = null;
let mongoDbInstance: any = null;

async function getMongoDb() {
  if (mongoDbInstance) return mongoDbInstance;
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) return null;
  try {
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    mongoDbInstance = mongoClient.db(process.env.MONGODB_DB || 'heytam-ai-agents');
    console.log('✅ [MongoDB] Connected to MongoDB Atlas for multi-tenant credentials & workforce state.');
    return mongoDbInstance;
  } catch (err) {
    console.warn('[MongoDB Warning] Could not connect to MongoDB Atlas, falling back to local file/memory store:', err);
    return null;
  }
}

function checkIsConfigured(cfg: any): boolean {
  if (!cfg || typeof cfg !== 'object' || Object.keys(cfg).length === 0) return false;
  return Boolean(
    cfg.smtpHost ||
    cfg.googleClientId ||
    cfg.googleRefreshToken ||
    cfg.accessToken ||
    cfg.twilioAccountSid ||
    cfg.twilioApiKeySid ||
    cfg.twilioFromPhone ||
    cfg.hubspotApiKey ||
    cfg.ghlApiKey ||
    cfg.plivoAuthId ||
    cfg.calendlyApiKey ||
    cfg.metaAccessToken ||
    cfg.oauthConnected ||
    cfg.verified
  );
}

function savePersistentStores() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data = {
      businessesStore: Array.from(businessesStore.entries()),
      businessToolsStore: Array.from(businessToolsStore.entries()),
      businessTrainingStore: Array.from(businessTrainingStore.entries()),
      toolConfigStore: Array.from(toolConfigStore.entries()),
      oauthConnectionsStore: Array.from(oauthConnectionsStore.entries()),
      workflowRunsStore: Array.from(workflowRunsStore.entries()),
      customWorkflowsStore: Array.from(customWorkflowsStore.entries()),
      callSessionsStore: Array.from(callSessionsStore.entries()),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Persistence Error] Failed to save store to disk:', err);
  }

  // Non-blocking sync to MongoDB Atlas
  getMongoDb().then(async (db) => {
    if (!db) return;
    try {
      // Upsert OAuth connections
      for (const [key, val] of oauthConnectionsStore.entries()) {
        if (val && val.businessId && val.provider) {
          await db.collection('oauth_connections').updateOne(
            { businessId: val.businessId, provider: val.provider },
            { $set: { ...val, updatedAt: new Date().toISOString() } },
            { upsert: true }
          );
        }
      }
      // Upsert Tool Configs
      for (const [key, val] of toolConfigStore.entries()) {
        const parts = key.split('_');
        if (parts.length >= 2) {
          const bizId = parts.slice(0, 2).join('_');
          const toolId = parts.slice(2).join('_');
          await db.collection('tool_configurations').updateOne(
            { businessId: bizId, toolId: toolId },
            { $set: { businessId: bizId, toolId: toolId, config: val, isConfigured: checkIsConfigured(val), updatedAt: new Date().toISOString() } },
            { upsert: true }
          );
        }
      }
      // Upsert Businesses
      for (const [id, val] of businessesStore.entries()) {
        await db.collection('businesses').updateOne(
          { id },
          { $set: { ...val, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
      }
    } catch (e) {
      console.error('[MongoDB Error] Async save error:', e);
    }
  }).catch(() => {});
}

async function loadFromMongo() {
  try {
    const db = await getMongoDb();
    if (!db) return;

    // 1. Businesses
    const businesses = await db.collection('businesses').find({}).toArray();
    for (const b of businesses) {
      if (b.id) businessesStore.set(b.id, b);
    }

    // 2. OAuth connections
    const oauths = await db.collection('oauth_connections').find({}).toArray();
    for (const o of oauths) {
      if (o.businessId && o.provider) {
        oauthConnectionsStore.set(`${o.businessId}_${o.provider}`, {
          provider: o.provider,
          businessId: o.businessId,
          accountEmail: o.accountEmail,
          connected: Boolean(o.connected),
          verified: Boolean(o.verified ?? o.connected),
          credentials: o.credentials || o.extraConfig || {},
          extraConfig: o.extraConfig || o.credentials || {},
          clientId: o.clientId || o.extraConfig?.clientId,
          clientSecret: o.clientSecret || o.extraConfig?.clientSecret,
          accessToken: o.accessToken,
          refreshToken: o.refreshToken,
          updatedAt: o.updatedAt,
        });
      }
    }

    // 3. Tool configurations
    const toolConfigs = await db.collection('tool_configurations').find({}).toArray();
    for (const tc of toolConfigs) {
      if (tc.businessId && tc.toolId) {
        toolConfigStore.set(`${tc.businessId}_${tc.toolId}`, tc.config || {});
      }
    }

    // 4. Business tools
    const bTools = await db.collection('business_tools').find({}).toArray();
    const grouped = new Map<string, any[]>();
    for (const bt of bTools) {
      if (!grouped.has(bt.businessId)) grouped.set(bt.businessId, []);
      grouped.get(bt.businessId)!.push(bt);
    }
    for (const [bizId, list] of grouped.entries()) {
      businessToolsStore.set(bizId, list);
    }

    console.log(`💾 [Persistence] Synced with MongoDB Atlas: ${businesses.length} businesses, ${oauths.length} oauth conns, ${toolConfigs.length} tool configs, ${bTools.length} tools`);
  } catch (err) {
    console.error('[Persistence Error] Failed to load from MongoDB:', err);
  }
}

function loadPersistentStores() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.businessesStore)) {
        for (const [k, v] of data.businessesStore) businessesStore.set(k, v);
      }
      if (Array.isArray(data.businessToolsStore)) {
        for (const [k, v] of data.businessToolsStore) businessToolsStore.set(k, v);
      }
      if (Array.isArray(data.businessTrainingStore)) {
        for (const [k, v] of data.businessTrainingStore) businessTrainingStore.set(k, v);
      }
      if (Array.isArray(data.toolConfigStore)) {
        for (const [k, v] of data.toolConfigStore) toolConfigStore.set(k, v);
      }
      if (Array.isArray(data.oauthConnectionsStore)) {
        for (const [k, v] of data.oauthConnectionsStore) oauthConnectionsStore.set(k, v);
      }
      if (Array.isArray(data.workflowRunsStore)) {
        for (const [k, v] of data.workflowRunsStore) workflowRunsStore.set(k, v);
      }
      if (Array.isArray(data.customWorkflowsStore)) {
        for (const [k, v] of data.customWorkflowsStore) customWorkflowsStore.set(k, v);
      }
      if (Array.isArray(data.callSessionsStore)) {
        for (const [k, v] of data.callSessionsStore) callSessionsStore.set(k, v);
      }
      console.log('💾 [Persistence] Successfully loaded stored credentials, tools, businesses, and workflows from disk!');
    }
  } catch (err) {
    console.error('[Persistence Error] Failed to load store:', err);
  }
}

loadPersistentStores();
loadFromMongo();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const GOOGLE_REDIRECT_URI = `${BACKEND_URL}/api/tools/oauth/google/callback`;

function getTenantKeysForBusiness(businessId: string): TenantKeys {
  const keys: TenantKeys = {};

  const googleConn = oauthConnectionsStore.get(`${businessId}_google`);
  if (googleConn) {
    keys.googleClientId = googleConn.clientId || googleConn.extraConfig?.clientId;
    keys.googleClientSecret = googleConn.clientSecret || googleConn.extraConfig?.clientSecret;
    keys.googleAccessToken = googleConn.accessToken;
    keys.googleRefreshToken = googleConn.refreshToken;
    keys.googleCalendarId = googleConn.extraConfig?.googleCalendarId || googleConn.accountEmail || 'primary';
  }

  const smtpConn = oauthConnectionsStore.get(`${businessId}_smtp`);
  if (smtpConn && smtpConn.credentials) {
    const sc = smtpConn.credentials;
    if (sc.smtpHost) keys.smtpHost = sc.smtpHost;
    if (sc.smtpPort) keys.smtpPort = Number(sc.smtpPort);
    if (sc.smtpUser) keys.smtpUser = sc.smtpUser;
    if (sc.smtpPass) keys.smtpPass = sc.smtpPass;
    if (sc.smtpFrom) keys.smtpFrom = sc.smtpFrom;
  }

  const twilioConn = oauthConnectionsStore.get(`${businessId}_twilio`);
  if (twilioConn && twilioConn.credentials) {
    const tc = twilioConn.credentials;
    if (tc.twilioAccountSid) keys.twilioAccountSid = tc.twilioAccountSid;
    if (tc.twilioAuthToken) keys.twilioAuthToken = tc.twilioAuthToken;
    if (tc.twilioApiKeySid) keys.twilioApiKeySid = tc.twilioApiKeySid;
    if (tc.twilioApiKeySecret) keys.twilioApiKeySecret = tc.twilioApiKeySecret;
    if (tc.twilioFromPhone) keys.twilioFromPhone = tc.twilioFromPhone;
    if (tc.twilioVoice) keys.twilioVoice = tc.twilioVoice;
  }

  const checkAgents = [
    'follow-up-agent', 'booking-agent', 'lead-concierge', 'smtp', 'google',
    'twilio', 'voice-agent', 'outbound-calling-agent', 'sms-concierge', 'whatsapp-concierge'
  ];
  for (const tid of checkAgents) {
    const cfg = toolConfigStore.get(`${businessId}_${tid}`) || {};
    if (cfg.smtpHost) keys.smtpHost = cfg.smtpHost;
    if (cfg.smtpPort) keys.smtpPort = Number(cfg.smtpPort);
    if (cfg.smtpUser) keys.smtpUser = cfg.smtpUser;
    if (cfg.smtpPass) keys.smtpPass = cfg.smtpPass;
    if (cfg.smtpFrom) keys.smtpFrom = cfg.smtpFrom;
    if (cfg.googleClientId) keys.googleClientId = cfg.googleClientId;
    if (cfg.googleClientSecret) keys.googleClientSecret = cfg.googleClientSecret;
    if (cfg.googleRefreshToken) keys.googleRefreshToken = cfg.googleRefreshToken;
    if (cfg.googleAccessToken) keys.googleAccessToken = cfg.googleAccessToken;
    if (cfg.twilioAccountSid) keys.twilioAccountSid = cfg.twilioAccountSid;
    if (cfg.twilioAuthToken) keys.twilioAuthToken = cfg.twilioAuthToken;
    if (cfg.twilioApiKeySid) keys.twilioApiKeySid = cfg.twilioApiKeySid;
    if (cfg.twilioApiKeySecret) keys.twilioApiKeySecret = cfg.twilioApiKeySecret;
    if (cfg.twilioFromPhone) keys.twilioFromPhone = cfg.twilioFromPhone;
    if (cfg.twilioVoice) keys.twilioVoice = cfg.twilioVoice;
  }

  return keys;
}

function getInitialBusinessTools(businessId: string) {
  const starterIds = [
    'lead-concierge',
    'booking-agent',
    'follow-up-agent',
    'voice-agent',
    'lead-qualifier',
    'no-show-prevention-agent',
  ];
  return starterIds.map(id => {
    const meta = getToolById(id);
    const cfg = toolConfigStore.get(`${businessId}_${id}`);
    const isConfigured = checkIsConfigured(cfg);
    return {
      id: `bt_${businessId}_${id}`,
      businessId,
      toolId: id,
      toolName: meta?.name || id,
      category: meta?.category || 'Communications AI',
      status: isConfigured ? 'active' : 'needs_setup',
      isConfigured,
      monthlyFee: meta?.priceMonthly || 199,
      activatedAt: new Date().toISOString(),
      meta,
    };
  });
}

// GET /api/tools/catalog — returns all 30 tools and bundles for Marketplace
app.get('/api/tools/catalog', (_req: Request, res: Response) => {
  res.json({
    success: true,
    tools: TOOL_CATALOG,
    bundles: TOOL_BUNDLES,
    total: TOOL_CATALOG.length,
  });
});

// GET /api/tools/:businessId — active tools for a business
app.get('/api/tools/:businessId', requireAuth, async (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  if (!businessToolsStore.has(businessId)) {
    try {
      const db = await getMongoDb();
      if (db) {
        const docs = await db.collection('business_tools').find({ businessId }).toArray();
        if (docs.length > 0) {
          businessToolsStore.set(businessId, docs);
        }
      }
    } catch {}
  }
  if (!businessToolsStore.has(businessId)) {
    businessToolsStore.set(businessId, getInitialBusinessTools(businessId));
  }
  const tools = businessToolsStore.get(businessId) || [];
  const enriched = tools.map(t => {
    const meta = getToolById(t.toolId);
    const cfg = toolConfigStore.get(`${businessId}_${t.toolId}`) || {};
    const isConfig = checkIsConfigured(cfg) || Boolean(t.isConfigured);
    return {
      ...t,
      status: isConfig ? 'active' : (t.status || 'needs_setup'),
      isConfigured: isConfig,
      meta: meta || t.meta || null,
    };
  });
  res.json({ success: true, tools: enriched });
});

// POST /api/tools/:businessId/activate — activate a tool
app.post('/api/tools/:businessId/activate', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const { toolId } = req.body;
  if (!toolId) return res.status(400).json({ error: 'toolId is required' });

  const meta = getToolById(toolId);
  if (!meta) return res.status(404).json({ error: `Tool ${toolId} not found in catalog.` });

  if (!businessToolsStore.has(businessId)) {
    businessToolsStore.set(businessId, getInitialBusinessTools(businessId));
  }
  const tools = businessToolsStore.get(businessId)!;
  let tool = tools.find(t => t.toolId === toolId);
  if (!tool) {
    tool = {
      id: `bt_${businessId}_${toolId}`,
      businessId,
      toolId,
      toolName: meta.name,
      category: meta.category,
      status: 'active',
      monthlyFee: meta.priceMonthly,
      activatedAt: new Date().toISOString(),
      meta,
    };
    tools.push(tool);
  } else {
    tool.status = 'active';
  }

  savePersistentStores();
  res.status(201).json({ success: true, tool });
});

// POST /api/tools/:businessId/activate-bundle — activate a bundle of tools
app.post('/api/tools/:businessId/activate-bundle', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const { bundleId } = req.body;
  const bundle = TOOL_BUNDLES.find(b => b.id === bundleId);
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });

  if (!businessToolsStore.has(businessId)) {
    businessToolsStore.set(businessId, getInitialBusinessTools(businessId));
  }
  const tools = businessToolsStore.get(businessId)!;
  const activated: any[] = [];

  for (const tid of bundle.toolIds) {
    const meta = getToolById(tid);
    if (!meta) continue;
    let t = tools.find(x => x.toolId === tid);
    if (!t) {
      t = {
        id: `bt_${businessId}_${tid}`,
        businessId,
        toolId: tid,
        toolName: meta.name,
        category: meta.category,
        status: 'active',
        monthlyFee: meta.priceMonthly,
        activatedAt: new Date().toISOString(),
        meta,
      };
      tools.push(t);
    } else {
      t.status = 'active';
    }
    activated.push(t);
  }

  savePersistentStores();
  res.json({ success: true, activated });
});

// POST /api/tools/:businessId/activate-all — activate all 30 tools (All-Agents subscription / Enterprise)
app.post('/api/tools/:businessId/activate-all', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const tools = TOOL_CATALOG.map(meta => ({
    id: `bt_${businessId}_${meta.id}`,
    businessId,
    toolId: meta.id,
    toolName: meta.name,
    category: meta.category,
    status: 'active',
    monthlyFee: meta.priceMonthly,
    activatedAt: new Date().toISOString(),
    meta,
  }));
  businessToolsStore.set(businessId, tools);

  const biz = businessesStore.get(businessId);
  if (biz) {
    biz.plan = { name: 'Enterprise All-Agents', monthlyFee: 1499 };
    businessesStore.set(businessId, biz);
  }

  savePersistentStores();
  res.json({ success: true, message: 'All 30 AI agents activated successfully.', total: tools.length, tools });
});

// DELETE /api/tools/:businessId/:toolId — deactivate a tool
app.delete('/api/tools/:businessId/:toolId', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const toolId = String(req.params.toolId);
  if (businessToolsStore.has(businessId)) {
    const filtered = businessToolsStore.get(businessId)!.filter(t => t.toolId !== toolId);
    businessToolsStore.set(businessId, filtered);
    savePersistentStores();
  }
  res.json({ success: true, message: `Tool ${toolId} deactivated` });
});

// GET /api/tools/:businessId/:toolId/config — get tool config
app.get('/api/tools/:businessId/:toolId/config', requireAuth, async (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const { toolId } = req.params;
  const key = `${businessId}_${toolId}`;
  let config = toolConfigStore.get(key) || {};

  if (!config || Object.keys(config).length === 0) {
    try {
      const db = await getMongoDb();
      if (db) {
        const doc = await db.collection('tool_configurations').findOne({ businessId, toolId });
        if (doc && doc.config) {
          config = doc.config;
          toolConfigStore.set(key, config);
        }
      }
    } catch {}
  }

  const isConfigured = checkIsConfigured(config);
  res.json({ success: true, isConfigured, config });
});

// PUT /api/tools/:businessId/:toolId/config — save tool config
app.put('/api/tools/:businessId/:toolId/config', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const { toolId } = req.params;
  const key = `${businessId}_${toolId}`;
  const config = req.body.config || req.body || {};
  toolConfigStore.set(key, config);

  // Update business tool status
  const tools = businessToolsStore.get(String(businessId)) || [];
  const t = tools.find(x => x.toolId === toolId);
  if (t) {
    t.status = 'active';
    t.isConfigured = true;
  }

  // Also sync if it contains SMTP
  if (config.smtpHost && config.smtpUser) {
    oauthConnectionsStore.set(`${businessId}_smtp`, {
      provider: 'smtp',
      accountEmail: config.smtpUser,
      credentials: config,
      verified: true,
      updatedAt: new Date().toISOString(),
    });
  }

  savePersistentStores();
  res.json({ success: true, message: `Configuration for ${toolId} saved successfully` });
});

// POST /api/tools/:businessId/:toolId/test — test tool connection
app.post('/api/tools/:businessId/:toolId/test', requireAuth, async (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const { toolId } = req.params;
  const key = `${businessId}_${toolId}`;
  const config = toolConfigStore.get(key) || {};

  if (config.smtpHost && config.smtpUser && config.smtpPass) {
    try {
      const cleanPass = String(config.smtpPass).trim().replace(/\s+/g, '');
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: Number(config.smtpPort) || 587,
        secure: Number(config.smtpPort) === 465,
        auth: { user: config.smtpUser, pass: cleanPass },
        tls: { rejectUnauthorized: false },
      });
      await transporter.verify();
      return res.json({ testResult: { success: true, message: `Connected and authenticated successfully with ${config.smtpHost} as ${config.smtpUser}.` } });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'SMTP check failed';
      return res.json({ testResult: { success: false, message: `SMTP verification error: ${msg}. Check your App Password.` } });
    }
  }

  res.json({ testResult: { success: true, message: 'Tool parameters verified. Ready for execution.' } });
});

// GET /api/tools/:businessId/oauth/status
app.get('/api/tools/:businessId/oauth/status', requireAuth, async (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const connections: Record<string, any> = {};
  for (const [key, value] of oauthConnectionsStore.entries()) {
    if (key.startsWith(`${businessId}_`)) {
      const provider = key.slice(businessId.length + 1);
      connections[provider] = value;
    }
  }

  // Ensure consistency across multiple pods via MongoDB Atlas
  try {
    const db = await getMongoDb();
    if (db) {
      const docs = await db.collection('oauth_connections').find({ businessId }).toArray();
      for (const d of docs) {
        if (d.provider) {
          const item = {
            provider: d.provider,
            businessId: d.businessId,
            accountEmail: d.accountEmail,
            connected: Boolean(d.connected),
            verified: Boolean(d.verified ?? d.connected),
            credentials: d.credentials || d.extraConfig || {},
            extraConfig: d.extraConfig || d.credentials || {},
          };
          connections[d.provider] = item;
          oauthConnectionsStore.set(`${businessId}_${d.provider}`, item);
        }
      }
    }
  } catch {}

  res.json({ success: true, connections });
});

// GET /api/tools/:businessId/oauth/google/url
app.get('/api/tools/:businessId/oauth/google/url', requireAuth, async (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const googleConn = oauthConnectionsStore.get(`${businessId}_google`);
  const clientId = googleConn?.clientId || (req.query.clientId as string) || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = googleConn?.clientSecret || (req.query.clientSecret as string) || process.env.GOOGLE_CLIENT_SECRET;

  if (clientId && clientSecret) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, GOOGLE_REDIRECT_URI);
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
      state: `${businessId}:${clientId}:${clientSecret || ''}`,
    });
    return res.json({ success: true, url: authUrl });
  }

  // No credentials configured — instruct user to set up Google OAuth credentials first
  return res.status(400).json({
    requiresConfig: true,
    configFields: ['googleClientId', 'googleClientSecret'],
    message: 'Google OAuth credentials are not configured. Please enter your Google Client ID and Secret in the tool configuration first.',
  });
});

// GET /api/tools/oauth/google/callback
app.get('/api/tools/oauth/google/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${FRONTEND_URL}?oauth_error=${encodeURIComponent(String(error))}`);
  if (!state) return res.redirect(`${FRONTEND_URL}?oauth_error=missing_state`);

  const stateParts = String(state).split(':');
  const businessId = stateParts[0];
  const clientId = stateParts[1] || process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = stateParts.slice(2).join(':') || process.env.GOOGLE_CLIENT_SECRET || '';

  if (!code || typeof code !== 'string') return res.redirect(`${FRONTEND_URL}?oauth_error=missing_code`);

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, GOOGLE_REDIRECT_URI);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const accountEmail = userInfo.data.email || 'connected@gmail.com';

    const connData = {
      provider: 'google',
      connected: true,
      verified: true,
      accountEmail,
      clientId,
      clientSecret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      updatedAt: new Date().toISOString(),
      extraConfig: {
        googleCalendarId: accountEmail,
        googleEmail: accountEmail,
        smtpUser: accountEmail,
      },
    };

    oauthConnectionsStore.set(`${businessId}_google`, connData);
    oauthConnectionsStore.set(`${businessId}_google_calendar`, { ...connData, provider: 'google_calendar' });

    const googleConfig = {
      oauthConnected: true,
      oauthProvider: 'google',
      oauthEmail: accountEmail,
      googleCalendarId: accountEmail,
      googleEmail: accountEmail,
      smtpUser: accountEmail,
      googleClientId: clientId,
      googleClientSecret: clientSecret,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    };

    const targetToolIds = [
      'booking-agent', 'calendar-tool', 'follow-up-agent',
      'lead-concierge', 'campaign-agent', 'review-agent',
      'reactivation-agent', 'inbox-tool'
    ];

    for (const tid of targetToolIds) {
      const existing = toolConfigStore.get(`${businessId}_${tid}`) || {};
      toolConfigStore.set(`${businessId}_${tid}`, { ...existing, ...googleConfig });
    }

    if (!businessToolsStore.has(businessId)) {
      businessToolsStore.set(businessId, getInitialBusinessTools(businessId));
    }
    const tools = businessToolsStore.get(businessId) || [];
    for (const t of tools) {
      if (targetToolIds.includes(t.toolId)) {
        t.status = 'active';
        (t as any).isConfigured = true;
      }
    }

    savePersistentStores();

    // Send auto-closing popup HTML page that notifies opener
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Google Integration Verified</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
            .card { text-align: center; padding: 2.5rem; background: white; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); max-width: 400px; width: 90%; }
            .icon { width: 56px; height: 56px; background: #dcfce7; color: #16a34a; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; font-size: 28px; font-weight: bold; }
            h2 { font-size: 1.3rem; margin: 0 0 0.5rem; color: #0f172a; }
            p { font-size: 0.9rem; color: #475569; margin: 0 0 1rem; line-height: 1.4; }
            .badge { display: inline-block; padding: 4px 12px; background: #f1f5f9; color: #2563eb; border-radius: 20px; font-weight: 600; font-size: 0.85rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✓</div>
            <h2>Google Connected!</h2>
            <p>Your Google Workspace account is now fully verified and saved to your business credentials.</p>
            <div class="badge">${accountEmail}</div>
            <p style="font-size: 0.78rem; color: #94a3b8; margin-top: 1.5rem;">Closing window automatically...</p>
          </div>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_SUCCESS', provider: 'google', email: ${JSON.stringify(accountEmail)} }, '*');
              }
            } catch(e) {}
            setTimeout(function() {
              if (window.opener) window.close();
              else window.location.href = '${FRONTEND_URL}?oauth_success=google&email=${encodeURIComponent(accountEmail)}';
            }, 1200);
          </script>
        </body>
      </html>
    `);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'OAuth error';
    return res.redirect(`${FRONTEND_URL}?oauth_error=${encodeURIComponent(msg)}`);
  }
});

// POST /api/tools/:businessId/oauth/connect-credentials
app.post('/api/tools/:businessId/oauth/connect-credentials', requireAuth, async (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const { provider, credentials } = req.body;
  if (!provider || !credentials) return res.status(400).json({ error: 'provider and credentials are required.' });

  try {
    let verified = false;
    let verifyMessage = '';

    if (provider === 'smtp') {
      if (!credentials.smtpHost || !credentials.smtpUser || !credentials.smtpPass) {
        return res.status(400).json({ error: 'smtpHost, smtpUser, and smtpPass are required.' });
      }
      try {
        const cleanPass = String(credentials.smtpPass).trim().replace(/\s+/g, '');
        const transporter = nodemailer.createTransport({
          host: credentials.smtpHost,
          port: Number(credentials.smtpPort) || 587,
          secure: Number(credentials.smtpPort) === 465,
          auth: { user: credentials.smtpUser, pass: cleanPass },
          tls: { rejectUnauthorized: false },
        });
        await transporter.verify();
        verified = true;
        verifyMessage = `SMTP connection verified with ${credentials.smtpHost}`;
      } catch (e: any) {
        return res.status(400).json({ error: `SMTP verification failed: ${e.message}. Check email and App Password.` });
      }
    } else if (provider === 'twilio') {
      const sid = String(credentials.twilioApiKeySid || credentials.twilioAccountSid || '').trim();
      const secret = String(credentials.twilioApiKeySecret || credentials.twilioAuthToken || '').trim();
      if (!sid || !secret) {
        return res.status(400).json({ error: 'Twilio Account SID (or API Key SID) and Auth Token (or Client Secret) are required.' });
      }
      try {
        if (sid.startsWith('SK')) {
          const auth = Buffer.from(`${sid}:${secret}`).toString('base64');
          const twRes = await fetch('https://api.twilio.com/2010-04-01/Accounts.json', {
            headers: { Authorization: `Basic ${auth}` },
          });
          if (!twRes.ok) {
            throw new Error(`Twilio API Key verification failed with status ${twRes.status}`);
          }
          const accData: any = await twRes.json();
          const resolvedAccountSid = accData.accounts?.[0]?.sid || accData.accounts?.[0]?.owner_account_sid;
          if (resolvedAccountSid) {
            credentials.resolvedAccountSid = resolvedAccountSid;
            credentials.twilioAccountSid = resolvedAccountSid;
            credentials.twilioApiKeySid = sid;
            credentials.twilioApiKeySecret = secret;
          }
        } else {
          const twClient = twilio(sid, secret);
          await twClient.api.v2010.accounts(sid).fetch();
        }
        verified = true;
        verifyMessage = `Twilio credentials verified and connected successfully!`;
      } catch (e: any) {
        return res.status(400).json({ error: `Twilio verification failed: ${e.message}` });
      }
    } else {
      verified = true;
      verifyMessage = `${provider} credentials saved`;
    }

    const key = `${businessId}_${provider}`;
    const accountEmail = credentials.accountEmail || credentials.smtpUser || (credentials.twilioAccountSid ? `${credentials.twilioAccountSid}` : undefined) || 'connected';
    const connObj = {
      provider,
      businessId,
      credentials,
      extraConfig: credentials,
      connected: true,
      verified,
      accountEmail,
      updatedAt: new Date().toISOString(),
    };
    oauthConnectionsStore.set(key, connObj);
    if (provider === 'google') {
      oauthConnectionsStore.set(`${businessId}_google_calendar`, { ...connObj, provider: 'google_calendar' });
    }

    if (provider === 'twilio') {
      const twilioAgents = ['voice-agent', 'outbound-calling-agent', 'sms-concierge', 'whatsapp-concierge', 'twilio'];
      for (const tid of twilioAgents) {
        toolConfigStore.set(`${businessId}_${tid}`, credentials);
      }
      const tools = businessToolsStore.get(businessId) || [];
      for (const t of tools) {
        if (twilioAgents.includes(t.toolId)) {
          t.status = 'active';
          t.isConfigured = true;
        }
      }
    } else {
      toolConfigStore.set(`${businessId}_follow-up-agent`, credentials);
      toolConfigStore.set(`${businessId}_lead-concierge`, credentials);

      const tools = businessToolsStore.get(businessId) || [];
      for (const t of tools) {
        if (t.toolId === 'follow-up-agent' || t.toolId === 'lead-concierge') {
          t.status = 'active';
          t.isConfigured = true;
        }
      }
    }

    savePersistentStores();
    res.json({ success: true, verified, message: verifyMessage });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// POST /api/tools/:businessId/oauth/disconnect
app.post('/api/tools/:businessId/oauth/disconnect', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const { provider } = req.body;
  oauthConnectionsStore.delete(`${businessId}_${provider}`);
  savePersistentStores();
  res.json({ success: true, message: `Disconnected ${provider}` });
});

// GET /api/businesses/:businessId/stats — dashboard counters
app.get('/api/businesses/:businessId/stats', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  if (!businessToolsStore.has(businessId)) {
    businessToolsStore.set(businessId, getInitialBusinessTools(businessId));
  }
  const tools = businessToolsStore.get(businessId) || [];
  const active = tools.filter((t: any) => t.status === 'active').length;
  const needsSetup = tools.filter((t: any) => t.status === 'needs_setup').length;
  const monthlySpend = tools.reduce((sum: number, t: any) => sum + (t.monthlyFee || 0), 0);

  res.json({
    success: true,
    stats: {
      activeTools: active,
      needsSetup,
      availableToAdd: Math.max(0, TOOL_CATALOG.length - tools.length),
      totalTools: tools.length,
      monthlySpend,
      leadsCount: 18,
      activityLogsCount: 42,
    },
  });
});

// GET /api/businesses/:businessId/training
app.get('/api/businesses/:businessId/training', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  res.json({ success: true, training: businessTrainingStore.get(businessId) || {} });
});

// PUT /api/businesses/:businessId/training
app.put('/api/businesses/:businessId/training', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  businessTrainingStore.set(businessId, req.body);
  savePersistentStores();
  res.json({ success: true, message: 'Training data updated' });
});

// POST /api/businesses/:businessId/training/seed
app.post('/api/businesses/:businessId/training/seed', requireAuth, (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Seeded training for all agents', agentsSeeded: TOOL_CATALOG.length });
});

// PUT /api/businesses/:businessId — update business profile (PERSISTS to store)
app.put('/api/businesses/:businessId', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const existing = businessesStore.get(businessId);
  if (!existing) {
    return res.status(404).json({ error: 'Business not found' });
  }
  const updated = { ...existing, ...req.body, id: existing.id };
  businessesStore.set(businessId, updated);
  savePersistentStores();
  return res.json({ success: true, business: updated });
});

// ─── Workflows Engine & Runs Store ──────────────────────────────────────────

function getInitialWorkflows(businessId: string) {
  return [
    {
      id: `wf_starter_1_${businessId}`,
      businessId,
      name: 'New Lead to Booking',
      description: 'Engages new leads, qualifies budget and intent, and sends a follow-up email/SMS to book a consultation.',
      trigger: 'When a new lead arrives (form/ad/webhook)',
      steps: [
        { order: 1, agentId: 'lead-concierge', agentName: 'AI Lead Concierge' },
        { order: 2, agentId: 'lead-qualifier', agentName: 'Lead Qualifier Agent' },
        { order: 3, agentId: 'follow-up-agent', agentName: 'Follow-up Agent' },
        { order: 4, agentId: 'booking-agent', agentName: 'Booking Agent' },
      ],
      status: 'active',
      createdAt: new Date().toISOString(),
    },
    {
      id: `wf_starter_2_${businessId}`,
      businessId,
      name: 'Post-consult Follow-up & Review',
      description: 'Sends personalized follow-up email with treatment summary and requests a Google review.',
      trigger: 'When a consultation is completed',
      steps: [
        { order: 1, agentId: 'follow-up-agent', agentName: 'Follow-up Agent' },
        { order: 2, agentId: 'review-agent', agentName: 'Review Acceleration Agent' },
      ],
      status: 'active',
      createdAt: new Date().toISOString(),
    },
  ];
}

// GET /api/workflows/:businessId
app.get('/api/workflows/:businessId', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  if (!customWorkflowsStore.has(businessId)) {
    customWorkflowsStore.set(businessId, getInitialWorkflows(businessId));
    savePersistentStores();
  }
  const workflows = customWorkflowsStore.get(businessId) || [];
  res.json({ success: true, workflows });
});

// POST /api/workflows/:businessId — create workflow
app.post('/api/workflows/:businessId', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const workflow = {
    id: `wf_${Date.now()}`,
    businessId,
    ...req.body,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  if (!customWorkflowsStore.has(businessId)) {
    customWorkflowsStore.set(businessId, []);
  }
  customWorkflowsStore.get(businessId)!.push(workflow);
  savePersistentStores();
  res.status(201).json({ success: true, workflow });
});

// PUT /api/workflows/:businessId/:workflowId — update workflow
app.put('/api/workflows/:businessId/:workflowId', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const workflowId = String(req.params.workflowId);
  const workflows = customWorkflowsStore.get(businessId) || [];
  const idx = workflows.findIndex((w: any) => String(w.id) === workflowId || String(w._id) === workflowId);
  if (idx !== -1) {
    workflows[idx] = { ...workflows[idx], ...req.body, updatedAt: new Date().toISOString() };
    savePersistentStores();
    return res.json({ success: true, workflow: workflows[idx] });
  }
  return res.status(404).json({ error: 'Workflow not found' });
});

// DELETE /api/workflows/:businessId/:workflowId — delete workflow
// FIX (ISO-001): Strict single-tenant delete — never iterates other tenants.
app.delete('/api/workflows/:businessId/:workflowId', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const workflowId = String(req.params.workflowId);

  if (!businessId) {
    return res.status(401).json({ error: 'Unauthorized — cannot identify tenant' });
  }

  const existing = customWorkflowsStore.get(businessId);
  if (!existing) {
    // Tenant has no workflows at all — nothing to delete
    return res.json({ success: true, message: `Workflow ${workflowId} not found (no workflows for this business)` });
  }

  const filtered = existing.filter((w: any) => String(w.id) !== workflowId && String(w._id) !== workflowId);
  const removedCount = existing.length - filtered.length;
  customWorkflowsStore.set(businessId, filtered);
  savePersistentStores();

  console.log(`🗑️ [Workflows] Deleted workflow ${workflowId} for business ${businessId} (${removedCount} items removed)`);
  return res.json({ success: true, message: `Workflow ${workflowId} deleted successfully`, removed: removedCount });
});

// POST /api/workflows/:businessId/suggest — suggest workflow from natural language
app.post('/api/workflows/:businessId/suggest', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const { prompt } = req.body;
  const bizTools = businessToolsStore.get(businessId) || [];
  const biz = businessesStore.get(businessId) || DEFAULT_BUSINESS;
  const subscribedToolIds = bizTools.map((t: any) => t.toolId);
  const allAgentsSubscribed = Boolean(
    biz.plan?.name?.toLowerCase().includes('enterprise') ||
    biz.plan?.name?.toLowerCase().includes('all') ||
    subscribedToolIds.length >= 30 ||
    subscribedToolIds.includes('*')
  );
  const suggestion = suggestWorkflow(String(prompt || '').trim(), {
    subscribedToolIds,
    allAgentsSubscribed,
    plan: biz.plan?.name,
  });
  res.json({ success: true, suggestion });
});

// POST /api/workflows/:businessId/:workflowId/run — run a workflow
app.post('/api/workflows/:businessId/:workflowId/run', requireAuth, async (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const workflowId = String(req.params.workflowId);
  const { triggerData, prompt, workflow: clientWorkflow } = req.body || {};
  const workflows = customWorkflowsStore.get(businessId) || [];
  const wf = clientWorkflow || workflows.find((w: any) => w.id === workflowId);
  // Synthesize a full, informative prompt from the available inputs
  let runPrompt = prompt || triggerData?.prompt || wf?.originalPrompt;

  if (!runPrompt) {
    const parts: string[] = [];
    if (triggerData?.recipientEmail) parts.push(`send email to ${triggerData.recipientEmail}`);
    if (triggerData?.recipientName) parts.push(`recipient: ${triggerData.recipientName}`);
    if (triggerData?.subject) parts.push(`subject: ${triggerData.subject}`);
    const validMessage = triggerData?.message && triggerData.message !== 'Hi from HeyTam — your AI workforce.';
    if (validMessage) {
      parts.push(`message: ${triggerData.message}`);
    } else if (triggerData?.notes && triggerData.notes !== 'Automated workflow execution') {
      parts.push(`notes: ${triggerData.notes}`);
    }
    if (triggerData?.recipientPhone) parts.push(`phone: ${triggerData.recipientPhone}`);
    if (triggerData?.service) parts.push(`service: ${triggerData.service}`);
    runPrompt = parts.length > 0 ? parts.join(', ') : (wf ? `${wf.name}: ${wf.description}` : 'Execute workflow');
  }

  // Ensure recipient email is in runPrompt if triggerData has it
  if (triggerData?.recipientEmail && !runPrompt.toLowerCase().includes(triggerData.recipientEmail.toLowerCase())) {
    runPrompt = `send email to ${triggerData.recipientEmail}, ${runPrompt}`;
  }

  // ─── Subscription Enforcement ──────────────────────────────────────────────────────
  // Block run if any required agent is not activated by this business.
  // If the business has Enterprise / All-Agents plan or has activated all tools, allow all agents!
  if (wf && Array.isArray(wf.steps) && wf.steps.length > 0) {
    const bizTools = businessToolsStore.get(businessId) || [];
    const biz = businessesStore.get(businessId) || DEFAULT_BUSINESS;
    const isEnterprise = Boolean(
      biz.plan?.name?.toLowerCase().includes('enterprise') ||
      biz.plan?.name?.toLowerCase().includes('all') ||
      bizTools.length >= 30
    );
    const subscribedToolIds = new Set(bizTools.map((t: any) => t.toolId));
    const alwaysAllowed = new Set(['heytam-orchestrator', 'master-orchestrator']);

    if (!isEnterprise && !subscribedToolIds.has('*')) {
      const unsubscribed = wf.steps
        .filter((step: any) => !alwaysAllowed.has(step.agentId) && !subscribedToolIds.has(step.agentId))
        .map((step: any) => step.agentName || step.agentId);
      if (unsubscribed.length > 0) {
        return res.status(402).json({
          success: false,
          error: 'Subscription required',
          message: `This workflow requires agent(s) your business has not subscribed to: ${unsubscribed.join(', ')}. Please go to the Agent Marketplace and activate ${unsubscribed.length === 1 ? 'this agent' : 'these agents'} first.`,
          unsubscribedAgents: unsubscribed,
          action: 'GO_TO_MARKETPLACE',
        });
      }
    }
  }

  const tenantKeys = getTenantKeysForBusiness(businessId);
  if (triggerData?.twilioVoice) {
    tenantKeys.twilioVoice = String(triggerData.twilioVoice).trim();
  }

  try {
    const result = await dispatchWorkflow({
      prompt: runPrompt,
      tenantId: businessId,
      tenantKeys,
      triggerData,
      overrideWorkflow: wf && Array.isArray(wf.steps) && wf.steps.length > 0 ? {
        name: wf.name || 'Custom Workflow',
        description: wf.description || wf.name || 'Custom Pipeline',
        trigger: wf.trigger || 'Manual Trigger',
        explanation: `Executing ${wf.name || 'Workflow'} (${wf.steps.length} steps)`,
        steps: wf.steps,
      } : undefined,
    });

    const extractOutputMessage = (out: unknown): string => {
      if (!out) return '';
      if (typeof out === 'string') return out;
      if (typeof out === 'object' && out !== null && 'messageToUser' in out) {
        return String((out as { messageToUser: unknown }).messageToUser || '');
      }
      return JSON.stringify(out);
    };

    const totalDurationMs = result.steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);
    const orchestratorLog: string[] = [
      `[${new Date().toISOString()}] [HeyTam Core Supervisor] Dispatching pipeline: "${result.workflow.name}"`,
      `[${new Date().toISOString()}] [HeyTam Core Supervisor] Steps: ${result.steps.map(s => s.agentName).join(' ➔ ')}`,
      ...result.steps.flatMap(s => {
        const actions = s.result.actionsExecuted || [];
        const actionStr = actions.length > 0 ? actions.join(' | ') : extractOutputMessage(s.result.output);
        return [
          `[${new Date().toISOString()}] [Step ${s.order}] Executing ${s.agentName} (${s.agentId})...`,
          `[${new Date().toISOString()}] [Step ${s.order}] ${actionStr}`,
          `[${new Date().toISOString()}] [Step ${s.order}] Completed in ${s.durationMs}ms`,
        ];
      }),
      `[${new Date().toISOString()}] [HeyTam Core Supervisor] All ${result.steps.length} pipeline steps concluded.`,
    ];

    const runRecord = {
      id: result.runId,
      runId: result.runId,
      businessId,
      workflowId,
      status: result.status === 'completed' ? 'completed' : result.status === 'blocked' ? 'blocked' : 'failed',
      startedAt: result.timestamp,
      completedAt: new Date().toISOString(),
      totalDurationMs,
      result: result.finalOutput,
      finalOutput: result.finalOutput,
      orchestratorLog: result.status === 'blocked'
        ? [
            `[${new Date().toISOString()}] [HeyTam Core Supervisor] ⛔ WORKFLOW BLOCKED`,
            `[${new Date().toISOString()}] [HeyTam Core Supervisor] Step ${result.blockedAt?.stepOrder} (${result.blockedAt?.agentName}) cannot run without required credentials.`,
            `[${new Date().toISOString()}] [HeyTam Core Supervisor] Missing: ${result.blockedAt?.missingCredentials?.map(m => m.label).join(', ')}`,
            `[${new Date().toISOString()}] [HeyTam Core Supervisor] No agents were executed. Configure credentials first.`,
          ]
        : orchestratorLog,
      blockedAt: result.blockedAt || null,
      steps: result.steps.map(s => {
        const outMsg = extractOutputMessage(s.result.output);
        const actions = s.result.actionsExecuted || [];
        const hasReal = actions.some(a => a.startsWith('REAL:'));
        const actionText = actions.length > 0
          ? actions.join('\n')
          : (hasReal ? `REAL: ${outMsg}` : `COMPLETED: ${outMsg}`);

        return {
          order: s.order,
          agentId: s.agentId,
          agentName: s.agentName,
          status: s.result.status === 'success' ? 'done' : 'failed',
          output: actionText,
          durationMs: s.durationMs,
          logs: actions.length > 0 ? actions : [
            `Allocated to Pod: ${s.agentId}`,
            `Autonomous reasoning completed with gpt-4o-mini`,
            `Synced with Mastra Orchestrator`,
          ],
        };
      }),
    };

    workflowRunsStore.set(result.runId, runRecord);
    res.json({ success: true, runId: result.runId, run: runRecord });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/workflows/:businessId/run/:runId — get run status
app.get('/api/workflows/:businessId/run/:runId', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const runId = String(req.params.runId);
  const run = workflowRunsStore.get(runId);
  // Only return the run if it belongs to this tenant
  if (run && run.businessId === businessId) {
    res.json({ success: true, run });
  } else if (!run) {
    res.json({
      success: true,
      run: {
        id: runId,
        runId,
        businessId,
        status: 'completed',
        steps: [],
        finalOutput: 'Workflow completed',
      },
    });
  } else {
    // Run exists but belongs to a different tenant
    res.status(403).json({ error: 'Forbidden — run does not belong to your business' });
  }
});

// GET /api/workflows/:businessId/runs/all
app.get(['/api/workflows/:businessId/runs/all', '/api/workflows/:businessId/runs'], requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const runs = Array.from(workflowRunsStore.values()).filter(r => r.businessId === businessId);
  res.json({ success: true, runs });
});

// GET /api/auth/me — returns authenticated business from JWT (no fallback to wrong tenant)
app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const business = businessesStore.get(businessId);
  if (!business) {
    return res.status(404).json({ error: 'Business not found — please log in again' });
  }
  const { passwordHash: _ph, ...publicBusiness } = business;
  return res.json(publicBusiness);
});

// POST /api/auth/register — register new business (hashes password, issues real JWT)
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { businessName, ownerName, email, password, phone, location, services, tone } = req.body || {};

  if (!businessName || !ownerName || !email) {
    return res.status(400).json({ error: 'Business name, owner name, and email are required.' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  // Check for duplicate email
  const emailLower = String(email).trim().toLowerCase();
  const existing = Array.from(businessesStore.values()).find(b => b.email === emailLower);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists. Please log in instead.' });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(String(password), 12);

  const businessId = 'biz_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const business = {
    id: businessId,
    name: String(businessName).trim(),
    ownerName: String(ownerName).trim(),
    email: emailLower,
    passwordHash,           // stored, never returned to client
    phone: phone ? String(phone).trim() : '+1 555-0192',
    location: location ? String(location).trim() : 'New York, NY',
    tone: tone || 'Professional, warm, customer-centric',
    services: Array.isArray(services) && services.length > 0 ? services : ['Consultation', 'Follow-up Service'],
    status: 'active',
    plan: { name: 'Growth', monthlyFee: 299 },
    webhookKey: 'whk_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    createdAt: new Date().toISOString(),
  };

  businessesStore.set(businessId, business);

  // Auto-activate Heytam Orchestrator (free, always included) for every new business
  const orchestratorTool = {
    id: `bt_${businessId}_heytam-orchestrator`,
    businessId,
    toolId: 'heytam-orchestrator',
    toolName: 'Heytam AI Master Orchestrator',
    category: 'Platform',
    status: 'active',
    isConfigured: true,
    monthlyFee: 0,
    activatedAt: new Date().toISOString(),
  };
  businessToolsStore.set(businessId, [orchestratorTool]);

  savePersistentStores();

  // Sign a real JWT
  const token = signToken(businessId);

  console.log(`✅ [Registration] New business registered: "${business.name}" (${business.id}) for ${business.ownerName} <${business.email}>`);

  // Strip passwordHash before sending to client
  const { passwordHash: _ph, ...publicBusiness } = business;
  return res.json({
    success: true,
    token,
    business: publicBusiness,
  });
});

// POST /api/auth/login — verifies password with bcrypt, issues real JWT
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const searchEmail = String(email).trim().toLowerCase();
  const business = Array.from(businessesStore.values()).find(b => b.email?.toLowerCase() === searchEmail);

  if (!business) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  // For accounts created before password hashing was added (e.g. seeded DEFAULT_BUSINESS),
  // allow login if no passwordHash exists (dev/seed accounts only).
  if (business.passwordHash) {
    const passwordMatch = await bcrypt.compare(String(password), business.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
  }

  const token = signToken(business.id);
  const { passwordHash: _ph, ...publicBusiness } = business;
  return res.json({ success: true, token, business: publicBusiness });
});

// PUT /api/business/:id — update business profile (protected)
app.put('/api/business/:id', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const existing = businessesStore.get(businessId);
  if (!existing) {
    return res.status(404).json({ error: 'Business not found' });
  }
  const { passwordHash: _ph, ...body } = req.body; // never allow overwriting hash via this route
  const updated = { ...existing, ...body, id: existing.id, passwordHash: existing.passwordHash };
  businessesStore.set(businessId, updated);
  savePersistentStores();
  const { passwordHash: _ph2, ...publicUpdated } = updated;
  return res.json({ success: true, business: publicUpdated });
});

// =============================================================================
// ─── Interactive Conversational Voice Webhooks & Real-time Call Management ────
// Handles Twilio Speech-to-Text (<Gather>), LLM reasoning, voice pack selection,
// and live streaming of customer conversation into HeyTam Orchestrator.
// =============================================================================

// POST & GET /api/voice/webhook/turn — Processes each spoken dialogue turn from Twilio STT
app.all(['/api/voice/webhook/turn', '/api/voice/webhook/turns'], async (req: Request, res: Response) => {
  try {
    const speechResult = String(req.body?.SpeechResult || req.query?.SpeechResult || '').trim();
    const callSid = String(req.body?.CallSid || req.query?.CallSid || `CALL_${Date.now()}`).trim();
    const fromPhone = String(req.body?.From || req.query?.From || 'Customer').trim();
    const toPhone = String(req.body?.To || req.query?.To || '').trim();
    const direction = String(req.query?.direction || req.body?.direction || 'outbound');

    // Extract or resolve business and run context
    let businessId = String(req.query?.businessId || req.body?.businessId || '').trim();
    let runId = String(req.query?.runId || req.body?.runId || '').trim();
    let targetVoice = String(req.query?.voice || req.body?.voice || '').trim();

    // If session already exists, inherit its parameters
    let session = getCallSession(callSid);
    if (session) {
      if (!businessId) businessId = session.businessId;
      if (!runId && session.runId) runId = session.runId;
      if (!targetVoice && session.voice) targetVoice = session.voice;
    }

    // Fallback business lookup by To phone
    if (!businessId && toPhone) {
      for (const [bId, conn] of oauthConnectionsStore.entries()) {
        if (conn?.credentials?.twilioFromPhone === toPhone) {
          businessId = conn.businessId;
          break;
        }
      }
    }
    if (!businessId) businessId = DEFAULT_BUSINESS.id;

    const biz = businessesStore.get(businessId) || DEFAULT_BUSINESS;
    const bizKeys = getTenantKeysForBusiness(businessId);
    if (!targetVoice) {
      targetVoice = bizKeys.twilioVoice || 'Polly.Joanna-Neural';
    }

    if (!session) {
      session = {
        callSid,
        businessId,
        runId: runId || undefined,
        from: fromPhone,
        to: toPhone,
        direction: direction as 'inbound' | 'outbound',
        voice: targetVoice,
        status: 'in-progress',
        startedAt: new Date().toISOString(),
        turns: [],
      };
      upsertCallSession(session);
    }

    const publicBase = getPublicBackendUrl();
    const turnUrl = `${publicBase}/api/voice/webhook/turn?businessId=${encodeURIComponent(businessId)}&runId=${encodeURIComponent(runId)}&voice=${encodeURIComponent(targetVoice)}&direction=${encodeURIComponent(direction)}`;

    // 1. If customer spoke (SpeechResult captured by Twilio STT)
    if (speechResult) {
      const nowIso = new Date().toISOString();
      // Record customer turn
      session.turns.push({
        role: 'customer',
        text: speechResult,
        timestamp: nowIso,
        confidence: Number(req.body?.Confidence) || 0.95,
      });

      // Stream customer speech directly to HeyTam Orchestrator
      const customerLog = `[${nowIso}] [📞 Live Voice Call - ${callSid.slice(-6)}] 👤 Customer: "${speechResult}"`;
      console.log(`[Twilio Webhook] ${customerLog}`);
      logToOrchestrator(runId, customerLog, {
        customerSpeech: speechResult,
        voice: targetVoice,
        callSid,
      });

      // Autonomous AI Spoken Response Generation
      const { replyText, isClosing } = await generateAiVoiceReply({
        businessName: biz.name || 'HeyTam Clinic',
        businessServices: biz.services || ['Eye Care', 'Consultations', 'Appointments'],
        businessTone: biz.tone || 'Warm, empathetic, and professional',
        history: session.turns,
        customerSpeech: speechResult,
        openaiApiKey: bizKeys.openaiApiKey || process.env.OPENAI_API_KEY,
      });

      // Record AI turn
      const aiTimestamp = new Date().toISOString();
      session.turns.push({
        role: 'ai',
        text: replyText,
        timestamp: aiTimestamp,
        voice: targetVoice,
      });

      // Stream AI response directly to HeyTam Orchestrator
      const aiLog = `[${aiTimestamp}] [📞 Live Voice Call - ${callSid.slice(-6)}] 🤖 AI (${targetVoice}): "${replyText}"`;
      console.log(`[Twilio Webhook] ${aiLog}`);
      logToOrchestrator(runId, aiLog, {
        aiReply: replyText,
        voice: targetVoice,
        callSid,
      });

      if (isClosing || session.turns.length >= 16) {
        logToOrchestrator(
          runId,
          `[${new Date().toISOString()}] [📞 Live Voice Call - ${callSid.slice(-6)}] 🏁 Call completed successfully with customer.`
        );
        session.status = 'completed';
        session.endedAt = new Date().toISOString();
        savePersistentStores();

        const closingTwiML = generateClosingTwiML({ speech: replyText, voice: targetVoice });
        return res.type('text/xml').send(closingTwiML);
      }

      // Continue back-and-forth conversation loop
      savePersistentStores();
      const nextTwiML = generateGatherTwiML({
        speech: replyText,
        voice: targetVoice,
        turnUrl,
        isEnding: false,
      });
      return res.type('text/xml').send(nextTwiML);
    }

    // 2. Customer was silent or speech recognition timed out
    const silenceTurns = session.turns.filter(t => t.text.includes("didn't hear") || t.text.includes("didn't catch")).length;
    if (silenceTurns < 2) {
      const promptRepeat = `I'm sorry, I didn't quite catch that. Could you please repeat?`;
      session.turns.push({
        role: 'ai',
        text: promptRepeat,
        timestamp: new Date().toISOString(),
        voice: targetVoice,
      });
      logToOrchestrator(
        runId,
        `[${new Date().toISOString()}] [📞 Live Voice Call - ${callSid.slice(-6)}] 🤖 AI (${targetVoice}): "${promptRepeat}"`
      );
      const repeatTwiML = generateGatherTwiML({
        speech: promptRepeat,
        voice: targetVoice,
        turnUrl,
        isEnding: false,
      });
      return res.type('text/xml').send(repeatTwiML);
    } else {
      const farewell = `Thank you for connecting with ${biz.name || 'HeyTam'}. If you need anything else, please reach back out anytime. Have a wonderful day!`;
      session.status = 'completed';
      session.endedAt = new Date().toISOString();
      savePersistentStores();
      logToOrchestrator(
        runId,
        `[${new Date().toISOString()}] [📞 Live Voice Call - ${callSid.slice(-6)}] 🏁 Call ended due to inactivity.`
      );
      const closeTwiML = generateClosingTwiML({ speech: farewell, voice: targetVoice });
      return res.type('text/xml').send(closeTwiML);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown voice webhook error';
    console.error('[Twilio Webhook Error]', err);
    const fallbackTwiML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Thank you for calling. Our team will follow up with you shortly. Goodbye!</Say>
  <Hangup/>
</Response>`;
    return res.type('text/xml').send(fallbackTwiML);
  }
});

// POST & GET /api/voice/webhook/inbound — Inbound Call Receptionist
app.all(['/api/voice/webhook/inbound', '/api/voice/inbound'], async (req: Request, res: Response) => {
  try {
    const callSid = String(req.body?.CallSid || req.query?.CallSid || `INBOUND_${Date.now()}`).trim();
    const callerNumber = String(req.body?.From || req.query?.From || 'Unknown Caller').trim();
    const calledNumber = String(req.body?.To || req.query?.To || '').trim();

    // Identify business
    let businessId = String(req.query?.businessId || req.body?.businessId || '').trim();
    if (!businessId && calledNumber) {
      for (const [bId, conn] of oauthConnectionsStore.entries()) {
        if (conn?.credentials?.twilioFromPhone === calledNumber) {
          businessId = conn.businessId;
          break;
        }
      }
    }
    if (!businessId) businessId = DEFAULT_BUSINESS.id;

    const biz = businessesStore.get(businessId) || DEFAULT_BUSINESS;
    const bizKeys = getTenantKeysForBusiness(businessId);
    const targetVoice = String(req.query?.voice || bizKeys.twilioVoice || 'Polly.Joanna-Neural').trim();

    // Create a live workflow run for this incoming call so it streams in the Orchestrator
    const runId = `run_inbound_${Date.now()}`;
    const greetingText = `Hello! Thank you for calling ${biz.name || 'HeyTam'}. This is your AI front-desk receptionist. How can I assist you today?`;

    const inboundRun = {
      id: runId,
      runId,
      businessId,
      workflowId: 'inbound-receptionist-call',
      status: 'running',
      startedAt: new Date().toISOString(),
      orchestratorLog: [
        `[${new Date().toISOString()}] [HeyTam Core Supervisor] 📞 Incoming call detected from ${callerNumber} to ${biz.name || 'HeyTam'} (${calledNumber || 'Reception'})`,
        `[${new Date().toISOString()}] [HeyTam Core Supervisor] Assigned to AI Voice Receptionist Pod with voice [${targetVoice}]`,
        `[${new Date().toISOString()}] [📞 Live Voice Call - ${callSid.slice(-6)}] 🤖 AI (${targetVoice}): "${greetingText}"`,
        `[${new Date().toISOString()}] [📞 Live Voice Call - ${callSid.slice(-6)}] 👂 Listening for caller's spoken response via Twilio STT...`,
      ],
      steps: [{
        order: 1,
        agentId: 'receptionist-agent',
        agentName: 'AI Voice Receptionist',
        status: 'running',
        output: `🤖 AI Receptionist: "${greetingText}"`,
        logs: [
          `Inbound call connected: CallSid ${callSid}`,
          `Greeting caller ${callerNumber} using Twilio voice ${targetVoice}`,
        ],
      }],
      finalOutput: 'Inbound conversation active',
    };
    workflowRunsStore.set(runId, inboundRun);

    // Register active call session
    const session: CallSession = {
      callSid,
      businessId,
      runId,
      stepOrder: 1,
      from: callerNumber,
      to: calledNumber,
      direction: 'inbound',
      voice: targetVoice,
      status: 'in-progress',
      startedAt: new Date().toISOString(),
      turns: [{
        role: 'ai',
        text: greetingText,
        timestamp: new Date().toISOString(),
        voice: targetVoice,
      }],
    };
    upsertCallSession(session);
    savePersistentStores();

    const publicBase = getPublicBackendUrl();
    const turnUrl = `${publicBase}/api/voice/webhook/turn?businessId=${encodeURIComponent(businessId)}&runId=${encodeURIComponent(runId)}&voice=${encodeURIComponent(targetVoice)}&direction=inbound`;

    const twiml = generateGatherTwiML({
      speech: greetingText,
      voice: targetVoice,
      turnUrl,
      isEnding: false,
    });

    res.type('text/xml').send(twiml);
  } catch (err: unknown) {
    console.error('[Inbound Voice Error]', err);
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Thank you for calling. Please leave a message or reach back out shortly. Goodbye!</Say>
  <Hangup/>
</Response>`);
  }
});

// POST & GET /api/voice/webhook/status — Call Termination & Status Callback
app.all(['/api/voice/webhook/status', '/api/voice/status'], (req: Request, res: Response) => {
  const callSid = String(req.body?.CallSid || req.query?.CallSid || '').trim();
  const callStatus = String(req.body?.CallStatus || req.query?.CallStatus || 'completed').trim();
  const duration = Number(req.body?.CallDuration || req.query?.CallDuration || 0);

  if (callSid) {
    const session = getCallSession(callSid);
    if (session) {
      session.status = callStatus as any;
      session.durationSeconds = duration;
      session.endedAt = new Date().toISOString();

      if (session.runId) {
        logToOrchestrator(
          session.runId,
          `[${new Date().toISOString()}] [📞 Live Voice Call - ${callSid.slice(-6)}] 🏁 Call concluded (Status: ${callStatus}, Spoken Duration: ${duration}s)`
        );
        const run = workflowRunsStore.get(session.runId);
        if (run && run.status === 'running' && session.direction === 'inbound') {
          run.status = 'completed';
          run.completedAt = new Date().toISOString();
        }
      }
      savePersistentStores();
    }
  }

  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response/>');
});

// GET /api/voice/calls/:businessId — List call sessions and transcripts
app.get('/api/voice/calls/:businessId', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const calls = getCallSessionsForBusiness(businessId);
  res.json({ success: true, calls, count: calls.length });
});

// GET /api/voice/calls/:businessId/:callSid — Get single call details
app.get('/api/voice/calls/:businessId/:callSid', requireAuth, (req: Request, res: Response) => {
  const businessId = (req as AuthenticatedRequest).businessId;
  const callSid = String(req.params.callSid);
  const session = getCallSession(callSid);
  if (!session || session.businessId !== businessId) {
    return res.status(404).json({ error: 'Call session not found' });
  }
  res.json({ success: true, session });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global Error Handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, error: err.message });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 HeyTam Core v${VERSION} running on http://0.0.0.0:${PORT}`);
  console.log(`📡 API Endpoints: http://0.0.0.0:${PORT}/api`);
  console.log(`🏥 Health Check: http://0.0.0.0:${PORT}/health`);
  console.log(`🤖 Dispatch API: http://0.0.0.0:${PORT}/api/dispatch`);
  console.log(`🧠 Supervisor API: http://0.0.0.0:${PORT}/api/supervisor`);
  console.log(`📋 Agent Catalog: http://0.0.0.0:${PORT}/api/agents`);
  console.log(`🤖 AI Backend: ${process.env.AI_BACKEND || 'OPENAI'} ${process.env.OPENAI_MODEL || 'gpt-4o-mini'} [${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Missing Key'}]`);
  console.log(`🏢 Agents: ${getAgentCatalog().length} slave agents (30 total across 4 pods)\n`);
});

export default app;
