import http from 'http';
import client from 'prom-client';
import { mailAgent } from '../mastra/agents/mail/index.js';

// ==========================================
// Observability & Metrics Configuration
// ==========================================
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const agentRequestsTotal = new client.Counter({
  name: 'agent_requests_total',
  help: 'Total number of request executions handled by this agent',
  labelNames: ['agent_name', 'status']
});
const agentRequestDuration = new client.Histogram({
  name: 'agent_request_duration_seconds',
  help: 'Duration of agent executions in seconds',
  labelNames: ['agent_name'],
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60]
});
register.registerMetric(agentRequestsTotal);
register.registerMetric(agentRequestDuration);

const PORT = process.env.PORT || 3002;
const AGENT_NAME = 'mail';

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': register.contentType });
    res.end(await register.metrics());
  } else if (req.url === '/execute' && req.method === 'POST') {
    const endTimer = agentRequestDuration.labels(AGENT_NAME).startTimer();
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const response = await mailAgent.generate([{ role: 'user', content: payload.prompt }]);
        agentRequestsTotal.labels(AGENT_NAME, 'success').inc();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: response.text }));
      } catch (err) {
        agentRequestsTotal.labels(AGENT_NAME, 'error').inc();
        res.writeHead(500);
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      } finally {
        endTimer();
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[Mail Agent] Worker pod started, listening on port ${PORT}`);
});
