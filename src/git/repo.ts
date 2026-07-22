import { Buffer } from 'node:buffer';

import * as core from '@actions/core';
import { getExecOutput } from '@actions/exec';

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

export const statusPorcelain = (cwd: string): Promise<string> =>
  git(cwd, ['status', '--porcelain']);

export const repoToplevel = (cwd: string): Promise<string> =>
  git(cwd, ['rev-parse', '--show-toplevel']);

// 追跡ファイルの変更を戻し、未追跡の生成物を消す（呼び出し元が clean 開始を保証）
export const restoreCleanTree = async (cwd: string): Promise<void> => {
  await git(cwd, ['reset', '--hard']);
  await git(cwd, ['clean', '-fd']);
};

// NUL 区切りをそのまま返す（trim すると経路情報を壊しうるので git() を通さない）。
// -uall: 未追跡ディレクトリを丸めず個別ファイルで列挙する（ディレクトリの
// エントリを readFile すると EISDIR になる）
export const statusPorcelainZ = (cwd: string): Promise<string> =>
  runCommand(cwd, 'git', ['status', '--porcelain', '-z', '-uall']);

// version モードは `git add -A` でコミットするため、事前にツリーが汚れていると
// 無関係な変更をリリース PR に巻き込む。検出用 worktree は常に無垢で気づけないので、
// ここで名指しで止める
export const assertCleanTree = async (cwd: string): Promise<void> => {
  const status = await statusPorcelain(cwd);
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

// 常に `github-token` 入力で push する。actions/checkout が永続化した credential
// （多くはデフォルトの GITHUB_TOKEN）が残っていると、それで push され下流の
// workflow が起動しない — 空値の -c が継承された extraheader をリセットする
// （git の文書化された挙動）ので、二重ヘッダにもならない
const authArgs = (token: string): string[] => {
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const headerKey = `http.${serverUrl}/.extraheader`;
  const headerValue = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  core.setSecret(headerValue);
  return ['-c', `${headerKey}=`, '-c', `${headerKey}=${headerValue}`];
};

export const forcePush = async (
  cwd: string,
  branch: string,
  token: string,
): Promise<void> => {
  await runCommand(
    cwd,
    'git',
    [
      ...authArgs(token),
      'push',
      'origin',
      `HEAD:refs/heads/${branch}`,
      '--force',
    ],
    { label: 'git push' },
  );
};

// 既に存在する同一タグへの push は up-to-date の no-op になる（冪等）
export const pushRefs = async (
  cwd: string,
  refs: readonly string[],
  token: string,
): Promise<void> => {
  if (refs.length === 0) return;
  await runCommand(
    cwd,
    'git',
    [...authArgs(token), 'push', 'origin', ...refs],
    {
      label: 'git push (tags)',
    },
  );
};

export const tagExists = async (cwd: string, tag: string): Promise<boolean> => {
  const { exitCode } = await getExecOutput(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`],
    { cwd, silent: true, ignoreReturnCode: true },
  );
  return exitCode === 0;
};

// changesets 同様 lightweight タグ。ambient な tag.gpgSign 設定で annotated に
// 化けないよう明示的に無効化する（挙動を環境非依存にする）
export const createTag = async (cwd: string, tag: string): Promise<void> => {
  await git(cwd, ['-c', 'tag.gpgSign=false', 'tag', tag]);
};

export const isShallowRepository = async (cwd: string): Promise<boolean> =>
  (await git(cwd, ['rev-parse', '--is-shallow-repository'])) === 'true';

export const hasParentCommit = async (cwd: string): Promise<boolean> => {
  const { exitCode } = await getExecOutput(
    'git',
    ['rev-parse', '--verify', '--quiet', 'HEAD^'],
    { cwd, silent: true, ignoreReturnCode: true },
  );
  return exitCode === 0;
};

export const commitExists = async (
  cwd: string,
  sha: string,
): Promise<boolean> => {
  const { exitCode } = await getExecOutput(
    'git',
    ['cat-file', '-e', `${sha}^{commit}`],
    { cwd, silent: true, ignoreReturnCode: true },
  );
  return exitCode === 0;
};

export const showPrefix = (cwd: string): Promise<string> =>
  git(cwd, ['rev-parse', '--show-prefix']);

// rev 時点のファイル内容。存在しなければ null（初回リリース等）
export const readFileAtRev = async (
  cwd: string,
  rev: string,
  repoRelativePath: string,
): Promise<string | null> => {
  const { exitCode, stdout } = await getExecOutput(
    'git',
    ['show', `${rev}:${repoRelativePath}`],
    { cwd, silent: true, ignoreReturnCode: true },
  );
  return exitCode === 0 ? stdout : null;
};
