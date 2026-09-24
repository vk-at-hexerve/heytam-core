#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="heytam-local"

echo "=== Tearing down Local Environment ==="

if kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
  echo "Deleting Kind cluster '${CLUSTER_NAME}'..."
  kind delete cluster --name "$CLUSTER_NAME"
  echo "Cluster deleted successfully."
else
  echo "Kind cluster '${CLUSTER_NAME}' does not exist."
fi
