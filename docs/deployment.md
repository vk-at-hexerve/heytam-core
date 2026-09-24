# Deployment Guide

This document covers how to deploy the Multi-Agent system to different environments.

## Docker Architecture

The project utilizes a multi-stage `Dockerfile.agent` located in `infra/docker/`. A single build context compiles the TypeScript code once, and then separate stages bundle the specific execution environments for the 4 distinct agents.

To build an image manually:
```bash
docker build --target heytam -t myrepo/heytam:latest -f infra/docker/Dockerfile.agent .
```

## Local Kubernetes (Kind)

Local Kubernetes deployments are fully automated for developers.

1. Install prerequisites (Docker, Kind, Helm).
2. Run the local setup script:
   ```bash
   ./infra/scripts/setup-local.sh
   ```
3. The script will output port-forwarding instructions once complete.

## Docker Compose (Non-K8s Local Testing)

If you just want to run the database, redis, and agents locally without the overhead of a Kubernetes cluster, a `docker-compose.yml` is provided.

```bash
cd infra/local
docker-compose up --build
```

## Production Azure AKS (Azure Kubernetes Service)

Deploying to Azure AKS requires proper authentication with Azure CLI (`az login`), an active cluster, and an Azure Container Registry (ACR).

### 1. Prerequisites
- The AKS cluster must have the **Azure Key Vault Provider for Secrets Store CSI Driver** enabled if you are using Key Vault.
- You must be authenticated to `az cli`.

### 2. Push Images to ACR
First, build and push the images to your ACR.
```bash
ACR_NAME="mycompanyacr"
az acr login --name $ACR_NAME

for target in heytam calling-agent mail-agent marketing-agent; do
  docker build --target $target -t $ACR_NAME.azurecr.io/multi-agent/$target:latest -f infra/docker/Dockerfile.agent .
  docker push $ACR_NAME.azurecr.io/multi-agent/$target:latest
done
```

### 3. Deploy via Script
Use the provided `deploy-aks.sh` script to configure the AKS namespace and deploy the helm chart.

```bash
cd infra/scripts
./deploy-aks.sh \
  --resource-group my-aks-rg \
  --cluster-name my-aks-cluster \
  --acr-name mycompanyacr \
  --client-id acme
```

### 4. Updating a Deployment
To update a deployment after making code changes:
1. Build and push new images with a new tag (e.g., `v1.1.0`).
2. Update the `image.tag` value in the tenant's overlay values file.
3. Re-run `helm upgrade` (or use the `onboard-tenant.sh` script which performs an upgrade).
