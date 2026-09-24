# Observability & Metrics Guide

The Enterprise Multi-Agent AI System is designed with production-grade observability out of the box. We utilize **Prometheus** to expose real-time metrics across all agent microservices. 

## 1. How It Works

Each agent runs a lightweight Node HTTP server. In addition to the standard `/health` endpoints required for Kubernetes readiness and liveness probes, every agent exposes a `/metrics` endpoint powered by the `prom-client` library.

### Standard Node.js Telemetry
All agents automatically track standard V8/Node.js telemetry, including:
- Process CPU & Memory usage.
- Event loop lag.
- Active handles and requests.

### Custom Business Metrics

**HeyTam Orchestrator (`/metrics` on port 3000):**
- `heytam_cron_executions_total` (Counter): Tracks the number of times the orchestrator's internal `node-cron` scheduler successfully triggers or fails to trigger a background task (e.g., polling for emails, daily marketing syncs).

**Slave Agents (`/metrics` on ports 3001-3003):**
- `agent_requests_total` (Counter): Tracks the total number of delegated tasks received via the REST API (`POST /execute`). It includes labels for `agent_name` and `status` (success/error).
- `agent_request_duration_seconds` (Histogram): Measures the exact latency of the LLM generation process. The buckets are tailored to track typical AI response times (0.5s to 60s).

## 2. Kubernetes Integration

Our Helm charts are pre-configured to enable native Prometheus auto-discovery. Every Deployment template injects the standard prometheus scrape annotations onto its pods:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "300X" # Dynamically mapped to the agent's port
  prometheus.io/path: "/metrics"
```

If your Kubernetes cluster runs a Prometheus instance (such as the popular `kube-prometheus-stack`), it will automatically discover these pods and begin aggregating their telemetry without any further configuration.

## 3. Azure Monitor Integration (AKS)

If you deployed the infrastructure using our provided Bicep templates (`infra/bicep/`), the cluster is already bound to an **Azure Log Analytics Workspace**. 

To funnel the Prometheus metrics directly into Azure Monitor:
1. Ensure the **Azure Monitor managed service for Prometheus** is enabled on your AKS cluster.
2. The Azure metrics agent (`omsagent`) will respect the `prometheus.io/scrape` annotations natively.
3. You can query the metrics in Azure Log Analytics using KQL or build Azure Dashboards to monitor your LLM latencies and agent workload distributions in real-time.

## 4. Local Testing

When running locally via `docker-compose`, you can manually verify the metrics are functioning by querying the agents directly from your host machine:

```bash
# View HeyTam Orchestrator metrics
curl http://localhost:3000/metrics

# View Calling Agent metrics
curl http://localhost:3001/metrics
```
