using './main.bicep'

param environmentName = 'staging'
param recoverySchedule = '0 0 */6 * * *'
param clerkIssuer = readEnvironmentVariable('CLERK_ISSUER')
param clerkPublishableKey = readEnvironmentVariable('CLERK_PUBLISHABLE_KEY')
param clerkAuthorizedParties = readEnvironmentVariable('WEB_ORIGIN')
