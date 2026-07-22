import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as core from '@actions/core';

import { parsePorcelain } from '../core/file-changes.ts';
import type { Inputs } from '../core/inputs.ts';
import { composePrBody } from '../core/pr-body.ts';
import { isAutoMergeUnavailable } from '../gh/pr.ts';
import type { GhClient } from '../gh/pr.ts';
import {
  assertCleanTree,
  checkout,
  commitAll,
  configureIdentity,
  currentRef,
  forcePush,
  rebuildBranch,
  repoToplevel,
  restoreCleanTree,
  revParseHead,
  statusPorcelainZ,
} from '../git/repo.ts';
import { collectChangelogPreviews } from '../pnpm/changelogs.ts';
import { applyVersion, syncLockfile } from '../pnpm/version.ts';

// github-api モード: createCommitOnBranch でコミットを作る。トークンの主体
// （App / github-actions）として GitHub が署名するため required_signatures を
// 満たし、release PR を auto-merge まで人手ゼロで流せる
// createCommitOnBranch は単一リクエストなので、巨大 lockfile 等で膨らみすぎたら
// 実行前に actionable なエラーで止める（base64 で ~33% 膨張する）
const MAX_API_COMMIT_BYTES = 30 * 1024 * 1024;

const commitViaApi = async (
  inputs: Inputs,
  client: GhClient,
  branch: string,
  triggerSha: string,
  toplevel: string,
): Promise<void> => {
  const changes = parsePorcelain(await statusPorcelainZ(toplevel));
  if (changes.additions.length === 0 && changes.deletions.length === 0) {
    core.info('Nothing to commit: the release plan produced no file changes.');
    return;
  }
  const additions = await Promise.all(
    changes.additions.map(async (path) => ({
      path,
      contents: (await readFile(join(toplevel, path))).toString('base64'),
    })),
  );
  const payloadBytes = additions.reduce(
    (sum, entry) => sum + entry.contents.length,
    0,
  );
  if (payloadBytes > MAX_API_COMMIT_BYTES) {
    throw new Error(
      `the version commit is too large for the GitHub API (${String(Math.round(payloadBytes / 1024 / 1024))} MiB encoded): set \`commit-mode: git-cli\``,
    );
  }
  // リリースブランチを直接 base に reset してからコミットすると、その間に PR が
  // 「base と同一」になり GitHub が auto-close する（force 変更後は reopen 不能 —
  // 初回のセルフリリースで実際に踏んだ）。一時ブランチで署名コミットを作り、
  // 本ブランチは旧 head から新コミットへ原子的に force 移動する
  const staging = `${branch}--staging`;
  await client.resetBranch({ branch: staging, sha: triggerSha });
  try {
    const newSha = await client.commitOnBranch({
      branch: staging,
      expectedHeadOid: triggerSha,
      message: inputs.commitMessage,
      additions,
      deletions: changes.deletions.map((path) => ({ path })),
    });
    await client.resetBranch({ branch, sha: newSha });
  } finally {
    await client.deleteBranch(staging).catch(() => undefined);
  }
};

const commitViaGit = async (inputs: Inputs, branch: string): Promise<void> => {
  const committed = await commitAll(inputs.cwd, inputs.commitMessage);
  if (!committed) {
    core.info('Nothing to commit: the release branch is already up to date.');
  }
  await forcePush(inputs.cwd, branch, inputs.githubToken);
};

// repo 設定や PR 状態で arming だけが不可能なケースは、release PR は既に作れている
// ので run を失敗させず warning で直し方を示す。想定外のエラーは fatal のまま流す。
const armAutoMerge = async (
  client: GhClient,
  nodeId: string,
  number: number,
): Promise<void> => {
  try {
    await client.enableAutoMerge({ nodeId, number });
    core.info(`Auto-merge is armed on release PR #${String(number)}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isAutoMergeUnavailable(message)) throw error;
    core.warning(
      `Auto-merge could not be armed on release PR #${String(number)}: ${message}. ` +
        'Enable auto-merge for this repository (Settings → General → "Allow auto-merge", ' +
        `or run \`gh api repos/${client.owner}/${client.repo} -X PATCH -F allow_auto_merge=true\`), ` +
        'or set `auto-merge: false`. The release PR is ready to merge manually.',
    );
  }
};

export const runVersionMode = async (
  inputs: Inputs,
  client: GhClient,
): Promise<'completed' | 'empty-apply'> => {
  if (inputs.commitMode === 'git-cli') {
    // API コミットでは identity はトークンの主体から決まるため、git-cli のときだけ
    await configureIdentity(
      inputs.cwd,
      inputs.gitUser,
      client.resolveBotUserId,
    );
  }
  await assertCleanTree(inputs.cwd);

  const branch = `${inputs.branchPrefix}${inputs.baseBranch}`;
  const triggerSha = await revParseHead(inputs.cwd);
  const originalRef = await currentRef(inputs.cwd);
  const toplevel = await repoToplevel(inputs.cwd);
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
    if (inputs.commitMode === 'github-api') {
      await commitViaApi(inputs, client, branch, triggerSha, toplevel);
    } else {
      await commitViaGit(inputs, branch);
    }

    let prNumber: number;
    let prNodeId: string;
    if (existing === null) {
      const created = await client.createPr({
        head: branch,
        base: inputs.baseBranch,
        title: inputs.prTitle,
        body,
      });
      prNumber = created.number;
      prNodeId = created.nodeId;
    } else {
      await client.updatePr({
        nodeId: existing.nodeId,
        title: inputs.prTitle,
        body,
      });
      prNumber = existing.number;
      prNodeId = existing.nodeId;
    }
    // arming が失敗しても PR 自体は存在するので、出力を先に確定させる
    core.setOutput('pr-number', String(prNumber));
    if (inputs.autoMerge) {
      await armAutoMerge(client, prNodeId, prNumber);
    }
    core.info(`Release PR #${String(prNumber)} is ready.`);
    return 'completed';
  } finally {
    if (inputs.commitMode === 'github-api') {
      // API モードは適用結果をローカルにコミットしないため、放置すると base
      // ブランチが dirty なまま後続 step に渡ってしまう。開始時に clean を保証
      // 済みなので、ここでの reset/clean は version 適用分だけを確実に消す
      await restoreCleanTree(toplevel).catch(() => undefined);
    }
    // 後続の workflow step がリリースブランチ上で走らないよう、元の ref に戻す
    await checkout(inputs.cwd, originalRef).catch(() => undefined);
  }
};
