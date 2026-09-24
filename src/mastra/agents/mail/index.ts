import { Agent } from '@mastra/core/agent';
import { getAgentModel } from '../../utils/model-provider.js';
import { getMailMcpTools } from './mcp.js';
import { dispatchEmailTool } from './tools.js';

// Top-level await to get MCP tools for isolation
const mailMcpTools = await getMailMcpTools();

export const mailAgent = new Agent({
  id: 'mailAgent',
  name: 'Corporate-Mail-Agent',
  instructions: 'You are a Corporate Mail Agent. You manage inbox correspondence and email dispatch using your dedicated Zoho/Gmail MCP tools and native dispatch tools.',
  model: getAgentModel(),
  tools: {
    dispatchEmailTool,
    ...mailMcpTools,
  },
});
