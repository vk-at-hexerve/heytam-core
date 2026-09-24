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
