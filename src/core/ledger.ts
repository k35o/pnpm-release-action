import { parse } from 'yaml';

export type LedgerEntry = {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
};

// ledger のキーは "name@version"。scoped 名（@scope/pkg@1.0.0）があるため
// 最後の '@' で分割する
const splitKey = (key: string): { name: string; version: string } | null => {
  const at = key.lastIndexOf('@');
  if (at <= 0) return null;
  return { name: key.slice(0, at), version: key.slice(at + 1) };
};

export const parseLedger = (
  raw: string | null,
): ReadonlyMap<string, LedgerEntry> => {
  const entries = new Map<string, LedgerEntry>();
  if (raw === null) return entries;
  const parsed: unknown = parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return entries;
  for (const [key, value] of Object.entries(parsed)) {
    const split = splitKey(key);
    if (split === null) continue;
    const dir =
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Record<string, unknown>).dir === 'string'
        ? (value as { dir: string }).dir
        : '.';
    entries.set(key, { name: split.name, version: split.version, dir });
  }
  return entries;
};

// 今回のリリースで増えたエントリ = HEAD にあり first-parent に無いもの
export const diffLedger = (
  current: ReadonlyMap<string, LedgerEntry>,
  previous: ReadonlyMap<string, LedgerEntry>,
): LedgerEntry[] =>
  [...current.entries()]
    .filter(([key]) => !previous.has(key))
    .map(([, entry]) => entry);
