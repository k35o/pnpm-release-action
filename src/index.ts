import * as core from '@actions/core';

import { InputError, parseInputs } from './core/inputs.ts';
import { PreflightError, assertPnpmVersion } from './pnpm/preflight.ts';

export const run = async (): Promise<void> => {
  try {
    const inputs = parseInputs(process.env);
    const pnpmVersion = await assertPnpmVersion(inputs.cwd);
    core.info(`Using pnpm ${pnpmVersion}`);
    core.setFailed(
      'pnpm-release-action is not functional yet: release-plan detection lands in a following PR.',
    );
  } catch (error) {
    if (error instanceof InputError || error instanceof PreflightError) {
      core.setFailed(error.message);
      return;
    }
    throw error;
  }
};

await run();
