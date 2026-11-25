import { readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  PublishGroup,
  PublishedPackage,
  WorkspacePackage,
} from '../core/publish-plan.ts';
import { asRecord } from '../core/records.ts';
import { CommandError, runCommand } from '../proc.ts';

export const listWorkspacePackages = async (
  cwd: string,
): Promise<WorkspacePackage[]> => {
  const stdout = await runCommand(cwd, 'pnpm', [
    'ls',
    '-r',
    '--depth',
    '-1',
    '--json',
  ]);
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new TypeError('expected a JSON array from `pnpm ls -r --json`');
  }
  const packages: WorkspacePackage[] = [];
  for (const entry of parsed as Array<Record<string, unknown>>) {
    if (typeof entry.name !== 'string' || typeof entry.path !== 'string') {
      continue;
    }
    packages.push({
      name: entry.name,
      version: typeof entry.version === 'string' ? entry.version : null,
      path: entry.path,
      private: entry.private === true,
    });
  }
  return packages;
};

// 単一パッケージ（タグを v<version> にする）かどうか。pnpm ls の path は
// symlink 解決済み（macOS の /private/var など）のことがあるため realpath で比べる
export const isSinglePackageWorkspace = async (
  cwd: string,
  packages: readonly WorkspacePackage[],
): Promise<boolean> => {
  const [only] = packages;
  if (packages.length !== 1 || only === undefined) return false;
  return (await realpath(only.path)) === (await realpath(cwd));
};

const summaryPath = (cwd: string): string =>
  join(cwd, 'pnpm-publish-summary.json');

export const execStagePublish = async (
  cwd: string,
  publishBranch: string,
  group: PublishGroup,
): Promise<void> => {
  await rm(summaryPath(cwd), { force: true });
  await runCommand(
    cwd,
    'pnpm',
    [
      'stage',
      'publish',
      '-r',
      '--report-summary',
      '--publish-branch',
      publishBranch,
      '--tag',
      group.tag,
      ...group.names.flatMap((name) => ['--filter', name]),
    ],
    { stream: true },
  );
};

// pnpm view は未公開パッケージでも exit 1 で終わるため、404 だけはエラー JSON の
// コードで見分けて「registry に無い」（null）として扱う
const viewPackage = async (
  cwd: string,
  name: string,
  field: string,
): Promise<unknown> => {
  let stdout: string;
  try {
    stdout = await runCommand(cwd, 'pnpm', ['view', name, field, '--json']);
  } catch (error) {
    if (error instanceof CommandError && error.message.includes('_404')) {
      return null;
    }
    throw error;
  }
  return JSON.parse(stdout);
};

export const fetchLatestVersion = async (
  cwd: string,
  name: string,
): Promise<string | null> => {
  const latest = asRecord(await viewPackage(cwd, name, 'dist-tags'))?.latest;
  return typeof latest === 'string' ? latest : null;
};

export const fetchPublishedVersions = async (
  cwd: string,
  name: string,
): Promise<string[]> => {
  const versions = await viewPackage(cwd, name, 'versions');
  if (versions === null) return [];
  if (!Array.isArray(versions)) {
    throw new TypeError(
      `expected a JSON array from \`pnpm view ${name} versions --json\``,
    );
  }
  return versions.filter(
    (version): version is string => typeof version === 'string',
  );
};

export const readStageSummary = async (
  cwd: string,
): Promise<PublishedPackage[]> => {
  const list = asRecord(
    JSON.parse(await readFile(summaryPath(cwd), 'utf8')),
  )?.publishedPackages;
  if (!Array.isArray(list)) {
    throw new TypeError(
      'expected a `publishedPackages` array in pnpm-publish-summary.json',
    );
  }
  const staged: PublishedPackage[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (
      typeof record?.name === 'string' &&
      typeof record.version === 'string'
    ) {
      staged.push({ name: record.name, version: record.version });
    }
  }
  return staged;
};
