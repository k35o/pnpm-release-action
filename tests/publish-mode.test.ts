import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, beforeEach, expect, test } from 'vite-plus/test';

import rootManifest from '../package.json' with { type: 'json' };
import type { Inputs } from '../src/core/inputs.ts';
import type { PublishGroup } from '../src/core/publish-plan.ts';
import type { GhClient } from '../src/gh/client.ts';
import { runPublishMode } from '../src/modes/publish.ts';
import type { PublishModeDeps } from '../src/modes/publish.ts';
import { applyVersion } from '../src/pnpm/version.ts';
import {
  fakeRegistryOf,
  initFixtureWorkspace,
  sh,
  startFakeRegistry,
  writeFixtureManifest,
} from './helpers.ts';
import type { FakeRegistry } from './helpers.ts';

let summaryPath = '';

beforeAll(async () => {
  // core.summary は最初に読んだ書き込み先を使い続けるため、ファイル全体で 1 つにする
  summaryPath = join(await mkdtemp(join(tmpdir(), 'pra-summary-')), 'summary');
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
  await writeFile(summaryPath, '');
  // push イベント由来の before SHA 判定がテスト環境の env に引きずられないように
  delete process.env.GITHUB_EVENT_NAME;
});

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pra-out-'));
  process.env.GITHUB_OUTPUT = join(dir, 'output');
  await writeFile(process.env.GITHUB_OUTPUT, '');
});

const readOutputs = async (): Promise<Record<string, string>> => {
  const content = await readFile(process.env.GITHUB_OUTPUT ?? '', 'utf8');
  return Object.fromEntries(
    [
      ...content.matchAll(
        /^(?<name>[^\n<]+)<<(?<delimiter>\S+)\n(?<value>[\s\S]*?)\n\k<delimiter>$/gmu,
      ),
    ].map((match) => [match.groups?.name, match.groups?.value]),
  );
};

const makeInputs = (cwd: string): Inputs => ({
  build: null,
  commitMessage: 'chore: prepare release',
  prTitle: 'chore: prepare release',
  baseBranch: 'main',
  branchPrefix: 'pnpm-release/',
  cwd,
  gitUser: { kind: 'keep' },
  createGithubReleases: true,
  pushGitTags: true,
  modeWhenClean: 'publish',
  commitMode: 'git-cli',
  autoMerge: false,
  syncLockfile: false,
  distTag: 'latest',
  githubToken: 'dummy-token',
});

type ReleaseCalls = Array<{
  tag: string;
  body: string;
  prerelease: boolean;
  makeLatest: boolean;
}>;

const makeFakeClient = (
  existingReleases: readonly string[] = [],
): { client: GhClient; releases: ReleaseCalls } => {
  const releases: ReleaseCalls = [];
  const client: GhClient = {
    owner: 'k35o',
    repo: 'better-css-modules',
    resolveBotUserId: () => Promise.resolve(1),
    findOpenPr: () => Promise.resolve(null),
    createPr: () => Promise.resolve({ number: 1, nodeId: 'N' }),
    updatePr: () => Promise.resolve(),
    hasRelease: (tag) => Promise.resolve(existingReleases.includes(tag)),
    createRelease: (params) => {
      releases.push(params);
      return Promise.resolve();
    },
    resetBranch: () => Promise.resolve(),
    commitOnBranch: () => Promise.resolve('NEWSHA'),
    deleteBranch: () => Promise.resolve(),
    enableAutoMerge: () => Promise.resolve(),
  };
  return { client, releases };
};

type Stage = PublishModeDeps['stage'];

// テストでは実レジストリに stage できないため、内蔵コマンドと同じ引数の
// dry-run 実行を注入する（summary は dry-run でも書かれることを検証済み）
const dryRunStage: Stage = async (cwd, branch, group) => {
  await sh(cwd, 'pnpm', [
    'stage',
    'publish',
    '-r',
    '--dry-run',
    '--report-summary',
    '--publish-branch',
    branch,
    '--tag',
    group.tag,
    ...group.names.flatMap((name) => ['--filter', name]),
    '--no-git-checks',
  ]);
};

