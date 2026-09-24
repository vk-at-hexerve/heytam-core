import { mastra } from './mastra/index.js';
import { heytamSupervisor } from './mastra/agents/heytam/index.js';
import { crmLeadSignalProvider, CrmLead } from './mastra/signals/crm-lead-signals.js';

async function main() {
  console.log('Initializing HeyTam Mastra AI Framework...');
  
  // Connect MCP clients
  // Since we used top-level await in agent files, they are already connected 
  // at module load time, ensuring early failure if MCP servers are down.

  // Start Mastra storage and schedules
  // In a real app we might await mastra.init() or similar if required by the framework version
  
  console.log('Mastra initialized. Registering signal listeners...');

  // Set up an active operations thread for HeyTam to receive CRM signals
  // Note: Actual Mastra thread creation may vary; using a mocked active operations thread for simulation.
  const heytamLiveOpsThread = 'heytam-live-ops-thread';

  // Override notify in our mock simulation to demonstrate orchestration manually
  const originalNotify = (crmLeadSignalProvider as any).notify;
  (crmLeadSignalProvider as any).notify = async (notification: any, target: any) => {
    if (notification.kind === 'lead-pending-call') {
      const lead = notification.payload as CrmLead;
      console.log(`\n[Event Hub] Detected new CRM lead: ${lead.name} (${lead.id})`);
      console.log(`[Event Hub] Routing signal to HeyTam on thread ${heytamLiveOpsThread}...`);
      
      // Simulate HeyTam processing the notification and delegating
      try {
        const response = await heytamSupervisor.generate([
          {
            role: 'system',
            content: `A new CRM lead signal arrived from ${notification.source}. Lead Details: ${JSON.stringify(lead)}`,
          },
          {
            role: 'user',
            content: 'Please delegate this to the calling agent to initiate an outbound call immediately.',
          }
        ]);

        console.log(`\n[HeyTam] Orchestrator Response:`);
        console.log(response.text);
      } catch (error) {
        console.error(`[HeyTam] Error during processing:`, error);
      }
    }
  };

  // Start the signal provider polling (simulating worker service)
  await crmLeadSignalProvider.start();

  console.log('\nSimulation started. Awaiting signals...');
  console.log('(In 3 seconds, we will simulate a webhook push event arriving from the CRM)\n');

  // Simulate an incoming webhook event after 3 seconds
  setTimeout(() => {
    console.log('[Webhook Handler] Simulating incoming CRM push event...');
    crmLeadSignalProvider.handleIncomingCrmWebhook({
      id: 'lead_web_991',
      status: 'pending_call',
      name: 'John Smith',
      email: 'john@example.com',
      phone: '+15550200',
    }).catch(console.error);
  }, 3000);

  // Keep the process alive for a short demo
  setTimeout(() => {
    console.log('\nDemo simulation complete. Shutting down.');
    process.exit(0);
  }, 10000);
}

main().catch((error) => {
  console.error('Fatal execution error:', error);
  process.exit(1);
});
