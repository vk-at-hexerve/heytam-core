# Client Onboarding Guide

Our architecture natively supports multi-tenancy where each client gets their own logically isolated Kubernetes Namespace and configuration. This guide outlines the operational steps to onboard a new enterprise client.

## 1. Prepare Tenant Configuration

Create a custom Helm values overlay for the tenant.

1. Navigate to `infra/helm/multi-agent-suite/`.
2. Create a new file: `values-tenant-<client_name>.yaml`.
3. Configure the client's global settings, compute limits, and toggle which agents they have paid for/require:

```yaml
# infra/helm/multi-agent-suite/values-tenant-globex.yaml
global:
  clientId: "globex"
  environment: "production"

agents:
  heytam:
    enabled: true
    replicaCount: 2
  calling:
    enabled: false # Globex didn't purchase the calling module
  mail:
    enabled: true
  marketing:
    enabled: true
```

## 2. Prepare Tenant Secrets

Create an environment file containing the client's securely provided API keys. **Never commit this file to version control.**

```env
# globex-secrets.env
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
META_APP_ID=...
```

*Note: In production (Azure AKS), we highly recommend mapping these values into an Azure Key Vault and bypassing the `.env` file approach. If using Azure KV, set `secrets.useAzureKeyVault: true` in the tenant values.*

## 3. Provision the Tenant Namespace

We have provided a streamlined bash utility to create the namespace, apply the secrets, and install the Helm chart in one command.

```bash
cd infra/scripts
./onboard-tenant.sh --client globex --env aks --secrets-file /path/to/globex-secrets.env
```

### What this script does:
1. Creates a namespace `tenant-globex`.
2. Mounts the API keys from the provided `.env` file into Kubernetes Secrets inside that specific namespace.
3. Executes `helm upgrade --install` using the base `values-aks.yaml` mixed with the tenant's specific overlay.

## 4. Verification

Verify the pods are running in the new tenant's namespace:
```bash
kubectl get pods -n tenant-globex
```
You should only see the agents that were marked `enabled: true` in the client's overlay file.