const stagedVersions = async (
  cwd: string,
): Promise<Array<{ name: string; version: string }>> => {
  const summary = JSON.parse(
    await readFile(join(cwd, 'pnpm-publish-summary.json'), 'utf8'),
  ) as { publishedPackages: Array<{ name: string; version: string }> };
  return summary.publishedPackages;
};

const stageAndApprove =
  (
    registry: FakeRegistry,
    approve: (name: string) => boolean = () => true,
  ): Stage =>
  async (cwd, branch, group) => {
    await dryRunStage(cwd, branch, group);
    for (const { name, version } of await stagedVersions(cwd)) {
      if (approve(name)) registry.publish(name, version);
    }
  };

const recordingStage = (
  registry: FakeRegistry,
): { stage: Stage; groups: PublishGroup[] } => {
  const groups: PublishGroup[] = [];
  const stage = stageAndApprove(registry);
  return {
    groups,
    stage: async (cwd, branch, group) => {
      groups.push(group);
      await stage(cwd, branch, group);
    },
  };
};

const checkOnce: PublishModeDeps['approvalWait'] = {
  timeoutMs: 0,
  intervalMs: 0,
};

const deps = (stage: Stage, approvalWait = checkOnce): PublishModeDeps => ({
  stage,
  approvalWait,
});

const addOrigin = async (dir: string): Promise<void> => {
  const origin = await mkdtemp(join(tmpdir(), 'pra-origin-'));
  await sh(origin, 'git', ['init', '-q', '--bare', '-b', 'main']);
  await sh(dir, 'git', ['remote', 'add', 'origin', origin]);
};

const releasedFixture = async (
  options: Parameters<typeof initFixtureWorkspace>[0] = {},
): Promise<string> => {
  const dir = await initFixtureWorkspace(options);
  await applyVersion(dir);
  await sh(dir, 'git', ['add', '-A']);
  await sh(dir, 'git', ['commit', '-q', '-m', 'release']);
  await addOrigin(dir);
  return dir;
};

// lane の版は registry の公開状況から決まり、registry より低い版は version が作らない。
// どちらも applyVersion では作れないため、manifest と ledger を直接書いて
// `version` が `released` まで進めた直後の状態を再現する
const versionedFixture = async (
  version: string,
  options: Parameters<typeof initFixtureWorkspace>[0] = {},
): Promise<string> => {
  const dir = await initFixtureWorkspace(options);
  await writeFixtureManifest(dir, { version });
  await writeFile(
    join(dir, '.changeset', 'ledger.yaml'),
    `"fixture-pkg@${version}":\n  dir: .\n  intents: []\n`,
  );
  await sh(dir, 'git', ['add', '-A']);
  await sh(dir, 'git', ['commit', '-q', '-m', 'release']);
  await addOrigin(dir);
  return dir;
};

const monorepoFixture = async (
  members: ReadonlyArray<readonly [name: string, version: string]>,
): Promise<{ root: string; registry: FakeRegistry }> => {
  const root = await mkdtemp(join(tmpdir(), 'pra-mono-'));
  const registry = await startFakeRegistry({});
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'root',
      private: true,
      packageManager: rootManifest.packageManager,
    }),
  );
  await writeFile(
    join(root, 'pnpm-workspace.yaml'),
    `registry: ${registry.url}\npackages:\n  - packages/*\n`,
  );
  for (const [name, version] of members) {
    // eslint-disable-next-line no-await-in-loop
    await mkdir(join(root, 'packages', name), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await writeFile(
      join(root, 'packages', name, 'package.json'),
      JSON.stringify({ name, version }),
    );
  }
  await mkdir(join(root, '.changeset'));
  await sh(root, 'pnpm', ['install', '--lockfile-only']);
  await sh(root, 'git', ['init', '-q', '-b', 'main']);
  await sh(root, 'git', ['config', 'user.name', 'fixture']);
  await sh(root, 'git', ['config', 'user.email', 'fixture@example.com']);
  await sh(root, 'git', ['config', 'commit.gpgsign', 'false']);
  await sh(root, 'git', ['add', '-A']);
  await sh(root, 'git', ['commit', '-q', '-m', 'init']);
  await writeFile(
    join(root, '.changeset', 'ledger.yaml'),
    members
      .map(
        ([name, version]) =>
          `"${name}@${version}":\n  dir: packages/${name}\n  intents: []\n`,
      )
      .join(''),
  );
  await sh(root, 'git', ['add', '-A']);
  await sh(root, 'git', ['commit', '-q', '-m', 'release']);
  await addOrigin(root);
  return { root, registry };
};

