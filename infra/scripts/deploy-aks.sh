#!/usr/bin/env bash
set -euo pipefail

# Usage: ./deploy-aks.sh --resource-group <rg> --cluster-name <aks> --acr-name <acr> --client-id <id>

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --resource-group) RG="$2"; shift ;;
        --cluster-name) CLUSTER="$2"; shift ;;
        --acr-name) ACR="$2"; shift ;;
        --client-id) CLIENT_ID="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [[ -z "${RG:-}" || -z "${CLUSTER:-}" || -z "${ACR:-}" || -z "${CLIENT_ID:-}" ]]; then
    echo "Usage: $0 --resource-group <rg> --cluster-name <aks> --acr-name <acr> --client-id <id>"
    exit 1
fi

echo "=== Deploying to AKS ==="

# 1. Validate Azure CLI login
if ! az account show &> /dev/null; then
    echo "Error: Not logged into Azure CLI. Please run 'az login'."
    exit 1
fi

# 2. Authenticate ACR with AKS (if not already attached)
echo "Ensuring ACR '${ACR}' is attached to AKS '${CLUSTER}'..."
az aks update -n "$CLUSTER" -g "$RG" --attach-acr "$ACR" || echo "ACR might already be attached, proceeding..."

# 3. Get AKS credentials
echo "Getting kubectl credentials for '${CLUSTER}'..."
az aks get-credentials --resource-group "$RG" --name "$CLUSTER" --overwrite-existing

# 4. Deploy Helm Chart
NAMESPACE="tenant-${CLIENT_ID}"
CHART_DIR="../helm/multi-agent-suite"
ACR_LOGIN_SERVER=$(az acr show -n "$ACR" -g "$RG" --query loginServer -o tsv)

echo "Creating namespace '${NAMESPACE}'..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Optionally tag namespace for internal tracking
kubectl label namespace "$NAMESPACE" tenant="$CLIENT_ID" --overwrite

echo "Deploying Helm chart..."
helm upgrade --install "multi-agent-${CLIENT_ID}" "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --values "$CHART_DIR/values-aks.yaml" \
  --set global.clientId="$CLIENT_ID" \
  --set image.repository="${ACR_LOGIN_SERVER}/multi-agent"

echo "=== Deployment to AKS Complete ==="
