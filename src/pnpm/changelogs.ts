import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse } from 'yaml';

import {
  type ChangelogPreview,
  extractVersionSection,
} from '../core/changelog.ts';
import type { PlanEntry } from '../core/plan.ts';

type ChangelogStorage = 'registry' | 'repository';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;

export const readChangelogStorage = async (
  cwd: string,
): Promise<ChangelogStorage> => {
  let raw: string;
  try {
    raw = await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return 'registry';
  }
  const changelog = asRecord(
    asRecord(asRecord(parse(raw))?.versioning)?.changelog,
  );
  return changelog?.storage === 'repository' ? 'repository' : 'registry';
};

// ledger.yaml は "name@version" -> { dir, intents } の committed な台帳。
// repository storage で CHANGELOG.md の場所を知るのに dir を使う。
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

// registry storage の parked ファイル名はパッケージ名の '/' を '!' に置換した
// "<name>@<version>.md"（実測: @scope/pkg -> "@scope!pkg@1.0.0.md"）
const parkedFileName = (name: string, version: string): string =>
  `${name.replaceAll('/', '!')}@${version}.md`;

export const collectChangelogPreviews = async (
  cwd: string,
  plan: readonly PlanEntry[],
): Promise<ChangelogPreview[]> => {
  const storage = await readChangelogStorage(cwd);
  if (storage === 'registry') {
    return Promise.all(
      plan.map(async ({ name, newVersion }): Promise<ChangelogPreview> => {
        try {
          const section = await readFile(
            join(
              cwd,
              '.changeset',
              'changelogs',
              parkedFileName(name, newVersion),
            ),
            'utf8',
          );
          return { name, newVersion, section: section.trim() };
        } catch {
          return { name, newVersion, section: null };
        }
      }),
    );
  }
  const dirs = await readLedgerDirs(cwd);
  return Promise.all(
    plan.map(async ({ name, newVersion }): Promise<ChangelogPreview> => {
      const dir = dirs.get(`${name}@${newVersion}`);
      if (dir === undefined) return { name, newVersion, section: null };
      try {
        const changelog = await readFile(
          join(cwd, dir, 'CHANGELOG.md'),
          'utf8',
        );
        return {
          name,
          newVersion,
          section: extractVersionSection(changelog, newVersion),
        };
      } catch {
        return { name, newVersion, section: null };
      }
    }),
  );
};
