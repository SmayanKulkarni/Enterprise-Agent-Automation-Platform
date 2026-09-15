targetScope = 'resourceGroup'

@allowed(['centralindia', 'eastus'])
param location string
param environment string
param leaseId string
param leaseOwner string

// The deployment adapter supplies the concrete resources in later Azure slices.
output policyTags object = {
  environment: environment
  lease: leaseId
  owner: leaseOwner
}
