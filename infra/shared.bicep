targetScope = 'subscription'

param location string = 'centralus'
param contactEmail string
param budgetAmount int = 1
param budgetStartDate string = utcNow('yyyy-MM-01')

resource shared 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-eaa-shared'
  location: location
}

module sharedResources 'shared-resources.bicep' = {
  name: 'shared-resources'
  scope: shared
  params: { location: location }
}

var thresholds = [
  { name: 'actual-50', threshold: 50, type: 'Actual' }
  { name: 'actual-90', threshold: 90, type: 'Actual' }
  { name: 'actual-100', threshold: 100, type: 'Actual' }
  { name: 'forecast-100', threshold: 100, type: 'Forecasted' }
]

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'eaa-monthly'
  properties: {
    category: 'Cost'
    amount: budgetAmount
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    notifications: toObject(thresholds, item => item.name, item => {
      enabled: true
      operator: 'GreaterThanOrEqualTo'
      threshold: item.threshold
      thresholdType: item.type
      contactEmails: [contactEmail]
    })
  }
}

output appInsightsName string = sharedResources.outputs.appInsightsName
