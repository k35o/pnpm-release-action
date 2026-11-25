import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import * as core from '@actions/core';

import { distTagFor } from '../core/dist-tag.ts';
import type { Inputs } from '../core/inputs.ts';
import { releaseKey } from '../core/keys.ts';
import { diffLedger, parseLedger } from '../core/ledger.ts';
import type { LedgerEntry } from '../core/ledger.ts';
import { publishedTable } from '../core/markdown.ts';
import {
  buildReleaseTargets,
  planPublishGroups,
} from '../core/publish-plan.ts';
import type {
  PublishGroup,
  PublishedPackage,
  ReleaseTarget,
  WorkspacePackage,
} from '../core/publish-plan.ts';
import { isBelow } from '../core/semver.ts';
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
import { collectChangelogPreviews } from '../pnpm/changelogs.ts';
import {
  execStagePublish,
  fetchLatestVersion,
  fetchPublishedVersions,
  isSinglePackageWorkspace,
  listWorkspacePackages,
  readStageSummary,
} from '../pnpm/publish.ts';
import { runCommand } from '../proc.ts';

const APPROVAL_PAGE = 'https://www.npmjs.com/settings/~/staged-packages';

export type PublishModeDeps = {
  readonly stage: (
    cwd: string,
    publishBranch: string,
    group: PublishGroup,
  ) => Promise<void>;
  readonly approvalWait: {
    readonly timeoutMs: number;
    readonly intervalMs: number;
  };
};

const defaultDeps: PublishModeDeps = {
  stage: execStagePublish,
  approvalWait: { timeoutMs: 30 * 60_000, intervalMs: 15_000 },
};

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

const describe = (
  packages: ReadonlyArray<{
    readonly name: string;
    readonly version: string | null;
  }>,
): string =>
  packages.map((pkg) => `${pkg.name}@${String(pkg.version)}`).join(', ');

const minutes = (ms: number): string =>
  `${String(Math.round(ms / 60_000))} minutes`;

// dist-tag を決められない prerelease のうち、このリリースのものはエラー。過去の
// 残置や手動バンプは誤ブロックを避けて publish から外し warning に留める
const guardUntaggable = (
  untaggable: readonly WorkspacePackage[],
  inRelease: (pkg: WorkspacePackage) => boolean,
): void => {
  const blocking = untaggable.filter((pkg) => inRelease(pkg));
  if (blocking.length > 0) {
    throw new Error(
      `no dist-tag can be derived from these prerelease versions: ${describe(blocking)} — the prerelease identifier becomes the dist-tag, so it must not be numeric, \`latest\`, or readable as a semver range (use a lane name such as \`beta\`)`,
    );
  }
  if (untaggable.length > 0) {
    core.warning(
      `skipping prerelease versions that are not part of this release and have no usable dist-tag: ${describe(untaggable)}`,
    );
  }
};

const guardLatestDowngrade = async (
  cwd: string,
  candidates: readonly PublishedPackage[],
): Promise<void> => {
  const downgrades: string[] = [];
  for (const pkg of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const latest = await fetchLatestVersion(cwd, pkg.name);
    if (latest !== null && isBelow(pkg.version, latest)) {
      downgrades.push(`${pkg.name}@${pkg.version} (latest is ${latest})`);
    }
  }
  if (downgrades.length > 0) {
    throw new Error(
      `publishing would move the \`latest\` dist-tag back: ${downgrades.join(', ')} — set \`dist-tag\` (e.g. \`latest-3\`) when releasing an older line`,
    );
  }
};

const notOnRegistry = async (
  cwd: string,
  packages: readonly PublishedPackage[],
): Promise<PublishedPackage[]> => {
  const names = [...new Set(packages.map((pkg) => pkg.name))];
  const publishedByName = new Map(
    await Promise.all(
      names.map(
        async (name) =>
          [name, new Set(await fetchPublishedVersions(cwd, name))] as const,
      ),
    ),
  );
  return packages.filter(
    (pkg) => publishedByName.get(pkg.name)?.has(pkg.version) !== true,
  );
};

