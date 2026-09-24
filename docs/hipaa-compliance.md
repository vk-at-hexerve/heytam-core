# HIPAA Compliance & Data Security

To ensure the Enterprise Multi-Agent ecosystem is strictly compliant with the **Health Insurance Portability and Accountability Act (HIPAA)** and protects Protected Health Information (PHI), the architecture enforces several layers of security across the application, infrastructure, and network.

## 1. Data in Transit (Encryption)

All communication must be encrypted. While external ingress traffic is terminated with TLS at the Azure Application Gateway / Nginx Ingress, **internal pod-to-pod communication** (e.g., HeyTam Orchestrator talking to the Mail Agent) also requires encryption.

**Solution: Service Mesh (mTLS)**
Our Helm charts are configured to support automatic sidecar injection for Service Meshes (such as **Istio** or **Linkerd**). 
By applying the `linkerd.io/inject: enabled` or `sidecar.istio.io/inject: "true"` annotations to the Deployments, all internal Node.js HTTP REST calls are automatically hijacked by the sidecar proxy and encrypted using **strict mutual TLS (mTLS)** before leaving the pod.

## 2. Data at Rest (Encryption)

- **PostgreSQL & Redis:** If utilizing Azure Database for PostgreSQL and Azure Cache for Redis, data at rest encryption is enforced by default using Microsoft-managed keys. 
- **Secrets Management:** Environment variables and API keys are strictly forbidden from being stored in ConfigMaps or code. We utilize the **Azure Key Vault Secrets Provider (CSI Driver)** to mount secrets directly into the pods' volatile memory (tmpfs), ensuring they never touch the disk.

## 3. PHI Redaction & LLM Providers

Under HIPAA regulations, PHI cannot be sent to an external vendor (like OpenAI or Anthropic) unless a **Business Associate Agreement (BAA)** is signed.

**Mitigation Strategies:**
1. **Azure OpenAI:** We highly recommend utilizing the `COPILOT` or a custom `AZURE_OPENAI` model backend configuration via `src/mastra/utils/model-provider.ts`, as Microsoft Azure offers strict BAAs for Enterprise customers ensuring prompts are never logged or used for model training.
2. **On-the-Fly Redaction:** We have implemented a utility at `src/mastra/utils/phi-scrubber.ts`. Before delegating high-risk data, the orchestrator should run payloads through this scrubber to strip SSNs, Health IDs, and personal identifiers.

## 4. Audit Logging

To comply with HIPAA's audit control requirements (§ 164.312(b)):
- The agents' Prometheus telemetry metrics (`/metrics`) actively track execution timestamps and statuses.
- The Kubernetes cluster logs all stdout/stderr to **Azure Log Analytics** (Container Insights), establishing an immutable audit trail of which agent performed which action. No PHI should be explicitly printed to `console.log`.

## 5. Infrastructure Policies (Azure)

When deploying via the provided Bicep templates, ensure you enable **Azure Policy** with the `HIPAA HITRUST` initiative. This will automatically audit your AKS cluster to ensure:
- Kubernetes API servers are restricted to private networks (Private AKS).
- Azure Container Registry (ACR) disables public network access.
- Azure Key Vault enforces firewall rules limiting access strictly to the AKS virtual network.
