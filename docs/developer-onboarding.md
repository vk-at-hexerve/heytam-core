# Developer Onboarding

Welcome to the team! This guide will help you get your local development environment set up so you can start contributing to the HeyTam Multi-Agent AI system.

## Prerequisites

Ensure you have the following installed on your machine:
- [Node.js](https://nodejs.org/en) (v20.x or higher)
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- [Kind](https://kind.sigs.k8s.io/) (Kubernetes in Docker)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm v3](https://helm.sh/docs/intro/install/)

## Local Setup

### 1. Repository Setup
Clone the repository and install dependencies:
```bash
git clone <repo-url>
cd heytam-core
npm install
```

### 2. Environment Variables
Copy the example environment file for local testing:
```bash
cp infra/local/env.local.example infra/local/.env.local
```
*(Optional: Fill in real API keys if you intend to test integrations locally, otherwise the dummy values are fine for building and unit testing).*

### 3. Spin up Local Infrastructure

We provide automated scripts to spin up a local Kubernetes cluster using Kind and deploy the full Helm chart.

```bash
cd infra/scripts
./setup-local.sh
```

This script will:
1. Create a Kind cluster named `heytam-local`.
2. Build the Multi-stage Docker images (`multi-agent/heytam`, `calling-agent`, etc.).
3. Load the images into the Kind cluster.
4. Install the Helm chart into a local `tenant-demo` namespace.

### 4. Running Unit Tests

We use Vitest for fast, reliable testing.

```bash
npm run test
```

## Code Organization

- `/src/mastra/agents/`: Contains the isolated logic for each agent.
- `/src/mastra/mcp/`: Model Context Protocol configurations.
- `/src/mastra/tools/`: Custom native tools provided to the agents.
- `/infra/`: Contains all Docker, Kubernetes, and Helm manifests.

## Teardown

When you are done testing locally, you can destroy the Kind cluster:
```bash
cd infra/scripts
./teardown-local.sh
```
