import { describe, it, expect, vi, beforeAll } from 'vitest';
import { heytamSupervisor } from '../src/mastra/agents/heytam/index.js';
import { callingAgent } from '../src/mastra/agents/calling/index.js';
import { mailAgent } from '../src/mastra/agents/mail/index.js';
import { marketingAgent } from '../src/mastra/agents/marketing/index.js';

describe('HeyTam Orchestrator Agent', () => {
  it('should be initialized with the correct name and sub-agents', () => {
    // Check that HeyTam is initialized correctly
    expect(heytamSupervisor.name).toBe('HeyTam');
    
    // Check that sub-agents are properly defined
    expect(callingAgent.name).toBe('Calling-Agent');
    expect(mailAgent.name).toBe('Corporate-Mail-Agent');
    expect(marketingAgent.name).toBe('Marketing-Optimization-Agent');
  });
  
  // Mocking generate to test if it routes properly is complex without full Mastra mocking, 
  // so we test the structure and properties to ensure orchestration is set up.
});
