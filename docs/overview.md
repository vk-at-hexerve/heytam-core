# Project Overview

The Enterprise Multi-Agent AI System (**HeyTam Core**) is a modular, scalable architecture built using the [Mastra AI](https://mastra.ai/) framework. It utilizes a powerful orchestrator (Supervisor) to delegate complex enterprise tasks to highly specialized sub-agents.

## Core Architecture

The system follows a strict **pod-per-agent microservice topology**. Instead of a monolithic AI service, each specialized capability is broken down into an independent agent running in its own container. 

### 1. HeyTam (Supervisor / Orchestrator)
The orchestrator is the "brain" of the operation. It does not perform domain-specific actions directly. Instead, it:
- **Receives Inputs:** Hooks into Webhooks, CRM Signals, or scheduled cron triggers.
- **Decomposes Tasks:** Analyzes high-level objectives and breaks them down into atomic instructions.
- **Delegates:** Determines which specialized sub-agent (slave) is best equipped to handle the task.
- **Synthesizes:** Aggregates responses from multiple agents to form a cohesive final result.

*Note: The Orchestrator also embeds a central **Scheduler** using `node-cron`. This allows HeyTam to autonomously trigger slave agents on fixed time intervals (e.g., daily marketing syncs, or polling for unread emails every 15 minutes) while injecting context-rich required data into their prompts.*

### Slave Agents (Domain Experts)
Slave agents are specialized worker pods designed to do one thing exceptionally well. They are invoked asynchronously by the Orchestrator and have isolated access to specific API credentials.

1. **Calling Agent**
   - **Role:** Telephony and voice automation.
   - **Tools:** Twilio SDK bindings.
   - **Capabilities:** Initiates outbound sales calls, manages interactive voice responses (IVR), and logs call transcripts.

2. **Mail Agent**
   - **Role:** Corporate communications.
   - **Tools:** Zoho / Gmail APIs.
   - **Capabilities:** Reads high-priority inbox threads, drafts context-aware replies, and dispatches scheduled email sequences.

3. **Marketing Agent**
   - **Role:** Ad campaign optimization.
   - **Tools:** Meta Graph API integrations.
   - **Capabilities:** Audits campaign spend, adjusts budgets based on real-time CRM data, and compiles daily performance insights.

## Multi-Tenancy Design

The system is designed to support enterprise-grade B2B SaaS multi-tenancy on Kubernetes:
- **Namespace Isolation:** Each client is provisioned in their own Kubernetes Namespace (e.g., `tenant-acme`, `tenant-globex`).
- **Secret Isolation:** Each agent within a tenant namespace receives *only* the secrets it strictly needs. (The mail agent cannot see the calling agent's Twilio keys).
- **Network Boundaries:** Kubernetes NetworkPolicies prevent cross-tenant communication.

## Tech Stack
- **Runtime:** Node.js (v20+), TypeScript (NodeNext)
- **AI Framework:** Mastra AI (@mastra/core, @mastra/pg)
- **LLM:** OpenAI via Vercel AI SDK
- **Infrastructure:** Docker, Kubernetes (AKS, Kind), Helm v3
- **State:** PostgreSQL (Conversational Memory), Redis (Pub/Sub)