const announceStaged = async (
  staged: readonly PublishedPackage[],
  timeoutMs: number,
): Promise<void> => {
  core.warning(
    `Approve ${describe(staged)} with 2FA at ${APPROVAL_PAGE} (or \`npm stage approve <stage-id>\`). This run waits up to ${minutes(timeoutMs)} for npm to publish them before it pushes tags and creates GitHub Releases.`,
    { title: 'Staged on npm: waiting for approval' },
  );
  if (process.env.GITHUB_STEP_SUMMARY === undefined) return;
  const lines = [
    '### Staged on npm',
    '',
    `Publishing these versions needs a maintainer's approval with 2FA, on [Staged Packages](${APPROVAL_PAGE}) or with \`npm stage list\` and \`npm stage approve <stage-id>\`. The run waits up to ${minutes(timeoutMs)} before it pushes tags and creates GitHub Releases; after a timeout, approve the versions and re-run the job.`,
    '',
    publishedTable(staged),
    '',
  ];
  core.summary.addRaw(lines.join('\n'), true);
  await core.summary.write();
};

// npm は stage した版を、メンテナーが 2FA で承認するまで packument に載せない。
// 承認は OIDC ではできず npm からの通知も無いため、案内を出してから registry を見に行く
const waitForApproval = async (
  cwd: string,
  versions: readonly PublishedPackage[],
  wait: PublishModeDeps['approvalWait'],
): Promise<void> => {
  let pending = await notOnRegistry(cwd, versions);
  if (pending.length === 0) return;
  await announceStaged(pending, wait.timeoutMs);
  const deadline = Date.now() + wait.timeoutMs;
  while (pending.length > 0 && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(wait.intervalMs);
    // eslint-disable-next-line no-await-in-loop
    const remaining = await notOnRegistry(cwd, pending);
    const approved = pending.filter((pkg) => !remaining.includes(pkg));
    if (approved.length > 0) {
      core.info(`Published on npm: ${describe(approved)}`);
    }
    pending = remaining;
  }
  if (pending.length > 0) {
    throw new Error(
      `these staged versions were not approved within ${minutes(wait.timeoutMs)}: ${describe(pending)} — approve them at ${APPROVAL_PAGE}, then re-run this job to push the tags and create the GitHub Releases`,
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
  deps: PublishModeDeps = defaultDeps,
): Promise<void> => {
  const packages = await listWorkspacePackages(inputs.cwd);
  const released = await releasedByLedger(inputs.cwd);
  const releasedKeys = new Set(
    released.map((entry) => releaseKey(entry.name, entry.version)),
  );
  const inRelease = (pkg: WorkspacePackage): boolean =>
    pkg.version !== null && releasedKeys.has(releaseKey(pkg.name, pkg.version));
  const releasedPublic = packages.flatMap((pkg) =>
    !pkg.private && pkg.version !== null && inRelease(pkg)
      ? [{ name: pkg.name, version: pkg.version }]
      : [],
  );
  const { groups, untaggable } = planPublishGroups(packages, inputs.distTag);
  guardUntaggable(untaggable, inRelease);
  await guardLatestDowngrade(
    inputs.cwd,
    releasedPublic.filter(
      (pkg) => distTagFor(pkg.version, inputs.distTag) === 'latest',
    ),
  );
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
        `the \`build\` command left the working tree dirty, which would fail the git checks of \`pnpm stage publish\` — gitignore build outputs or make the build reproduce committed files exactly:\n${status
          .split('\n')
          .slice(0, 10)
          .join('\n')}`,
      );
    }
  }

  const staged: PublishedPackage[] = [];
  for (const group of groups) {
    // tag ごとの stage は summary ファイルを上書きするため直列にして毎回読む
    // eslint-disable-next-line no-await-in-loop
    await deps.stage(inputs.cwd, inputs.baseBranch, group);
    // eslint-disable-next-line no-await-in-loop
    staged.push(...(await readStageSummary(inputs.cwd)));
  }

  // 承認が時間切れになった後の re-run では、承認済みの版の stage を pnpm が
  // 飛ばして summary に載らない。このリリースの版も公開を確かめる対象に含め、
  // re-run がタグと outputs を回収できるようにする
  const published = [
    ...new Map(
      [...staged, ...releasedPublic].map((pkg) => [
        releaseKey(pkg.name, pkg.version),
        pkg,
      ]),
    ).values(),
  ];
  await waitForApproval(inputs.cwd, published, deps.approvalWait);
  core.setOutput('published', published.length > 0 ? 'true' : 'false');
  core.setOutput('published-packages', JSON.stringify(published));

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
        makeLatest: distTagFor(target.version, inputs.distTag) === 'latest',
      });
    }
  }
  core.info(`Released: ${targets.map((target) => target.tag).join(', ')}`);
  await appendStepSummary(published, targets);
};
