import { MCPClient } from '@mastra/mcp';

export const callingMcpClient = new MCPClient({
  servers: {
    callingTelephonyServer: {
      url: new URL(process.env.CALLING_MCP_URL || 'http://localhost:8002/mcp'),
    },
  },
});

export const getCallingMcpTools = async () => {
  return await callingMcpClient.listTools();
};
