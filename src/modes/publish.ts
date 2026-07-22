import { readFile } from 'node:fs/promises';

import * as core from '@actions/core';

import type { Inputs } from '../core/inputs.ts';
import { releaseKey } from '../core/keys.ts';
import { diffLedger, parseLedger } from '../core/ledger.ts';
import type { LedgerEntry } from '../core/ledger.ts';
import { publishedTable } from '../core/markdown.ts';
import {
  buildReleaseTargets,
  findPrereleaseLeaks,
} from '../core/publish-plan.ts';
import type { ReleaseTarget } from '../core/publish-plan.ts';
import type { GhClient } from '../gh/client.ts';
import {
  commitExists,
  createTag,
  hasParentCommit,
  isShallowRepository,
  pushRefs,
  readFileAtRev,
  showPrefix,
  statusPorcelain,
  tagExists,
} from '../git/repo.ts';
import {
  collectChangelogPreviews,
  hasLanesConfigured,
} from '../pnpm/changelogs.ts';
import {
  ensureNpmAuth,
  execPublish,
  isSinglePackageWorkspace,
  listWorkspacePackages,
  readPublishSummary,
} from '../pnpm/publish.ts';
import { runCommand } from '../proc.ts';

// push イベントでは payload の before が push 前のリモート先端。multi-commit の
// 直 push だと HEAD^ は同じ push 内の中間コミットになり差分を取りこぼすため、
// 使えるときは before を基準にする
const pushBaseSha = async (cwd: string): Promise<string | null> => {
  if (process.env.GITHUB_EVENT_NAME !== 'push') return null;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined) return null;
  let before: string;
  try {
    const event = JSON.parse(await readFile(eventPath, 'utf8')) as {
      before?: unknown;
    };
    if (
      typeof event.before !== 'string' ||
      !/^[0-9a-f]{40}$/u.test(event.before) ||
      /^0{40}$/u.test(event.before)
    ) {
      // ブランチ新規作成の push などは before が zero SHA — first-parent に任せる
      return null;
    }
    ({ before } = event as { before: string });
  } catch {
    return null;
  }
  // before が取れているのに解決できないときに HEAD^ へ黙って落とすと、
  // multi-commit 直 push の取りこぼしが静かに再発するため名指しで止める
  if (!(await commitExists(cwd, before))) {
    throw new Error(
      `the push base commit ${before} is not available locally: check out with \`fetch-depth: 0\` so the released set can be computed`,
    );
  }
  return before;
};

// このリリースで増えた ledger エントリ = タグ/Release の対象（private 含む）
const releasedByLedger = async (cwd: string): Promise<LedgerEntry[]> => {
  const ledgerPath = `${(await showPrefix(cwd)).trim()}.changeset/ledger.yaml`;
  const current = parseLedger(await readFileAtRev(cwd, 'HEAD', ledgerPath));
  const base = await pushBaseSha(cwd);
  if (base !== null) {
    return diffLedger(
      current,
      parseLedger(await readFileAtRev(cwd, base, ledgerPath)),
    );
  }
  if (!(await hasParentCommit(cwd))) {
    if (await isShallowRepository(cwd)) {
      throw new Error(
        'cannot compute the released set on a shallow clone: use actions/checkout with `fetch-depth: 0`',
      );
    }
    // ルートコミット: ledger 全件が今回のリリース
    return diffLedger(current, new Map());
  }
  return diffLedger(
    current,
    parseLedger(await readFileAtRev(cwd, 'HEAD^', ledgerPath)),
  );
};

// prerelease ガード: このリリースに含まれる prerelease（lanes 由来など）はエラー、
// リリース対象外の prerelease（過去の残置・手動バンプ）は誤ブロックを避けて warning
const guardPrereleases = (
  packages: ReadonlyArray<{
    name: string;
    version: string | null;
    private: boolean;
    path: string;
  }>,
  released: readonly LedgerEntry[],
  allow: boolean,
): void => {
  const leaks = findPrereleaseLeaks(packages);
  if (leaks.length === 0) return;
  const releasedKeys = new Set(
    released.map((entry) => releaseKey(entry.name, entry.version)),
  );
  const inRelease = leaks.filter(
    (pkg) =>
      pkg.version !== null &&
      releasedKeys.has(releaseKey(pkg.name, pkg.version)),
  );
  const outside = leaks.filter((pkg) => !inRelease.includes(pkg));
  if (inRelease.length > 0 && !allow) {
    throw new Error(
      `prerelease versions are in this release and would land on the \`latest\` dist-tag: ${inRelease
        .map((pkg) => `${pkg.name}@${String(pkg.version)}`)
        .join(
          ', ',
        )} — set \`allow-prerelease-on-latest: true\` to proceed (dist-tag selection is not supported yet)`,
    );
  }
  if (outside.length > 0) {
    core.warning(
      `prerelease versions exist in the workspace but are not part of this release: ${outside
        .map((pkg) => `${pkg.name}@${String(pkg.version)}`)
        .join(
          ', ',
        )} — publish skips them if they are already on the registry, but check them if this is unexpected`,
    );
  }
};

