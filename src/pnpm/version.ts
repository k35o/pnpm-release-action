import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type PlanEntry, parsePlanOutput } from '../core/plan.ts';
import { runCommand } from '../proc.ts';

const runVersion = async (
  cwd: string,
  extraArgs: readonly string[],
): Promise<PlanEntry[]> => {
  const stdout = await runCommand(cwd, 'pnpm', [
    'version',
    '-r',
    '--json',
    ...extraArgs,
  ]);
  return parsePlanOutput(stdout);
};

// `pnpm version -r` は --dry-run だと JSON を出さないため、検出も実際に適用して
// 結果を読むしかない。使い捨て worktree で実行して本体ツリーを守り、intent GC
// などの副作用ごと破棄する。
export const detectPlan = async (cwd: string): Promise<PlanEntry[]> => {
  // cwd が git リポジトリのサブディレクトリの場合、worktree 内の対応する位置で
  // 実行しないと誤ったプラン（多くは空）を検出してしまう
  const prefix = (
    await runCommand(cwd, 'git', ['rev-parse', '--show-prefix'])
  ).trim();
  const worktree = await mkdtemp(join(tmpdir(), 'pnpm-release-plan-'));
  await runCommand(cwd, 'git', [
    'worktree',
    'add',
    '--detach',
    worktree,
    'HEAD',
  ]);
  try {
    return await runVersion(join(worktree, prefix), ['--no-git-checks']);
  } finally {
    await runCommand(cwd, 'git', [
      'worktree',
      'remove',
      '--force',
      worktree,
    ]).catch(() => undefined);
    await rm(worktree, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const applyVersion = (cwd: string): Promise<PlanEntry[]> =>
  runVersion(cwd, []);

export const syncLockfile = async (cwd: string): Promise<void> => {
  await runCommand(cwd, 'pnpm', ['install', '--lockfile-only']);
};
