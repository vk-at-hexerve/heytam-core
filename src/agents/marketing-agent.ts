import http from 'http';
import { marketingAgent } from '../mastra/agents/marketing/index.js';

const PORT = process.env.PORT || 3003;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else if (req.url === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const response = await marketingAgent.generate([{ role: 'user', content: payload.prompt }]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: response.text }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[Marketing Agent] Worker pod started, listening on port ${PORT}`);
});
