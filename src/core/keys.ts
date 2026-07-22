// ledger のキーや対象の重複排除・突合に使う正準形。散在していたテンプレート
// リテラルの綴りを一箇所に集める
export const releaseKey = (name: string, version: string): string =>
  `${name}@${version}`;
