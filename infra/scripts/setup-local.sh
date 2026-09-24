#!/usr/bin/env bash
set -euo pipefail

# Constants
CLUSTER_NAME="heytam-local"
NAMESPACE="tenant-demo"
CHART_DIR="../helm/multi-agent-suite"
DOCKER_FILE="../docker/Dockerfile.agent"

echo "=== Enterprise Multi-Agent AI System: Local Setup ==="

# 1. Check prerequisites
for cmd in docker kind kubectl helm; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "Error: $cmd is required but not installed." >&2
    exit 1
  fi
done

# 2. Spin up Kind cluster if not exists
if ! kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  echo "Creating Kind cluster '${CLUSTER_NAME}'..."
  kind create cluster --name "$CLUSTER_NAME" --config ../local/kind-cluster-config.yaml
else
  echo "Kind cluster '${CLUSTER_NAME}' already exists."
fi

# 3. Build Docker images
echo "Building Docker images..."
for target in heytam calling-agent mail-agent marketing-agent; do
  echo "  -> Building multi-agent/${target}:latest"
  docker build --target "$target" -t "multi-agent/${target}:latest" -f "$DOCKER_FILE" ../../
done

# 4. Load images into Kind cluster
echo "Loading images into Kind cluster..."
for target in heytam calling-agent mail-agent marketing-agent; do
  kind load docker-image "multi-agent/${target}:latest" --name "$CLUSTER_NAME"
done

# 5. Create namespace
echo "Ensuring namespace '${NAMESPACE}' exists..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# 6. Install/Upgrade Helm Chart
echo "Deploying Helm chart to '${NAMESPACE}'..."
helm upgrade --install multi-agent "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --values "$CHART_DIR/values-local.yaml" \
  --set global.clientId="demo"

echo "=== Setup Complete ==="
echo "To port-forward the HeyTam orchestrator:"
echo "kubectl port-forward svc/heytam 3000:3000 -n ${NAMESPACE}"
