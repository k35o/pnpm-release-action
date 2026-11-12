import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse } from 'yaml';

import { extractVersionSection } from '../core/changelog.ts';
import type { ChangelogPreview } from '../core/changelog.ts';
import { releaseKey } from '../core/keys.ts';
import { asRecord } from '../core/records.ts';

const readWorkspaceConfig = async (
  cwd: string,
): Promise<Record<string, unknown> | null> => {
  let raw: string;
  try {
    raw = await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return null;
  }
  return asRecord(parse(raw));
};

// MVP は lane 非対応（内蔵 publish に dist-tag 指定手段が無い）。設定を検出
// したら publish モードで warning を出すための判定
export const hasLanesConfigured = async (cwd: string): Promise<boolean> => {
  const lanes = asRecord(
    asRecord(asRecord(await readWorkspaceConfig(cwd))?.versioning)?.lanes,
  );
  return lanes !== null && Object.keys(lanes).length > 0;
};

// ledger.yaml は "name@version" -> { dir, intents } の committed な台帳。
// CHANGELOG.md の場所を知るのに dir を使う。
const readLedgerDirs = async (
  cwd: string,
): Promise<ReadonlyMap<string, string>> => {
  const dirs = new Map<string, string>();
  let raw: string;
  try {
    raw = await readFile(join(cwd, '.changeset', 'ledger.yaml'), 'utf8');
  } catch {
    return dirs;
  }
  const parsed = asRecord(parse(raw));
  if (parsed === null) return dirs;
  for (const [key, value] of Object.entries(parsed)) {
    const dir = asRecord(value)?.dir;
    if (typeof dir === 'string') dirs.set(key, dir);
  }
  return dirs;
};

const readFileOrNull = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

// registry storage の parked ファイル名はパッケージ名の '/' を '!' に置換した
// "<name>@<version>.md"（実測: @scope/pkg -> "@scope!pkg@1.0.0.md"）
const readParkedSection = async (
  cwd: string,
  name: string,
  version: string,
): Promise<string | null> => {
  const parked = await readFileOrNull(
    join(
      cwd,
      '.changeset',
      'changelogs',
      `${name.replaceAll('/', '!')}@${version}.md`,
    ),
  );
  return parked === null ? null : parked.trim();
};

const readCommittedSection = async (
  cwd: string,
  dir: string | undefined,
  version: string,
): Promise<string | null> => {
  if (dir === undefined) return null;
  const changelog = await readFileOrNull(join(cwd, dir, 'CHANGELOG.md'));
  return changelog === null ? null : extractVersionSection(changelog, version);
};

// changelog の置き場は versioning.changelog.storage だけでは決まらない: registry
// storage でも、公開先の無い private パッケージの分は CHANGELOG.md に直接書かれる。
// 設定で分岐せず、parked を先に見て無ければ CHANGELOG.md を読む
export const collectChangelogPreviews = async (
  cwd: string,
  plan: ReadonlyArray<{ readonly name: string; readonly newVersion: string }>,
): Promise<ChangelogPreview[]> => {
  const dirs = await readLedgerDirs(cwd);
  return Promise.all(
    plan.map(async ({ name, newVersion }): Promise<ChangelogPreview> => ({
      name,
      newVersion,
      section:
        (await readParkedSection(cwd, name, newVersion)) ??
        (await readCommittedSection(
          cwd,
          dirs.get(releaseKey(name, newVersion)),
          newVersion,
        )),
    })),
  );
};
