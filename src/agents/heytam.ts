import http from 'http';
import cron from 'node-cron';
import { mastra } from '../mastra/index.js';

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
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

  // Example 1: Trigger Marketing Agent every morning at 8:00 AM
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
      console.log(`[Scheduler] Daily marketing sync delegated successfully.`);
    } catch (error) {
      console.error(`[Scheduler] Failed to execute marketing sync:`, error);
    }
  });

  // Example 2: Trigger Mail Agent to check for high priority unread corporate emails every 15 minutes
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
    } catch (error) {
      console.error(`[Scheduler] Failed to poll emails:`, error);
    }
  });

});
