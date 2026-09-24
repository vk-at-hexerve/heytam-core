import { MCPClient } from '@mastra/mcp';

export const heytamMcpClient = new MCPClient({
  servers: {
    heytamAdminServer: {
      url: new URL(process.env.HEYTAM_MCP_URL || 'http://localhost:8001/mcp'),
    },
  },
});

export const getHeytamMcpTools = async () => {
  return await heytamMcpClient.listTools();
};
