import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import * as core from '@actions/core';
import { getExecOutput } from '@actions/exec';

import { satisfiesMinimum } from '../core/semver.ts';

// 12.7.0 より前の pnpm は private パッケージにもレジストリの公開確認を掛け、未公開
// （private は常にそう）だと bump しない
export const MIN_PNPM_VERSION = '12.7.0';

export class PreflightError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PreflightError';
  }
}

export const assertPnpmVersion = async (cwd: string): Promise<string> => {
  let stdout: string;
  try {
    ({ stdout } = await getExecOutput('pnpm', ['--version'], {
      cwd,
      silent: true,
    }));
  } catch (error) {
    // 失敗原因は pnpm 不在とは限らない（cwd の typo 等）ので、元のメッセージを必ず面に出す
    const detail = error instanceof Error ? error.message : String(error);
    throw new PreflightError(
      `failed to run \`pnpm --version\`: ${detail} — make sure pnpm is installed before this action (e.g. pnpm/action-setup or mise) and \`cwd\` points at the workspace`,
      { cause: error },
    );
  }
  const version = stdout.trim();
  if (!satisfiesMinimum(version, MIN_PNPM_VERSION)) {
    throw new PreflightError(
      `pnpm ${version} is too old: built-in release management needs pnpm >= ${MIN_PNPM_VERSION}`,
    );
  }
  return version;
};

// npm 認証: OIDC trusted publishing が正で、NPM_TOKEN があるときだけ
// $HOME/.npmrc へガード付きで追記する（既存の authToken 行には触れない）
export const ensureNpmAuth = async (): Promise<void> => {
  const token = process.env.NPM_TOKEN;
  if (token === undefined || token === '') return;
  core.setSecret(token);
  const npmrc = join(homedir(), '.npmrc');
  let existing: string;
  try {
    existing = await readFile(npmrc, 'utf8');
  } catch {
    existing = '';
  }
  if (existing.includes('registry.npmjs.org/:_authToken=')) return;
  const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
  await writeFile(
    npmrc,
    `${existing}${prefix}//registry.npmjs.org/:_authToken=${token}\n`,
  );
};
