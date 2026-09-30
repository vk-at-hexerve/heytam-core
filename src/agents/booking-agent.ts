import http from 'http';
import client from 'prom-client';
import { executeSubagent } from '../subagents/engine/agent-runner.js';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const agentRequestsTotal = new client.Counter({
  name: 'agent_requests_total',
  help: 'Total number of request executions handled by this agent',
  labelNames: ['agent_name', 'status'],
});
register.registerMetric(agentRequestsTotal);

const PORT = Number(process.env.PORT || 3004);
const AGENT_NAME = 'booking-agent';

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agent: AGENT_NAME, role: 'Calendar Date Appointment Selection' }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else if (req.url === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const prompt = payload.prompt || payload.input || '';
        const result = await executeSubagent({
          agentId: 'booking-agent',
          agentName: 'Booking Agent',
          input: prompt,
          tenantContext: payload.tenantContext,
          tenantKeys: payload.tenantKeys,
        });
        agentRequestsTotal.labels(AGENT_NAME, 'success').inc();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err: unknown) {
        agentRequestsTotal.labels(AGENT_NAME, 'error').inc();
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Booking Agent] Worker container started on port ${PORT}`);
});
