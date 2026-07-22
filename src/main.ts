import * as core from '@actions/core';

import {
  InputError,
  type Inputs,
  detectTokenMismatch,
  parseInputs,
} from './core/inputs.ts';
import { type Mode, decideMode } from './core/mode.ts';
import type { PlanEntry } from './core/plan.ts';
import { composePrBody } from './core/pr-body.ts';
import { type PrClient, createPrClient } from './gh/pr.ts';
import {
  assertCleanTree,
  checkout,
  commitAll,
  configureIdentity,
  currentRef,
  forcePush,
  rebuildBranch,
  revParseHead,
} from './git/repo.ts';
import { collectChangelogPreviews } from './pnpm/changelogs.ts';
import { assertPnpmVersion } from './pnpm/preflight.ts';
import { applyVersion, detectPlan, syncLockfile } from './pnpm/version.ts';

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

export const runVersionMode = async (
  inputs: Inputs,
  client: PrClient,
): Promise<'completed' | 'empty-apply'> => {
  await configureIdentity(inputs.cwd, inputs.gitUser, client.resolveBotUserId);
  await assertCleanTree(inputs.cwd);

  const branch = `${inputs.branchPrefix}${inputs.baseBranch}`;
  const triggerSha = await revParseHead(inputs.cwd);
  const originalRef = await currentRef(inputs.cwd);
  await rebuildBranch(inputs.cwd, branch, triggerSha);
  try {
    const plan = await applyVersion(inputs.cwd);
    if (plan.length === 0) return 'empty-apply';
    if (inputs.syncLockfile) await syncLockfile(inputs.cwd);

    const previews = await collectChangelogPreviews(inputs.cwd, plan);
    const body = composePrBody(plan, previews);

    // 自動 close とのレースに備え、push の前に既存 PR を取得しておく
    const existing = await client.findOpenPr({
      head: branch,
      base: inputs.baseBranch,
    });
    const committed = await commitAll(inputs.cwd, inputs.commitMessage);
    if (!committed) {
      core.info('Nothing to commit: the release branch is already up to date.');
    }
    await forcePush(inputs.cwd, branch, inputs.githubToken);

    let prNumber: number;
    if (existing === null) {
      const created = await client.createPr({
        head: branch,
        base: inputs.baseBranch,
        title: inputs.prTitle,
        body,
      });
      prNumber = created.number;
    } else {
      await client.updatePr({
        nodeId: existing.nodeId,
        title: inputs.prTitle,
        body,
      });
      prNumber = existing.number;
    }
    core.setOutput('pr-number', String(prNumber));
    core.info(`Release PR #${String(prNumber)} is ready.`);
    return 'completed';
  } finally {
    // 後続の workflow step がリリースブランチ上で走らないよう、元の ref に戻す
    await checkout(inputs.cwd, originalRef).catch(() => undefined);
  }
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

    if (mode === 'version') {
      const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
      if (
        owner === undefined ||
        owner === '' ||
        repo === undefined ||
        repo === ''
      ) {
        throw new InputError(['GITHUB_REPOSITORY is not set']);
      }
      const client = createPrClient(inputs.githubToken, owner, repo);
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
    } else if (mode === 'publish') {
      core.setFailed(
        'publish mode is not implemented yet: it lands in a following PR.',
      );
    } else {
      core.info(
        'No pending changes and `mode-when-clean` is `none`: nothing to do.',
      );
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

await run();
