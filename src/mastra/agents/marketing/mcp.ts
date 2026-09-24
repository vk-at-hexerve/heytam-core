import { MCPClient } from '@mastra/mcp';

export const marketingMcpClient = new MCPClient({
  servers: {
    marketingAdsServer: {
      url: new URL(process.env.MARKETING_MCP_URL || 'http://localhost:8004/mcp'),
    },
  },
});

export const getMarketingMcpTools = async () => {
  return await marketingMcpClient.listTools();
};
