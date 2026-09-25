import { Agent } from '@mastra/core/agent';
import { getAgentModel } from '../../utils/model-provider.js';
import { getHeytamMcpTools } from './mcp.js';
import { delegateToCallingAgent, delegateToMailAgent, delegateToMarketingAgent } from './remote-tools.js';

// Top-level await to get MCP tools for isolation
const heytamMcpTools = await getHeytamMcpTools();

export const heytamSupervisor = new Agent({
  id: 'heytamSupervisor',
  name: 'HeyTam',
  instructions: 'You are HeyTam, the Lead Supervisor Agent. You orchestrate domain-specific sub-agents to process CRM leads and perform administrative tasks. Ensure tasks are delegated accurately.',
  model: getAgentModel(),
  tools: {
    delegateToCallingAgent,
    delegateToMailAgent,
    delegateToMarketingAgent,
    ...heytamMcpTools,
  },
});

export async function handleSupervisorPrompt(prompt: string): Promise<string> {
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt is required.');
  }

  const response = await heytamSupervisor.generate([
    {
      role: 'system',
      content: `You are HeyTam, the lead supervisor. Review requests, decide which specialized agent should handle the work, and produce a concise action plan. Use the available delegation tools when the task clearly maps to calling, mail, or marketing work. If the user asks for lead triage, prioritise pending leads, urgency, and agent assignment.`,
    },
    {
      role: 'user',
      content: prompt.trim(),
    },
  ]);

  return response.text;
}
