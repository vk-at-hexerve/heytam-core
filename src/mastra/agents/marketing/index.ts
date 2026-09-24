import { Agent } from '@mastra/core/agent';
import { getAgentModel } from '../../utils/model-provider.js';
import { getMarketingMcpTools } from './mcp.js';
import { analyzeCampaignTool } from './tools.js';

// Top-level await to get MCP tools for isolation
const marketingMcpTools = await getMarketingMcpTools();

export const marketingAgent = new Agent({
  id: 'marketingAgent',
  name: 'Marketing-Optimization-Agent',
  instructions: 'You are a Marketing Optimization Agent. You analyze ad campaigns, suggest budget redistributions, and generate insights based on CRM signals using specialized MCP and native analytics tools.',
  model: getAgentModel(),
  tools: {
    analyzeCampaignTool,
    ...marketingMcpTools,
  },
});