test('tags and releases a staged version once npm approves it', async () => {
  const dir = await releasedFixture();
  const { client, releases } = makeFakeClient();

  await runPublishMode(
    makeInputs(dir),
    client,
    deps(stageAndApprove(fakeRegistryOf(dir))),
  );

  expect(releases).toHaveLength(1);
  expect(releases[0]?.tag).toBe('v0.2.0');
  expect(releases[0]?.body).toContain('Add a fixture feature.');
  expect(releases[0]?.prerelease).toBe(false);
  // 単一パッケージなので v<version> タグが origin に push される
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toContain(
    'refs/tags/v0.2.0',
  );
});

test('reports the approved versions as published', async () => {
  const dir = await releasedFixture();
  const { client } = makeFakeClient();

  await runPublishMode(
    makeInputs(dir),
    client,
    deps(stageAndApprove(fakeRegistryOf(dir))),
  );

  expect(await readOutputs()).toStrictEqual({
    published: 'true',
    'published-packages': '[{"name":"fixture-pkg","version":"0.2.0"}]',
  });
});

test('waits for an approval that arrives after staging', async () => {
  const dir = await releasedFixture();
  const registry = fakeRegistryOf(dir);
  const { client, releases } = makeFakeClient();
  const stage: Stage = async (cwd, branch, group) => {
    await dryRunStage(cwd, branch, group);
    setTimeout(() => {
      registry.publish('fixture-pkg', '0.2.0');
    }, 200);
  };

  await runPublishMode(
    makeInputs(dir),
    client,
    deps(stage, { timeoutMs: 60_000, intervalMs: 20 }),
  );

  expect(releases.map((release) => release.tag)).toStrictEqual(['v0.2.0']);
});

test('an unapproved version fails the run without tags or releases', async () => {
  const dir = await releasedFixture();
  const { client, releases } = makeFakeClient();

  await expect(
    runPublishMode(makeInputs(dir), client, deps(dryRunStage)),
  ).rejects.toThrow(/not approved.*fixture-pkg@0\.2\.0/u);
  expect(releases).toHaveLength(0);
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toBe('');
});

test('the job summary points at the approval page for the staged versions', async () => {
  const dir = await releasedFixture();
  const { client } = makeFakeClient();
  const before = await readFile(summaryPath, 'utf8');

  await expect(
    runPublishMode(makeInputs(dir), client, deps(dryRunStage)),
  ).rejects.toThrow(/not approved/u);

  const written = (await readFile(summaryPath, 'utf8')).slice(before.length);
  expect(written).toContain('| `fixture-pkg` | 0.2.0 |');
  expect(written).toContain('https://www.npmjs.com/settings/~/staged-packages');
});

test('a partially approved release pushes no tags', async () => {
  const { root, registry } = await monorepoFixture([
    ['pkg-a', '1.1.0'],
    ['pkg-b', '2.0.0'],
  ]);
  const { client, releases } = makeFakeClient();

  const error: unknown = await runPublishMode(
    makeInputs(root),
    client,
    deps(stageAndApprove(registry, (name) => name === 'pkg-a')),
  ).catch((caught: unknown) => caught);

  expect(String(error)).toContain('pkg-b@2.0.0');
  expect(String(error)).not.toContain('pkg-a@1.1.0');
  expect(releases).toHaveLength(0);
  expect(await sh(root, 'git', ['ls-remote', '--tags', 'origin'])).toBe('');
});

test('a rerun after a late approval tags the release and reports it as published', async () => {
  const dir = await releasedFixture();
  await expect(
    runPublishMode(makeInputs(dir), makeFakeClient().client, deps(dryRunStage)),
  ).rejects.toThrow(/not approved/u);
  fakeRegistryOf(dir).publish('fixture-pkg', '0.2.0');
  const { client, releases } = makeFakeClient();

  await runPublishMode(makeInputs(dir), client, deps(dryRunStage));

  expect(releases.map((release) => release.tag)).toStrictEqual(['v0.2.0']);
  expect(await readOutputs()).toStrictEqual({
    published: 'true',
    'published-packages': '[{"name":"fixture-pkg","version":"0.2.0"}]',
  });
});

