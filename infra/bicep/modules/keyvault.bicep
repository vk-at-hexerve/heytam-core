@description('The name of the Azure Key Vault')
param name string

@description('The location for the Key Vault')
param location string

@description('The tenant ID for the Key Vault')
param tenantId string

resource keyvault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: name
  location: location
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    accessPolicies: [] // Access is typically granted via RBAC or Managed Identity later
    enableSoftDelete: true
    enableRbacAuthorization: true // Modern Azure environments use RBAC for KV access
  }
}

output keyVaultName string = keyvault.name
output keyVaultId string = keyvault.id
