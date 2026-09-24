import { SignalProvider } from '@mastra/core/signals';

export interface CrmLead {
  id: string;
  status: string;
  name: string;
  email: string;
  phone: string;
}

export class CrmLeadSignalProvider extends SignalProvider<'crm-lead-signals'> {
  readonly id = 'crm-lead-signals';

  constructor() {
    super();
  }

  // Handle incoming webhooks for real-time push events
  async handleIncomingCrmWebhook(payload: any) {
    if (payload && payload.id && payload.status === 'pending_call') {
      const dedupeKey = `crm-lead-signals:${payload.id}:pending_call`;
      const lead: CrmLead = payload;
      
      console.log(`[CrmLeadSignalProvider] Received webhook for lead ${lead.id}`);

      // Emit a formatted signal notification
      await this.notify({
        summary: `Lead pending call: ${lead.name}`,
        kind: 'lead-pending-call',
        source: 'crm-lead-signals',
        payload: lead,
      }, {
        threadId: 'heytam-orchestrator',
        resourceId: 'crm',
      });
    }
  }

  // Poll checking for unprocessed CRM leads with status pending_call every 30 seconds
  async poll() {
    console.log('[CrmLeadSignalProvider] Polling for pending leads...');
    // Mock API call to CRM
    const pendingLeads: CrmLead[] = [
      {
        id: `lead_${Math.random().toString(36).substring(2, 9)}`,
        status: 'pending_call',
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+15550198',
      }
    ];

    for (const lead of pendingLeads) {
      const dedupeKey = `crm-lead-signals:${lead.id}:pending_call`;
      
      await this.notify({
        summary: `Lead pending call: ${lead.name}`,
        kind: 'lead-pending-call',
        source: 'crm-lead-signals',
        payload: lead,
      }, {
        threadId: 'heytam-orchestrator',
        resourceId: 'crm',
      });
    }
  }

  // Required start method for the signal provider (e.g. interval setup)
  async start() {
    // Poll every 30 seconds
    setInterval(() => {
      this.poll().catch(console.error);
    }, 30000);
  }

  // Required stop method
  async stop() {
    // Cleanup if necessary
  }
}

export const crmLeadSignalProvider = new CrmLeadSignalProvider();
