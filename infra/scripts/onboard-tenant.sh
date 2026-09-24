#!/usr/bin/env bash
set -euo pipefail

# Usage: ./onboard-tenant.sh --client <name> --env <local|aks> [--secrets-file <file>]

SECRETS_FILE=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --client) CLIENT_ID="$2"; shift ;;
        --env) ENV="$2"; shift ;;
        --secrets-file) SECRETS_FILE="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [[ -z "${CLIENT_ID:-}" || -z "${ENV:-}" ]]; then
    echo "Usage: $0 --client <name> --env <local|aks> [--secrets-file <file>]"
    exit 1
fi

NAMESPACE="tenant-${CLIENT_ID}"
CHART_DIR="../helm/multi-agent-suite"

echo "=== Onboarding Tenant: ${CLIENT_ID} ==="

# 1. Create Namespace
echo "Creating namespace '${NAMESPACE}'..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace "$NAMESPACE" tenant="$CLIENT_ID" --overwrite

# 2. Deploy Secrets if provided
if [[ -n "$SECRETS_FILE" && -f "$SECRETS_FILE" ]]; then
    echo "Deploying secrets from ${SECRETS_FILE}..."
    # Convert .env file into K8s Secret (ignoring comments)
    kubectl create secret generic multi-agent-suite-secrets \
        --from-env-file="$SECRETS_FILE" \
        -n "$NAMESPACE" \
        --dry-run=client -o yaml | kubectl apply -f -
else
    echo "No secrets file provided. Using default dummy secrets."
fi

# 3. Deploy Helm Release
echo "Executing helm upgrade..."
VALUES_FILE="$CHART_DIR/values-${ENV}.yaml"

if [[ ! -f "$VALUES_FILE" ]]; then
    echo "Error: Values file ${VALUES_FILE} does not exist."
    exit 1
fi

helm upgrade --install "multi-agent-${CLIENT_ID}" "$CHART_DIR" \
    --namespace "$NAMESPACE" \
    --values "$VALUES_FILE" \
    --set global.clientId="$CLIENT_ID"

echo "=== Onboarding Complete for ${CLIENT_ID} ==="
