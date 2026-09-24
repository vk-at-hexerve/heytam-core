import { MCPClient } from '@mastra/mcp';

export const mailMcpClient = new MCPClient({
  servers: {
    mailZohoServer: {
      url: new URL(process.env.MAIL_MCP_URL || 'http://localhost:8003/mcp'),
    },
  },
});

export const getMailMcpTools = async () => {
  return await mailMcpClient.listTools();
};
