import functionsInstrumentation from '@azure/functions-opentelemetry-instrumentation';
import { startTelemetry } from '../../packages/telemetry/src/index.js';

const { AzureFunctionsInstrumentation } = functionsInstrumentation;

startTelemetry('workflow-functions', [new AzureFunctionsInstrumentation()]);
