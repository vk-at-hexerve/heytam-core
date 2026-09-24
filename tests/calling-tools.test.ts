import { describe, it, expect } from 'vitest';
import { initiateCallTool } from '../src/mastra/agents/calling/tools.js';

describe('Calling Tools', () => {
  it('should successfully initiate a background call', async () => {
    // Note: since our tools return standard objects, we can just execute them directly
    const result = await initiateCallTool.execute!({
      phoneNumber: '+15550200',
      leadId: 'lead_123',
      context: 'Hello there'
    }, { requestContext: {} } as any);

    expect(result.status).toBe('queued');
    expect(result.callId).toBeDefined();
    expect(result.callId).toMatch(/^call_/);
  });
});
