#!/usr/bin/env bash
set -euo pipefail

: "${CONTACT_EMAIL:?Set CONTACT_EMAIL to the address that receives budget alerts.}"

export REPO="${REPO:-SmayanKulkarni/Enterprise-Agent-Automation-Platform}"
LOCATION="${LOCATION:-centralus}"
APP_NAME="${APP_NAME:-eaa-github-deploy}"
SQL_SERVER="${SQL_SERVER:-auomaionbackenddb}"
SQL_RESOURCE_GROUP="${SQL_RESOURCE_GROUP:-rg-smayan.kulkarni142-9549}"
ENVIRONMENTS=(staging prod)

BLOB_OWNER=b7e6dc6d-f1e8-4753-8033-0f276bb0955b
QUEUE_CONTRIBUTOR=974c5e8b-45b9-4653-ba55-5f855dd0fb88
TABLE_CONTRIBUTOR=0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3
SECRETS_USER=4633458b-17de-408a-b874-0445c86b69e6
ROLE_GUIDS="$BLOB_OWNER, $QUEUE_CONTRIBUTOR, $TABLE_CONTRIBUTOR, $SECRETS_USER"
ROLE_CONDITION="((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLE_GUIDS})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ROLE_GUIDS}))"

subscription_id="$(az account show --query id -o tsv)"
tenant_id="$(az account show --query tenantId -o tsv)"

assign() {
  local role="$1" scope="$2" condition="${3:-}"
  local existing
  existing="$(az role assignment list --assignee "$sp_id" --role "$role" --scope "$scope" --query 'length(@)' -o tsv)"
  [ "$existing" != "0" ] && return 0
  if [ -n "$condition" ]; then
    az role assignment create --assignee-object-id "$sp_id" --assignee-principal-type ServicePrincipal --role "$role" --scope "$scope" --condition "$condition" --condition-version 2.0 -o none
  else
    az role assignment create --assignee-object-id "$sp_id" --assignee-principal-type ServicePrincipal --role "$role" --scope "$scope" -o none
  fi
}

for environment in "${ENVIRONMENTS[@]}"; do
  az group create --name "rg-eaa-$environment" --location "$LOCATION" -o none
done

az deployment sub create --name eaa-shared --location "$LOCATION" --template-file "$(dirname "$0")/shared.bicep" --parameters contactEmail="$CONTACT_EMAIL" -o none

client_id="$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv)"
[ -n "$client_id" ] || client_id="$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)"
sp_id="$(az ad sp show --id "$client_id" --query id -o tsv 2>/dev/null || az ad sp create --id "$client_id" --query id -o tsv)"

subject_prefix="$(gh api "repos/$REPO/actions/oidc/customization/sub" --jq '.sub_claim_prefix // "repo:\(env.REPO)"')"
[ -n "$subject_prefix" ] || { echo "Could not read the repository OIDC subject prefix." >&2; exit 1; }

for environment in "${ENVIRONMENTS[@]}"; do
  name="github-$environment"
  subject="$subject_prefix:environment:$environment"
  credential="{\"name\":\"$name\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"$subject\",\"audiences\":[\"api://AzureADTokenExchange\"]}"
  found="$(az ad app federated-credential list --id "$client_id" --query "[?name=='$name'] | length(@)" -o tsv)"
  if [ "$found" = "0" ]; then
    az ad app federated-credential create --id "$client_id" --parameters "$credential" -o none
  else
    az ad app federated-credential update --id "$client_id" --federated-credential-id "$name" --parameters "$credential" -o none
  fi
  scope="/subscriptions/$subscription_id/resourceGroups/rg-eaa-$environment"
  assign Contributor "$scope"
  assign "User Access Administrator" "$scope" "$ROLE_CONDITION"
done

assign Reader "/subscriptions/$subscription_id/resourceGroups/rg-eaa-shared"
assign "SQL Server Contributor" "/subscriptions/$subscription_id/resourceGroups/$SQL_RESOURCE_GROUP/providers/Microsoft.Sql/servers/$SQL_SERVER"

cat <<OUT

Store these as GitHub Environment variables on both "staging" and "prod":
  AZURE_CLIENT_ID=$client_id
  AZURE_TENANT_ID=$tenant_id
  AZURE_SUBSCRIPTION_ID=$subscription_id
  AZURE_RESOURCE_GROUP=rg-eaa-<environment>
  FUNCTION_APP_NAME=func-eaa-<environment>

Next: set the remaining variables and secrets listed in README section 18, run the deploy
workflow once so Bicep creates the Key Vaults, then seed each vault:
  az keyvault secret set --vault-name <vault> --name azure-sql-connection-string --value '<runtime connection string>'
  az keyvault secret set --vault-name <vault> --name clerk-secret-key --value '<sk_...>'
  az keyvault secret set --vault-name <vault> --name workflow-openrouter-wrapping-key --value '<key>'
  az keyvault secret set --vault-name <vault> --name workflow-mcp-wrapping-key --value '<key>'
OUT
