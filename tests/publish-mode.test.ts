import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Inputs } from '../src/core/inputs.ts';
import type { GhClient } from '../src/gh/pr.ts';
import { runPublishMode } from '../src/modes/publish.ts';
import { applyVersion } from '../src/pnpm/version.ts';
import { initFixtureWorkspace, sh } from './helpers.ts';

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pra-out-'));
  process.env.GITHUB_OUTPUT = join(dir, 'output');
  await writeFile(process.env.GITHUB_OUTPUT, '');
  // ensureNpmAuth が実 ~/.npmrc に本物のトークンを書かないように必ず外す
  delete process.env.NPM_TOKEN;
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
  allowPrereleaseOnLatest: false,
  githubToken: 'dummy-token',
});

type ReleaseCalls = Array<{ tag: string; body: string; prerelease: boolean }>;

const makeFakeClient = (
  existingReleases: readonly string[] = [],
): { client: GhClient; releases: ReleaseCalls } => {
  const releases: ReleaseCalls = [];
  const client: GhClient = {
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
    commitOnBranch: () => Promise.resolve(),
    enableAutoMerge: () => Promise.resolve(),
  };
  return { client, releases };
};

// テストでは実レジストリに publish できないため、内蔵コマンドと同じ引数の
// dry-run 実行を注入する（summary は dry-run でも書かれることを検証済み）
const dryRunPublish = async (cwd: string, branch: string): Promise<void> => {
  await sh(cwd, 'pnpm', [
    'publish',
    '-r',
    '--dry-run',
    '--report-summary',
    '--publish-branch',
    branch,
    '--no-git-checks',
  ]);
};

const releasedFixture = async (
  options: Parameters<typeof initFixtureWorkspace>[0] = {},
): Promise<string> => {
  const dir = await initFixtureWorkspace(options);
  await applyVersion(dir);
  await sh(dir, 'git', ['add', '-A']);
  await sh(dir, 'git', ['commit', '-q', '-m', 'release']);
  const origin = await mkdtemp(join(tmpdir(), 'pra-origin-'));
  await sh(origin, 'git', ['init', '-q', '--bare', '-b', 'main']);
  await sh(dir, 'git', ['remote', 'add', 'origin', origin]);
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

test('private packages are tagged via the ledger even though nothing publishes', async () => {
  const dir = await releasedFixture({ private: true });
  const { client, releases } = makeFakeClient();

  await runPublishMode(makeInputs(dir), client, dryRunPublish);

  // publish は private をスキップし summary は空だが、ledger 差分がタグを補完する
  expect(releases).toHaveLength(1);
  expect(releases[0]?.tag).toBe('v0.2.0');
  expect(await sh(dir, 'git', ['ls-remote', '--tags', 'origin'])).toContain(
    'refs/tags/v0.2.0',
  );
});

test('a prerelease in the released set aborts before publishing', async () => {
  // lanes 相当の状態を再現: ledger にも manifest にも prerelease
  const dir = await initFixtureWorkspace({ version: '1.5.0-alpha.0' });
  await writeFile(
    join(dir, '.changeset', 'ledger.yaml'),
    '"fixture-pkg@1.5.0-alpha.0":\n  dir: .\n  intents: []\n',
  );
  await sh(dir, 'git', ['add', '-A']);
  await sh(dir, 'git', ['commit', '-q', '-m', 'lane release']);
  const { client, releases } = makeFakeClient();

  await expect(
    runPublishMode(makeInputs(dir), client, dryRunPublish),
  ).rejects.toThrow(/allow-prerelease-on-latest/u);
  expect(releases).toHaveLength(0);
});

test('a prerelease outside the released set warns instead of blocking', async () => {
  const dir = await releasedFixture();
  // 手動バンプ相当: ledger に無い prerelease が manifest に残っている
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture-pkg',
      version: '9.9.9-beta.0',
      packageManager: 'pnpm@11.15.1',
    }),
  );
  await sh(dir, 'git', ['add', '-A']);
  await sh(dir, 'git', ['commit', '-q', '-m', 'manual prerelease bump']);
  const { client } = makeFakeClient();

  // throw せず完走する（対象外 prerelease は warning 止まり）
  await expect(
    runPublishMode(makeInputs(dir), client, dryRunPublish),
  ).resolves.toBeUndefined();
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
