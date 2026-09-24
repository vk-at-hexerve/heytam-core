# Enterprise Multi-Agent AI System (HeyTam Core)

An enterprise-grade, multi-agent orchestration architecture built with [Mastra AI](https://mastra.ai/). The system features a decentralized, pod-per-agent topology designed for high scalability, strict security isolation, and true B2B multi-tenancy.

## 🌟 Key Features

- **Distributed Orchestration:** The `HeyTam` Orchestrator dynamically delegates tasks to highly specialized slave agents (Calling, Mail, Marketing) over internal HTTP REST endpoints.
- **Dynamic AI Backends:** Switch seamlessly between OpenAI, Anthropic, or GitHub Copilot natively using Vercel AI SDK wrappers.
- **Built-in Task Scheduler:** HeyTam natively embeds a `node-cron` scheduler to automatically poll CRM data and initiate agent tasks at fixed intervals.
- **Multi-Tenant Kubernetes Architecture:** Deploy isolated client namespaces containing strictly scoped secrets and network policies using our Helm chart.
- **Infrastructure as Code:** Fully automated provisioning of AKS, ACR, and Azure Key Vault via Bicep templates.

## 📂 Project Structure

```text
├── docs/                      # Comprehensive documentation (Onboarding, Architecture, Deployment)
├── infra/
│   ├── bicep/                 # Azure Infrastructure-as-Code (AKS, ACR, Key Vault)
│   ├── docker/                # Multi-stage Dockerfile for all agents
│   ├── helm/                  # Helm v3 multi-tenant charts
│   ├── local/                 # Local Docker Compose and Kind configs
│   └── scripts/               # Bash scripts for rapid deployment and onboarding
├── src/
│   ├── agents/                # REST microservice entrypoints for all agents
│   └── mastra/
│       ├── agents/            # Isolated agent logic, MCP clients, and Native Tools
│       └── utils/             # Dynamic Model Providers (OpenAI, Anthropic, Copilot)
└── tests/                     # Unit testing suite (Vitest)
```

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js (v20+)
- Docker & Docker Compose

### 1. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 2. Environment Setup
Configure your environment variables. Start by creating the root configuration:
```bash
cp .env.example .env
```
Ensure each agent's specific configuration is also populated in their respective directories (`src/mastra/agents/<agent_name>/.env.example` -> `.env`).

### 3. Run Locally (Docker Compose)
Start the entire decoupled multi-agent ecosystem locally:
```bash
cd infra/local
docker-compose up --build
```
This spins up PostgreSQL, Redis, the HeyTam Orchestrator, and the specialized sub-agents.

## 📖 Documentation

For detailed information on configuring, expanding, or deploying the system, please refer to the `/docs` directory:
- [Project Overview & Architecture](docs/overview.md)
- [Developer Onboarding](docs/developer-onboarding.md)
- [Client Onboarding & Multi-Tenancy](docs/client-onboarding.md)
- [Adding New Agents](docs/adding-new-agents.md)
- [Production Deployment (AKS)](docs/deployment.md)
- [Observability & Metrics](docs/observability.md)
- [HIPAA Compliance & Data Security](docs/hipaa-compliance.md)

## 🛠️ Technology Stack
- **Language:** TypeScript (Strict Mode)
- **Framework:** Mastra AI, Vercel AI SDK
- **State Management:** PostgreSQL, Redis (Pub/Sub)
- **Deployment:** Docker, Kubernetes, Helm, Azure Bicep
