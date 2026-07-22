// unknown な YAML/JSON パース結果を安全に辿るための共通ヘルパー
export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
