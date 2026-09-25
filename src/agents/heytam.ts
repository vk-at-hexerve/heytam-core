import http from 'http';
import cron from 'node-cron';
import client from 'prom-client';
import { mastra } from '../mastra/index.js';
import { handleSupervisorPrompt } from '../mastra/agents/heytam/index.js';
import { getAllowedTenantIds, normalizeTenantId } from '../mastra/utils/tenant-access.js';

// ==========================================
// Observability & Metrics Configuration
// ==========================================
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const heytamCronExecutions = new client.Counter({
  name: 'heytam_cron_executions_total',
  help: 'Total number of scheduled cron tasks executed by HeyTam orchestrator',
  labelNames: ['task_type', 'status']
});
register.registerMetric(heytamCronExecutions);

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else if (req.url === '/api/supervisor/prompt' && req.method === 'POST') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
        const tenantId = normalizeTenantId(typeof payload.tenantId === 'string' ? payload.tenantId : undefined);

        if (!prompt.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Prompt is required.' }));
          return;
        }

        const allowedTenantIds = getAllowedTenantIds();
        if (allowedTenantIds.length > 0 && !tenantId) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'tenantId is required when tenant restrictions are enabled.' }));
          return;
        }

        const result = await handleSupervisorPrompt(prompt, tenantId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result, tenantId }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[HeyTam Orchestrator] Pod started, listening for health checks on port ${PORT}`);
  console.log(`[HeyTam Orchestrator] Initializing task scheduler...`);

  // ==========================================
  // Orchestrator Scheduler Configuration
  // ==========================================

  cron.schedule('0 8 * * *', async () => {
    console.log(`[Scheduler] Executing daily marketing sync...`);
    try {
      const heytamSupervisor = mastra.getAgent('heytamSupervisor');
      await heytamSupervisor.generate([
        {
          role: 'user',
          content: 'Please trigger the marketing agent to perform the daily morning sync. It should analyze current ad campaigns and report actionable insights.'
        }
      ]);
      heytamCronExecutions.labels('marketing_sync', 'success').inc();
      console.log(`[Scheduler] Daily marketing sync delegated successfully.`);
    } catch (error) {
      heytamCronExecutions.labels('marketing_sync', 'error').inc();
      console.error(`[Scheduler] Failed to execute marketing sync:`, error);
    }
  });

  cron.schedule('*/15 * * * *', async () => {
    console.log(`[Scheduler] Polling for high-priority unread emails...`);
    try {
      const heytamSupervisor = mastra.getAgent('heytamSupervisor');
      await heytamSupervisor.generate([
        {
          role: 'user',
          content: 'Please instruct the corporate mail agent to check the inbox for any high-priority unread emails and categorize them.'
        }
      ]);
      heytamCronExecutions.labels('mail_poll', 'success').inc();
    } catch (error) {
      heytamCronExecutions.labels('mail_poll', 'error').inc();
      console.error(`[Scheduler] Failed to poll emails:`, error);
    }
  });
});