test('a rerun with the tag and release in place is a no-op', async () => {
  const dir = await releasedFixture();
  const first = makeFakeClient();
  await runPublishMode(
    makeInputs(dir),
    first.client,
    deps(stageAndApprove(fakeRegistryOf(dir))),
  );

  const second = makeFakeClient(['v0.2.0']);
  await runPublishMode(makeInputs(dir), second.client, deps(dryRunStage));
  expect(second.releases).toHaveLength(0);
});

test('a first release is tagged at the manifest version', async () => {
  const dir = await releasedFixture({ published: false });
  const { client, releases } = makeFakeClient();

  await runPublishMode(
    makeInputs(dir),
    client,
    deps(stageAndApprove(fakeRegistryOf(dir))),
  );

  expect(releases).toHaveLength(1);
  expect(releases[0]?.tag).toBe('v0.1.0');
  expect(releases[0]?.body).toContain('Add a fixture feature.');
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toContain(
    'refs/tags/v0.1.0',
  );
});

test('private packages are tagged via the ledger without waiting for npm', async () => {
  const dir = await releasedFixture({ private: true });
  const { client, releases } = makeFakeClient();

  await runPublishMode(makeInputs(dir), client, deps(dryRunStage));

  // stage は private をスキップし summary は空だが、ledger 差分がタグを補完する
  expect(releases).toHaveLength(1);
  expect(releases[0]?.tag).toBe('v0.2.0');
  expect(releases[0]?.body).toContain('Add a fixture feature.');
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toContain(
    'refs/tags/v0.2.0',
  );
});

test('a stable release goes to the latest dist-tag', async () => {
  const dir = await releasedFixture();
  const { client } = makeFakeClient();
  const { stage, groups } = recordingStage(fakeRegistryOf(dir));

  await runPublishMode(makeInputs(dir), client, deps(stage));

  expect(groups).toStrictEqual([{ tag: 'latest', names: ['fixture-pkg'] }]);
});

test('the dist-tag input routes a stable release elsewhere', async () => {
  const dir = await releasedFixture();
  const { client } = makeFakeClient();
  const { stage, groups } = recordingStage(fakeRegistryOf(dir));

  await runPublishMode(
    { ...makeInputs(dir), distTag: 'latest-0' },
    client,
    deps(stage),
  );

  expect(groups).toStrictEqual([{ tag: 'latest-0', names: ['fixture-pkg'] }]);
});

test('a release on latest becomes the repository Latest release', async () => {
  const dir = await releasedFixture();
  const { client, releases } = makeFakeClient();

  await runPublishMode(
    makeInputs(dir),
    client,
    deps(stageAndApprove(fakeRegistryOf(dir))),
  );

  expect(releases[0]?.makeLatest).toBe(true);
});

test('a release under another dist-tag stays off the repository Latest release', async () => {
  const dir = await releasedFixture();
  const { client, releases } = makeFakeClient();

  await runPublishMode(
    { ...makeInputs(dir), distTag: 'latest-0' },
    client,
    deps(stageAndApprove(fakeRegistryOf(dir))),
  );

  expect(releases[0]?.makeLatest).toBe(false);
});

test('a stable release below the registry latest aborts before staging', async () => {
  const dir = await versionedFixture('0.9.0', { version: '1.0.0' });
  const { client, releases } = makeFakeClient();
  const { stage, groups } = recordingStage(fakeRegistryOf(dir));

  await expect(
    runPublishMode(makeInputs(dir), client, deps(stage)),
  ).rejects.toThrow(/move the `latest` dist-tag back/u);
  expect(groups).toHaveLength(0);
  expect(releases).toHaveLength(0);
});

