@description('The name of the AKS cluster')
param name string

@description('The location for the AKS cluster')
param location string

@description('The Log Analytics Workspace ID for Container Insights')
param logAnalyticsWorkspaceId string

@description('The Resource ID of the ACR (Used to assign AcrPull role)')
param acrId string

@description('The Name of the Azure Key Vault (For CSI Driver access)')
param keyVaultName string

resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
  name: name
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: name
    agentPoolProfiles: [
      {
        name: 'agentpool'
        mode: 'System'
        vmSize: 'Standard_D4s_v3' // 4 cores, 16GB RAM - good for multi-agent workloads
        osType: 'Linux'
        type: 'VirtualMachineScaleSets'
        
        // Auto-scaling enabled as requested
        enableAutoScaling: true
        minCount: 1
        maxCount: 5
        count: 2
        
        vnetSubnetID: null // Let AKS create a default vnet or pass one in if networking is complex
      }
    ]
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceID: logAnalyticsWorkspaceId
        }
      }
      azureKeyvaultSecretsProvider: {
        enabled: true // Enables the CSI driver for Key Vault
      }
    }
    // Enable Workload Identity for modern secure KV access
    securityProfile: {
      workloadIdentity: {
        enabled: true
      }
    }
    oidcIssuerProfile: {
      enabled: true
    }
  }
}

// ---------------------------------------------------------------------------
// Role Assignments
// ---------------------------------------------------------------------------

// 1. Grant the AKS Kubelet identity AcrPull over the ACR
var acrPullRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource acrRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: resourceGroup() // Should ideally be scoped to the ACR resource directly
  name: guid(aks.id, acrId, acrPullRoleDefinitionId)
  properties: {
    roleDefinitionId: acrPullRoleDefinitionId
    principalId: aks.properties.agentPoolProfiles[0].nodeImageVersion != '' ? aks.properties.identityProfile.kubeletidentity.objectId : aks.properties.identityProfile.kubeletidentity.objectId
    principalType: 'ServicePrincipal'
  }
}

// 2. Grant the AKS KeyVault CSI Driver identity 'Key Vault Secrets User' over the Key Vault
var kvSecretsUserRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: resourceGroup() // Should ideally be scoped to the Key Vault resource directly
  name: guid(aks.id, keyVaultName, kvSecretsUserRoleDefinitionId)
  properties: {
    roleDefinitionId: kvSecretsUserRoleDefinitionId
    principalId: aks.properties.addonProfiles.azureKeyvaultSecretsProvider.identity.objectId
    principalType: 'ServicePrincipal'
  }
}

output clusterName string = aks.name
output kubeletIdentityObjectId string = aks.properties.identityProfile.kubeletidentity.objectId
