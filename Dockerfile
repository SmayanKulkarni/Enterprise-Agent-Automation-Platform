FROM mcr.microsoft.com/azure-functions/node:4-node22

ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true

COPY host.json package.json /home/site/wwwroot/
COPY dist /home/site/wwwroot/dist
COPY node_modules /home/site/wwwroot/node_modules
