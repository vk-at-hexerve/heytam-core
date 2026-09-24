@description('The name of the Azure Container Registry')
param name string

@description('The location for the ACR')
param location string

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: name
  location: location
  sku: {
    name: 'Standard' // Use Premium if geo-replication or private endpoints are needed
  }
  properties: {
    adminUserEnabled: false // Best practice: use Managed Identity (AcrPull) instead of admin keys
  }
}

output acrId string = acr.id
output loginServer string = acr.properties.loginServer
