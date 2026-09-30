export const RANGES = {
  '1h': { ms: 3_600_000, bucketMinutes: 1 },
  '24h': { ms: 86_400_000, bucketMinutes: 5 },
  '7d': { ms: 604_800_000, bucketMinutes: 60 },
  '30d': { ms: 2_592_000_000, bucketMinutes: 180 },
} as const;
export type RangeKey = keyof typeof RANGES;

export const PANELS = {
  'runs-over-time': 'sql',
  'spend-by-workspace': 'sql',
  'api-latency': 'prometheus',
  'api-error-rate': 'prometheus',
  'api-throughput': 'prometheus',
  'model-latency': 'prometheus',
  'model-errors': 'prometheus',
  'tokens-by-model': 'prometheus',
  'mcp-outcomes': 'prometheus',
  'approval-wait': 'prometheus',
  'circuit-transitions': 'prometheus',
  'logs': 'loki',
  'trace': 'tempo',
} as const;
export type PanelId = keyof typeof PANELS;
export type SqlPanelId = { [Id in PanelId]: (typeof PANELS)[Id] extends 'sql' ? Id : never }[PanelId];

export const isRange = (value: string): value is RangeKey => Object.hasOwn(RANGES, value);
export const isPanel = (value: string): value is PanelId => Object.hasOwn(PANELS, value);
export const isSqlPanel = (value: PanelId): value is SqlPanelId => PANELS[value] === 'sql';
