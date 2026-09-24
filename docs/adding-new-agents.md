# Adding a New Slave Agent

This guide covers the end-to-end process of adding a new specialized slave agent to the HeyTam multi-agent architecture. Because the system is designed around a decoupled, pod-per-agent topology, adding a new agent involves creating its isolated logic, exposing it as a containerized REST service, and teaching the orchestrator how to delegate to it.

---

## 1. Create the Agent Directory

First, create a new folder for your agent inside `src/mastra/agents/`. Let's assume we are building a `finance` agent.

```bash
mkdir -p src/mastra/agents/finance
```

### 1a. Environment Configuration
Create a `.env.example` in this new directory. This file should **only** contain secrets specific to this agent.

```env
# src/mastra/agents/finance/.env.example
# Dedicated MCP Server Endpoints
FINANCE_MCP_URL=http://localhost:8005/mcp

# Agent Specific Secrets
STRIPE_API_KEY=your_stripe_key
```

### 1b. Define MCP Tools (`mcp.ts`)
Set up the Model Context Protocol (MCP) client to connect to the agent's dedicated tool server.

```typescript
// src/mastra/agents/finance/mcp.ts
import { MCPClient } from '@mastra/mcp';

export const financeMcpClient = new MCPClient({
  servers: {
    financeServer: {
      url: new URL(process.env.FINANCE_MCP_URL || 'http://localhost:8005/mcp'),
    },
  },
});

export const getFinanceMcpTools = async () => {
  return await financeMcpClient.listTools();
};
```

### 1c. Define the Agent (`index.ts`)
Instantiate the Mastra agent, binding it to the dynamic AI model provider and its tools.

```typescript
// src/mastra/agents/finance/index.ts
import { Agent } from '@mastra/core/agent';
import { getAgentModel } from '../../utils/model-provider.js';
import { getFinanceMcpTools } from './mcp.js';

// Top-level await for MCP resolution
const financeMcpTools = await getFinanceMcpTools();

export const financeAgent = new Agent({
  name: 'Finance-Agent',
  instructions: 'You are a Financial Analyst Agent. You process invoices and query payment histories using Stripe.',
  model: getAgentModel(),
  tools: {
    ...financeMcpTools,
  },
});
```

---

## 2. Expose the Agent as a REST Microservice

To allow the orchestrator to communicate with your agent across Docker/Kubernetes networks, you must expose an HTTP endpoint.

Create a new entrypoint script in `src/agents/finance-agent.ts`:

```typescript
// src/agents/finance-agent.ts
import http from 'http';
import { financeAgent } from '../mastra/agents/finance/index.js';

const PORT = process.env.PORT || 3004;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else if (req.url === '/execute' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const response = await financeAgent.generate([{ role: 'user', content: payload.prompt }]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result: response.text }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
  }
});

server.listen(PORT, () => {
  console.log(`[Finance Agent] Worker pod started on port ${PORT}`);
});
```

---

## 3. Connect to the HeyTam Orchestrator

The Orchestrator (`HeyTam`) needs a way to invoke your new REST API. We accomplish this by creating a remote tool binding.

### 3a. Create the Remote Tool
Open `src/mastra/agents/heytam/remote-tools.ts` and add a new tool:

```typescript
// Add inside src/mastra/agents/heytam/remote-tools.ts
export const delegateToFinanceAgent = createTool({
  id: 'delegate-finance',
  description: 'Delegates financial queries, invoicing, or payment processing tasks to the Finance Agent container via HTTP REST.',
  inputSchema: z.object({
    prompt: z.string().describe('The complete instruction and context for the Finance Agent.'),
  }),
  execute: async ({ context }) => {
    // Uses Docker DNS / Kubernetes Service Name
    const url = process.env.FINANCE_AGENT_URL || 'http://finance-agent:3004/execute';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: context.prompt }),
    });
    const data = await response.json();
    return data;
  },
});
```

### 3b. Register the Tool with HeyTam
Open `src/mastra/agents/heytam/index.ts` and add `delegateToFinanceAgent` to the tools array.

```typescript
import { delegateToFinanceAgent } from './remote-tools.js';

export const heytamSupervisor = new Agent({
  // ...
  tools: {
    delegateToCallingAgent,
    delegateToFinanceAgent, // <-- Added here
    // ...
  },
});
```

---

## 4. Update Infrastructure (Optional but Recommended)

To run your new agent locally or in Kubernetes, append it to your infrastructure manifests:

1. **Dockerfile (`infra/docker/Dockerfile.agent`):** Add a new build stage target for `finance-agent`.
2. **Docker Compose (`infra/local/docker-compose.yml`):** Add a new service block mapping to `finance-agent:3004`, mounting its `.env.example` files.
3. **Helm Chart (`infra/helm/multi-agent-suite/`):** Generate standard Deployment, Service, and HPA templates based on the pattern established for `calling-agent`.
