import { describe, it, expect, vi } from 'vitest';
import { heytamSupervisor, handleSupervisorPrompt } from '../src/mastra/agents/heytam/index.js';
import { callingAgent } from '../src/mastra/agents/calling/index.js';
import { mailAgent } from '../src/mastra/agents/mail/index.js';
import { marketingAgent } from '../src/mastra/agents/marketing/index.js';

describe('HeyTam Orchestrator Agent', () => {
  it('should be initialized with the correct name and sub-agents', () => {
    expect(heytamSupervisor.name).toBe('HeyTam');
    expect(callingAgent.name).toBe('Calling-Agent');
    expect(mailAgent.name).toBe('Corporate-Mail-Agent');
    expect(marketingAgent.name).toBe('Marketing-Optimization-Agent');
  });

  it('should route a user prompt through the supervisor and return the generated response', async () => {
    const generateSpy = vi.spyOn(heytamSupervisor, 'generate').mockResolvedValue({
      text: 'Calling agent scheduled for 5 leads.',
    } as any);

    const result = await handleSupervisorPrompt(
      'Check the pending leads in Zoho and schedule AI calling for the top 5 urgent leads.'
    );

    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(result).toBe('Calling agent scheduled for 5 leads.');

    expect(generateSpy.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user', content: expect.stringContaining('pending leads in Zoho') }),
      ])
    );
  });
});
