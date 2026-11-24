import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, expect, test } from 'vite-plus/test';

import rootManifest from '../package.json' with { type: 'json' };
import type { Inputs } from '../src/core/inputs.ts';
import type { PublishGroup } from '../src/core/publish-plan.ts';
import type { GhClient } from '../src/gh/client.ts';
import { runPublishMode } from '../src/modes/publish.ts';
import { applyVersion } from '../src/pnpm/version.ts';
import {
  initFixtureWorkspace,
  sh,
  startFakeRegistry,
  writeFixtureManifest,
} from './helpers.ts';

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pra-out-'));
  process.env.GITHUB_OUTPUT = join(dir, 'output');
  await writeFile(process.env.GITHUB_OUTPUT, '');
  // push イベント由来の before SHA 判定がテスト環境の env に引きずられないように
  delete process.env.GITHUB_EVENT_NAME;
});

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

// テストでは実レジストリに publish できないため、内蔵コマンドと同じ引数の
// dry-run 実行を注入する（summary は dry-run でも書かれることを検証済み）
const dryRunPublish = async (
  cwd: string,
  branch: string,
  group: PublishGroup,
): Promise<void> => {
  await sh(cwd, 'pnpm', [
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

const recordingPublish = (): {
  publish: typeof dryRunPublish;
  groups: PublishGroup[];
} => {
  const groups: PublishGroup[] = [];
  return {
    groups,
    publish: async (cwd, branch, group) => {
      groups.push(group);
      await dryRunPublish(cwd, branch, group);
    },
  };
};

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

test('publishes, tags, and creates a release with the changelog body', async () => {
  const dir = await releasedFixture();
  const { client, releases } = makeFakeClient();

  await runPublishMode(makeInputs(dir), client, dryRunPublish);

  expect(releases).toHaveLength(1);
  expect(releases[0]?.tag).toBe('v0.2.0');
  expect(releases[0]?.body).toContain('Add a fixture feature.');
  expect(releases[0]?.prerelease).toBe(false);
  // 単一パッケージなので v<version> タグが origin に push される
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toContain(
    'refs/tags/v0.2.0',
  );
});

test('a rerun with the tag and release in place is a no-op', async () => {
  const dir = await releasedFixture();
  const first = makeFakeClient();
  await runPublishMode(makeInputs(dir), first.client, dryRunPublish);

  const second = makeFakeClient(['v0.2.0']);
  await runPublishMode(makeInputs(dir), second.client, dryRunPublish);
  expect(second.releases).toHaveLength(0);
});

test('a first release is tagged at the manifest version', async () => {
  const dir = await releasedFixture({ published: false });
  const { client, releases } = makeFakeClient();

  await runPublishMode(makeInputs(dir), client, dryRunPublish);

  expect(releases).toHaveLength(1);
  expect(releases[0]?.tag).toBe('v0.1.0');
  expect(releases[0]?.body).toContain('Add a fixture feature.');
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toContain(
    'refs/tags/v0.1.0',
  );
});

test('private packages are tagged via the ledger even though nothing publishes', async () => {
  const dir = await releasedFixture({ private: true });
  const { client, releases } = makeFakeClient();

  await runPublishMode(makeInputs(dir), client, dryRunPublish);

  // publish は private をスキップし summary は空だが、ledger 差分がタグを補完する
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
  const { publish, groups } = recordingPublish();

  await runPublishMode(makeInputs(dir), client, publish);

  expect(groups).toStrictEqual([{ tag: 'latest', names: ['fixture-pkg'] }]);
});

test('the dist-tag input routes a stable release elsewhere', async () => {
  const dir = await releasedFixture();
  const { client } = makeFakeClient();
  const { publish, groups } = recordingPublish();

  await runPublishMode(
    { ...makeInputs(dir), distTag: 'latest-0' },
    client,
    publish,
  );

  expect(groups).toStrictEqual([{ tag: 'latest-0', names: ['fixture-pkg'] }]);
});

test('a release on latest becomes the repository Latest release', async () => {
  const dir = await releasedFixture();
  const { client, releases } = makeFakeClient();

  await runPublishMode(makeInputs(dir), client, dryRunPublish);

  expect(releases[0]?.makeLatest).toBe(true);
});

test('a release under another dist-tag stays off the repository Latest release', async () => {
  const dir = await releasedFixture();
  const { client, releases } = makeFakeClient();

  await runPublishMode(
    { ...makeInputs(dir), distTag: 'latest-0' },
    client,
    dryRunPublish,
  );

  expect(releases[0]?.makeLatest).toBe(false);
});

test('a stable release below the registry latest aborts before publishing', async () => {
  const dir = await versionedFixture('0.9.0', { version: '1.0.0' });
  const { client, releases } = makeFakeClient();
  const { publish, groups } = recordingPublish();

  await expect(
    runPublishMode(makeInputs(dir), client, publish),
  ).rejects.toThrow(/move the `latest` dist-tag back/u);
  expect(groups).toHaveLength(0);
  expect(releases).toHaveLength(0);
});

test('a maintenance dist-tag releases an older line below the registry latest', async () => {
  const dir = await versionedFixture('0.9.0', { version: '1.0.0' });
  const { client } = makeFakeClient();
  const { publish, groups } = recordingPublish();

  await runPublishMode(
    { ...makeInputs(dir), distTag: 'latest-0' },
    client,
    publish,
  );

  expect(groups).toStrictEqual([{ tag: 'latest-0', names: ['fixture-pkg'] }]);
});

test('a lane prerelease goes to its lane dist-tag', async () => {
  const dir = await versionedFixture('1.5.0-alpha.0', { published: false });
  const { client, releases } = makeFakeClient();
  const { publish, groups } = recordingPublish();

  await runPublishMode(makeInputs(dir), client, publish);

  expect(groups).toStrictEqual([{ tag: 'alpha', names: ['fixture-pkg'] }]);
  expect(releases[0]).toMatchObject({
    tag: 'v1.5.0-alpha.0',
    prerelease: true,
    makeLatest: false,
  });
});

test('a prerelease without a usable dist-tag in the release aborts before publishing', async () => {
  const dir = await versionedFixture('1.5.0-0', { published: false });
  const { client, releases } = makeFakeClient();
  const { publish, groups } = recordingPublish();

  await expect(
    runPublishMode(makeInputs(dir), client, publish),
  ).rejects.toThrow(/no dist-tag can be derived/u);
  expect(groups).toHaveLength(0);
  expect(releases).toHaveLength(0);
});

test('a prerelease without a usable dist-tag outside the release is left unpublished', async () => {
  const dir = await releasedFixture();
  // 手動バンプ相当: ledger に無い prerelease が manifest に残っている
  await writeFixtureManifest(dir, { version: '9.9.9-0' });
  await sh(dir, 'git', ['add', '-A']);
  await sh(dir, 'git', ['commit', '-q', '-m', 'manual prerelease bump']);
  const { client } = makeFakeClient();
  const { publish, groups } = recordingPublish();

  await expect(
    runPublishMode(makeInputs(dir), client, publish),
  ).resolves.toBeUndefined();
  expect(groups).toHaveLength(0);
});

test('a release mixing stable and lane packages publishes once per dist-tag', async () => {
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
    `registry: ${registry}\npackages:\n  - packages/*\n`,
  );
  const members = [
    ['pkg-stable', '1.1.0'],
    ['pkg-lane', '2.0.0-beta.0'],
  ] as const;
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
  const { client, releases } = makeFakeClient();
  const { publish, groups } = recordingPublish();

  await runPublishMode(makeInputs(root), client, publish);

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
      runPublishMode(makeInputs(dir), client, dryRunPublish),
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
    dryRunPublish,
  );

  expect(releases).toHaveLength(0);
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toBe('');
});
