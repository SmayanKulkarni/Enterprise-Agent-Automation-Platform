def queue($name): { name: $name, custom: { type: "azure-queue", identity: "system", metadata: { accountName: $account, queueName: $name, queueLength: "1" } } };

{
  properties: {
    template: {
      scale: {
        allowScalingRuleOverride: true,
        rules: ((["eaahub-workitems", "eaahub-control-00", "eaahub-control-01", "eaahub-control-02", "eaahub-control-03"] | map(queue(.))) + [{ name: "http", http: { metadata: { concurrentRequests: "20" } } }])
      }
    }
  }
}
