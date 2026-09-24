import { Agent } from '@mastra/core/agent';
import { getAgentModel } from '../../utils/model-provider.js';
import { getCallingMcpTools } from './mcp.js';
import { initiateCallTool } from './tools.js';

// Top-level await to get MCP tools for isolation
const callingMcpTools = await getCallingMcpTools();

export const callingAgent = new Agent({
  id: 'callingAgent',
  name: 'Calling-Agent',
  instructions: 'You are an AI Calling Agent. You handle outbound phone calls to leads. Use your MCP tools for telephony configurations and native tools for initiating background calls.',
  model: getAgentModel(),
  tools: {
    initiateCallTool,
    ...callingMcpTools,
  },
});
