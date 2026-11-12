import { readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';

import * as core from '@actions/core';

import type {
  PublishedPackage,
  WorkspacePackage,
} from '../core/publish-plan.ts';
import { runCommand } from '../proc.ts';

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

// 内蔵 publish。dist-tag は指定しない（= latest。lane 対応は v1 の publish-command で）
export const execPublish = async (
  cwd: string,
  publishBranch: string,
): Promise<void> => {
  await rm(summaryPath(cwd), { force: true });
  await runCommand(
    cwd,
    'pnpm',
    ['publish', '-r', '--report-summary', '--publish-branch', publishBranch],
    { stream: true },
  );
};

// summary は部分失敗でも書かれうるので、publish の成否と独立に読む
export const readPublishSummary = async (
  cwd: string,
): Promise<PublishedPackage[]> => {
  let raw: string;
  try {
    raw = await readFile(summaryPath(cwd), 'utf8');
  } catch {
    return [];
  }
  // 中断で summary が壊れていても、ここで throw すると本来の publish エラーを
  // 覆い隠してしまうため空扱いにする
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    core.warning(
      'pnpm-publish-summary.json could not be parsed: treating it as empty',
    );
    return [];
  }
  const list =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).publishedPackages
      : null;
  if (!Array.isArray(list)) return [];
  const published: PublishedPackage[] = [];
  for (const entry of list as Array<Record<string, unknown>>) {
    if (typeof entry.name === 'string' && typeof entry.version === 'string') {
      published.push({ name: entry.name, version: entry.version });
    }
  }
  return published;
};
