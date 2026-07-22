import * as core from '@actions/core';

import { InputError, detectTokenMismatch, parseInputs } from './core/inputs.ts';
import { type Mode, decideMode } from './core/mode.ts';
import type { PlanEntry } from './core/plan.ts';
import { createGhClient } from './gh/pr.ts';
import { runPublishMode } from './modes/publish.ts';
import { runVersionMode } from './modes/version.ts';
import { assertPnpmVersion } from './pnpm/preflight.ts';
import { detectPlan } from './pnpm/version.ts';

const setPlanOutputs = (mode: Mode, plan: readonly PlanEntry[]): void => {
  core.setOutput('mode', mode);
  core.setOutput('has-pending-changes', plan.length > 0 ? 'true' : 'false');
  core.setOutput('published', 'false');
  core.setOutput('published-packages', '[]');
  core.setOutput('pr-number', '');
};

const writeSummary = async (
  mode: Mode,
  plan: readonly PlanEntry[],
): Promise<void> => {
  if (process.env.GITHUB_STEP_SUMMARY === undefined) return;
  const lines = ['## pnpm-release-action', '', `Mode: \`${mode}\``, ''];
  if (plan.length > 0) {
    lines.push(
      '| Package | From | To |',
      '| --- | --- | --- |',
      ...plan.map(
        (entry) =>
          `| \`${entry.name}\` | ${entry.currentVersion} | ${entry.newVersion} |`,
      ),
    );
  } else {
    lines.push('No pending change intents.');
  }
  core.summary.addRaw(lines.join('\n'), true);
  await core.summary.write();
};

export const run = async (): Promise<void> => {
  let mode: Mode | null = null;
  let plan: readonly PlanEntry[] = [];
  try {
    const inputs = parseInputs(process.env);
    core.setSecret(inputs.githubToken);
    const tokenWarning = detectTokenMismatch(process.env, inputs.githubToken);
    if (tokenWarning !== null) core.warning(tokenWarning);
    const pnpmVersion = await assertPnpmVersion(inputs.cwd);
    core.info(`Using pnpm ${pnpmVersion}`);

    plan = await detectPlan(inputs.cwd);
    mode = decideMode(plan.length > 0, inputs.modeWhenClean);
    setPlanOutputs(mode, plan);

    if (mode === 'none') {
      core.info(
        'No pending changes and `mode-when-clean` is `none`: nothing to do.',
      );
    } else {
      const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
      if (
        owner === undefined ||
        owner === '' ||
        repo === undefined ||
        repo === ''
      ) {
        throw new InputError(['GITHUB_REPOSITORY is not set']);
      }
      const client = createGhClient(inputs.githubToken, owner, repo);
      if (mode === 'version') {
        const result = await runVersionMode(inputs, client);
        if (result === 'empty-apply') {
          // 検出とのレースで適用が空になった: outputs も要約も「何もしていない」に正す
          mode = 'none';
          plan = [];
          setPlanOutputs('none', []);
          core.warning(
            'The release plan became empty when applied: nothing to release.',
          );
        }
      } else {
        await runPublishMode(inputs, client);
      }
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack !== undefined) {
      core.debug(error.stack);
    }
  } finally {
    if (mode !== null) {
      await writeSummary(mode, plan).catch(() => undefined);
    }
  }
};
