import { Buffer } from 'node:buffer';

import * as core from '@actions/core';

import type { GitUserSetup } from '../core/inputs.ts';
import { runCommand } from '../proc.ts';

const git = async (cwd: string, args: readonly string[]): Promise<string> =>
  (await runCommand(cwd, 'git', args)).trim();

export const revParseHead = (cwd: string): Promise<string> =>
  git(cwd, ['rev-parse', 'HEAD']);

// ブランチ名（detached なら SHA）。version モード完了後に元の ref へ戻すために使う
export const currentRef = async (cwd: string): Promise<string> => {
  const ref = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return ref === 'HEAD' ? git(cwd, ['rev-parse', 'HEAD']) : ref;
};

export const checkout = async (cwd: string, ref: string): Promise<void> => {
  await git(cwd, ['checkout', ref]);
};

// version モードは `git add -A` でコミットするため、事前にツリーが汚れていると
// 無関係な変更をリリース PR に巻き込む。検出用 worktree は常に無垢で気づけないので、
// ここで名指しで止める
export const assertCleanTree = async (cwd: string): Promise<void> => {
  const status = await git(cwd, ['status', '--porcelain']);
  if (status !== '') {
    const paths = status.split('\n').slice(0, 10).join('\n');
    throw new Error(
      `the working tree must be clean before versioning — commit, stash, or clean these paths (or move dirtying steps after this action):\n${paths}`,
    );
  }
};

export const configureIdentity = async (
  cwd: string,
  gitUser: GitUserSetup,
  resolveBotUserId: (slug: string) => Promise<number>,
): Promise<void> => {
  if (gitUser.kind === 'keep') return;
  const identity =
    gitUser.kind === 'actions-bot'
      ? {
          name: 'github-actions[bot]',
          email: '41898282+github-actions[bot]@users.noreply.github.com',
        }
      : {
          name: `${gitUser.appSlug}[bot]`,
          email: `${String(await resolveBotUserId(gitUser.appSlug))}+${gitUser.appSlug}[bot]@users.noreply.github.com`,
        };
  await git(cwd, ['config', 'user.name', identity.name]);
  await git(cwd, ['config', 'user.email', identity.email]);
};

// リリースブランチは履歴を継がず、毎回トリガー SHA から作り直す（レース収束の要）
export const rebuildBranch = async (
  cwd: string,
  branch: string,
  sha: string,
): Promise<void> => {
  await git(cwd, ['checkout', '-B', branch, sha]);
};

export const commitAll = async (
  cwd: string,
  message: string,
): Promise<boolean> => {
  await git(cwd, ['add', '-A']);
  const status = await git(cwd, ['status', '--porcelain']);
  if (status === '') return false;
  await git(cwd, ['commit', '-m', message]);
  return true;
};

export const forcePush = async (
  cwd: string,
  branch: string,
  token: string,
): Promise<void> => {
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const headerKey = `http.${serverUrl}/.extraheader`;
  const headerValue = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  core.setSecret(headerValue);
  // 常に `github-token` 入力で push する。actions/checkout が永続化した credential
  // （多くはデフォルトの GITHUB_TOKEN）が残っていると、それで push され下流の
  // workflow が起動しない — 空値の -c が継承された extraheader をリセットする
  // （git の文書化された挙動）ので、二重ヘッダにもならない
  await runCommand(
    cwd,
    'git',
    [
      '-c',
      `${headerKey}=`,
      '-c',
      `${headerKey}=${headerValue}`,
      'push',
      'origin',
      `HEAD:refs/heads/${branch}`,
      '--force',
    ],
    { label: 'git push' },
  );
};
