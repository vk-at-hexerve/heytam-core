import { describe, it, expect, vi } from 'vitest';
import { crmLeadSignalProvider } from '../src/mastra/signals/crm-lead-signals.js';

describe('CrmLeadSignalProvider', () => {
  it('should emit a signal when a valid webhook payload is received', async () => {
    // Spy on the protected notify method
    const notifySpy = vi.spyOn(crmLeadSignalProvider as any, 'notify').mockImplementation(() => Promise.resolve());

    await crmLeadSignalProvider.handleIncomingCrmWebhook({
      id: 'lead_test_1',
      status: 'pending_call',
      name: 'Test Lead',
      email: 'test@example.com',
      phone: '+15551234'
    });

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'crm-lead-signals',
        kind: 'lead-pending-call',
      }),
      expect.objectContaining({
        threadId: 'heytam-orchestrator',
      })
    );
    
    notifySpy.mockRestore();
  });
});