test('a maintenance dist-tag releases an older line below the registry latest', async () => {
  const dir = await versionedFixture('0.9.0', { version: '1.0.0' });
  const { client } = makeFakeClient();
  const { stage, groups } = recordingStage(fakeRegistryOf(dir));

  await runPublishMode(
    { ...makeInputs(dir), distTag: 'latest-0' },
    client,
    deps(stage),
  );

  expect(groups).toStrictEqual([{ tag: 'latest-0', names: ['fixture-pkg'] }]);
});

test('a lane prerelease goes to its lane dist-tag', async () => {
  const dir = await versionedFixture('1.5.0-alpha.0', { published: false });
  const { client, releases } = makeFakeClient();
  const { stage, groups } = recordingStage(fakeRegistryOf(dir));

  await runPublishMode(makeInputs(dir), client, deps(stage));

  expect(groups).toStrictEqual([{ tag: 'alpha', names: ['fixture-pkg'] }]);
  expect(releases[0]).toMatchObject({
    tag: 'v1.5.0-alpha.0',
    prerelease: true,
    makeLatest: false,
  });
});

test('a prerelease without a usable dist-tag in the release aborts before staging', async () => {
  const dir = await versionedFixture('1.5.0-0', { published: false });
  const { client, releases } = makeFakeClient();
  const { stage, groups } = recordingStage(fakeRegistryOf(dir));

  await expect(
    runPublishMode(makeInputs(dir), client, deps(stage)),
  ).rejects.toThrow(/no dist-tag can be derived/u);
  expect(groups).toHaveLength(0);
  expect(releases).toHaveLength(0);
});

test('a prerelease without a usable dist-tag outside the release is left unstaged', async () => {
  const dir = await releasedFixture();
  // 手動バンプ相当: ledger に無い prerelease が manifest に残っている
  await writeFixtureManifest(dir, { version: '9.9.9-0' });
  await sh(dir, 'git', ['add', '-A']);
  await sh(dir, 'git', ['commit', '-q', '-m', 'manual prerelease bump']);
  const { client } = makeFakeClient();
  const { stage, groups } = recordingStage(fakeRegistryOf(dir));

  await expect(
    runPublishMode(makeInputs(dir), client, deps(stage)),
  ).resolves.toBeUndefined();
  expect(groups).toHaveLength(0);
});

test('a release mixing stable and lane packages stages once per dist-tag', async () => {
  const { root, registry } = await monorepoFixture([
    ['pkg-stable', '1.1.0'],
    ['pkg-lane', '2.0.0-beta.0'],
  ]);
  const { client, releases } = makeFakeClient();
  const { stage, groups } = recordingStage(registry);

  await runPublishMode(makeInputs(root), client, deps(stage));

  expect(groups).toHaveLength(2);
  expect(groups).toContainEqual({ tag: 'latest', names: ['pkg-stable'] });
  expect(groups).toContainEqual({ tag: 'beta', names: ['pkg-lane'] });
  expect(releases.map((release) => release.tag).toSorted()).toStrictEqual([
    'pkg-lane@2.0.0-beta.0',
    'pkg-stable@1.1.0',
  ]);
});

test('an unreachable push base aborts instead of silently using HEAD^', async () => {
  const dir = await releasedFixture();
  const { client } = makeFakeClient();
  const eventPath = join(
    await mkdtemp(join(tmpdir(), 'pra-event-')),
    'event.json',
  );
  // ローカルに存在しない before SHA を持つ push イベントを偽装する
  await writeFile(eventPath, JSON.stringify({ before: 'a'.repeat(40) }));
  process.env.GITHUB_EVENT_NAME = 'push';
  process.env.GITHUB_EVENT_PATH = eventPath;
  try {
    await expect(
      runPublishMode(makeInputs(dir), client, deps(dryRunStage)),
    ).rejects.toThrow(/fetch-depth/u);
  } finally {
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_EVENT_PATH;
  }
});

test('push-git-tags: false skips tagging entirely', async () => {
  const dir = await releasedFixture();
  const { client, releases } = makeFakeClient();

  await runPublishMode(
    { ...makeInputs(dir), pushGitTags: false, createGithubReleases: false },
    client,
    deps(stageAndApprove(fakeRegistryOf(dir))),
  );

  expect(releases).toHaveLength(0);
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toBe('');
});