const appendStepSummary = async (
  published: ReadonlyArray<{ name: string; version: string }>,
  targets: readonly ReleaseTarget[],
): Promise<void> => {
  if (process.env.GITHUB_STEP_SUMMARY === undefined) return;
  const lines = [
    '### Published',
    '',
    published.length === 0
      ? '_No packages were published to the registry._'
      : publishedTable(published),
    '',
    '### Tags / Releases',
    '',
    targets.length === 0
      ? '_None._'
      : targets.map((target) => `- \`${target.tag}\``).join('\n'),
  ];
  core.summary.addRaw(lines.join('\n'), true);
  await core.summary.write();
};

export const runPublishMode = async (
  inputs: Inputs,
  client: GhClient,
  publish: (cwd: string, publishBranch: string) => Promise<void> = execPublish,
): Promise<void> => {
  const packages = await listWorkspacePackages(inputs.cwd);
  const released = await releasedByLedger(inputs.cwd);
  guardPrereleases(packages, released, inputs.allowPrereleaseOnLatest);
  if (await hasLanesConfigured(inputs.cwd)) {
    core.warning(
      '`versioning.lanes` is configured, but lane -> dist-tag mapping is not supported yet: lane prereleases would go to `latest`',
    );
  }
  const singlePackage = await isSinglePackageWorkspace(inputs.cwd, packages);

  // publish 中の intent GC で parked changelog が消える可能性があるため先に読む
  const previews = await collectChangelogPreviews(
    inputs.cwd,
    released.map((entry) => ({ name: entry.name, newVersion: entry.version })),
  );

  if (inputs.build !== null) {
    await runCommand(inputs.cwd, 'bash', ['-ec', inputs.build], {
      label: inputs.build,
      stream: true,
    });
    // pnpm の git checks は publish 全体を止める上に、エラーが「--no-git-checks を
    // 使え」という本アクションでは実行不能な案内になるため、先に名指しで止める
    const status = await statusPorcelain(inputs.cwd);
    if (status !== '') {
      throw new Error(
        `the \`build\` command left the working tree dirty, which would fail pnpm's publish git checks — gitignore build outputs or make the build reproduce committed files exactly:\n${status
          .split('\n')
          .slice(0, 10)
          .join('\n')}`,
      );
    }
  }
  await ensureNpmAuth();

  // 部分失敗でも summary から outputs を先に設定してから exit code を伝播する
  let publishError: unknown = null;
  try {
    await publish(inputs.cwd, inputs.baseBranch);
  } catch (error) {
    publishError = error;
  }
  const published = await readPublishSummary(inputs.cwd);
  core.setOutput('published', published.length > 0 ? 'true' : 'false');
  core.setOutput('published-packages', JSON.stringify(published));
  if (publishError !== null) {
    throw publishError instanceof Error
      ? publishError
      : new Error(JSON.stringify(publishError));
  }

  const targets = buildReleaseTargets(published, released, singlePackage);
  if (targets.length === 0) {
    core.info('Nothing was published and the ledger shows no new releases.');
    await appendStepSummary(published, targets);
    return;
  }

  if (inputs.pushGitTags) {
    const missing = (
      await Promise.all(
        targets.map(async (target) =>
          (await tagExists(inputs.cwd, target.tag)) ? null : target.tag,
        ),
      )
    ).filter((tag): tag is string => tag !== null);
    for (const tag of missing) {
      // 同一リポジトリへの git 操作は index lock を共有するため直列にする
      // eslint-disable-next-line no-await-in-loop
      await createTag(inputs.cwd, tag);
    }
    await pushRefs(
      inputs.cwd,
      targets.map((target) => `refs/tags/${target.tag}`),
      inputs.githubToken,
    );
  }

  if (inputs.createGithubReleases) {
    const sectionFor = new Map(
      previews.map((preview) => [
        releaseKey(preview.name, preview.newVersion),
        preview.section,
      ]),
    );
    // summary 由来で ledger に無い対象（手動バンプ等）にもフォールバック連鎖を試す。
    // registry storage の parked は GC 済みかもしれないが、CHANGELOG.md は残る
    const uncovered = targets.filter(
      (target) => !sectionFor.has(releaseKey(target.name, target.version)),
    );
    if (uncovered.length > 0) {
      const extra = await collectChangelogPreviews(
        inputs.cwd,
        uncovered.map((target) => ({
          name: target.name,
          newVersion: target.version,
        })),
      );
      for (const preview of extra) {
        sectionFor.set(
          releaseKey(preview.name, preview.newVersion),
          preview.section,
        );
      }
    }
    for (const target of targets) {
      // GitHub API の secondary rate limit を避けるため Release 作成は直列にする
      // eslint-disable-next-line no-await-in-loop
      const exists = await client.hasRelease(target.tag);
      if (exists) continue;
      const section =
        sectionFor.get(releaseKey(target.name, target.version)) ?? null;
      if (section === null) {
        core.warning(
          `No changelog entry was found for ${target.name}@${target.version}: creating the release with a minimal body.`,
        );
      }
      // eslint-disable-next-line no-await-in-loop
      await client.createRelease({
        tag: target.tag,
        body: section ?? `Release ${target.name}@${target.version}.`,
        prerelease: target.version.includes('-'),
      });
    }
  }
  core.info(`Released: ${targets.map((target) => target.tag).join(', ')}`);
  await appendStepSummary(published, targets);
};
