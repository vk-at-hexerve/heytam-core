@description('The primary location for all resources')
param location string = resourceGroup().location

@description('The unique prefix for all resources (e.g., heytam, contoso)')
param prefix string = 'heytam'

@description('The environment name (e.g., dev, prod)')
param environment string = 'prod'

var resourceName = '${prefix}-${environment}'

// 1. Log Analytics Workspace (for AKS monitoring)
module logAnalytics './modules/logAnalytics.bicep' = {
  name: '${resourceName}-law-deployment'
  params: {
    name: '${resourceName}-law'
    location: location
  }
}

// 2. Azure Container Registry
module acr './modules/acr.bicep' = {
  name: '${resourceName}-acr-deployment'
  params: {
    name: replace('${prefix}${environment}acr', '-', '') // Must be alphanumeric
    location: location
  }
}

// 3. Azure Key Vault (for secure multi-tenant secrets)
module keyvault './modules/keyvault.bicep' = {
  name: '${resourceName}-kv-deployment'
  params: {
    name: '${resourceName}-kv'
    location: location
    tenantId: subscription().tenantId
  }
}

// 4. Azure Kubernetes Service (AKS)
module aks './modules/aks.bicep' = {
  name: '${resourceName}-aks-deployment'
  params: {
    name: '${resourceName}-aks'
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.workspaceId
    acrId: acr.outputs.acrId
    keyVaultName: keyvault.outputs.keyVaultName
  }
}

output acrLoginServer string = acr.outputs.loginServer
output aksClusterName string = aks.outputs.clusterName
output keyVaultName string = keyvault.outputs.keyVaultName
