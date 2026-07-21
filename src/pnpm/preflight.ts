import { getExecOutput } from '@actions/exec';

import { satisfiesMinimum } from '../core/semver.ts';

export const MIN_PNPM_VERSION = '11.13.0';

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
