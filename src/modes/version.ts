import * as core from '@actions/core';

import type { Inputs } from '../core/inputs.ts';
import { composePrBody } from '../core/pr-body.ts';
import type { GhClient } from '../gh/pr.ts';
import {
  assertCleanTree,
  checkout,
  commitAll,
  configureIdentity,
  currentRef,
  forcePush,
  rebuildBranch,
  revParseHead,
} from '../git/repo.ts';
import { collectChangelogPreviews } from '../pnpm/changelogs.ts';
import { applyVersion, syncLockfile } from '../pnpm/version.ts';

export const runVersionMode = async (
  inputs: Inputs,
  client: GhClient,
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
