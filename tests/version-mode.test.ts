import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Inputs } from '../src/core/inputs.ts';
import type { GhClient, PrRef } from '../src/gh/pr.ts';
import { currentRef } from '../src/git/repo.ts';
import { runVersionMode } from '../src/modes/version.ts';
import { applyVersion } from '../src/pnpm/version.ts';
import { initFixtureWorkspace, sh } from './helpers.ts';

// @actions/core の setOutput はファイルコマンド前提なので、テストでは書き捨て先を用意する
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pra-out-'));
  process.env.GITHUB_OUTPUT = join(dir, 'output');
  await writeFile(process.env.GITHUB_OUTPUT, '');
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
  syncLockfile: false,
  allowPrereleaseOnLatest: false,
  githubToken: 'dummy-token',
});

type RecordedCalls = {
  created: Array<{ head: string; base: string; title: string; body: string }>;
  updated: Array<{ nodeId: string; title: string; body: string }>;
};

const makeFakeClient = (
  existing: PrRef | null,
): { client: GhClient; calls: RecordedCalls } => {
  const calls: RecordedCalls = { created: [], updated: [] };
  const client: GhClient = {
    resolveBotUserId: () => Promise.resolve(1),
    findOpenPr: () => Promise.resolve(existing),
    createPr: (params) => {
      calls.created.push(params);
      return Promise.resolve({ number: 5, nodeId: 'NODE5' });
    },
    updatePr: (params) => {
      calls.updated.push(params);
      return Promise.resolve();
    },
    hasRelease: () => Promise.resolve(false),
    createRelease: () => Promise.resolve(),
  };
  return { client, calls };
};

const addOrigin = async (dir: string): Promise<string> => {
  const origin = await mkdtemp(join(tmpdir(), 'pra-origin-'));
  await sh(origin, 'git', ['init', '-q', '--bare', '-b', 'main']);
  await sh(dir, 'git', ['remote', 'add', 'origin', origin]);
  return origin;
};

test('creates a release PR when none is open', async () => {
  const dir = await initFixtureWorkspace();
  const origin = await addOrigin(dir);
  const { client, calls } = makeFakeClient(null);

  const result = await runVersionMode(makeInputs(dir), client);

  expect(result).toBe('completed');
  expect(calls.updated).toHaveLength(0);
  expect(calls.created).toHaveLength(1);
  expect(calls.created[0]?.head).toBe('pnpm-release/main');
  expect(calls.created[0]?.base).toBe('main');
  expect(calls.created[0]?.body).toContain('| `fixture-pkg` | 0.1.0 | 0.2.0 |');
  expect(calls.created[0]?.body).toContain('Add a fixture feature.');
  // release ブランチが origin に force-push されている
  expect(
    await sh(origin, 'git', ['rev-parse', 'refs/heads/pnpm-release/main']),
  ).toMatch(/^[0-9a-f]{40}$/u);
  // 後続 step のために元の ref に戻る
  expect(await currentRef(dir)).toBe('main');
});

test('updates the open release PR instead of creating a new one', async () => {
  const dir = await initFixtureWorkspace();
  await addOrigin(dir);
  const { client, calls } = makeFakeClient({ number: 7, nodeId: 'NODE7' });

  const result = await runVersionMode(makeInputs(dir), client);

  expect(result).toBe('completed');
  expect(calls.created).toHaveLength(0);
  expect(calls.updated).toHaveLength(1);
  expect(calls.updated[0]?.nodeId).toBe('NODE7');
});

test('an empty apply returns empty-apply without touching the PR API', async () => {
  const dir = await initFixtureWorkspace();
  await addOrigin(dir);
  // リリース済み状態を作る: intent は ledger 消費済みで、apply は空になる
  await applyVersion(dir);
  await sh(dir, 'git', ['add', '-A']);
  await sh(dir, 'git', ['commit', '-q', '-m', 'release']);
  const { client, calls } = makeFakeClient(null);

  const result = await runVersionMode(makeInputs(dir), client);

  expect(result).toBe('empty-apply');
  expect(calls.created).toHaveLength(0);
  expect(calls.updated).toHaveLength(0);
  expect(await currentRef(dir)).toBe('main');
});

test('a dirty tree aborts before any branch or PR work', async () => {
  const dir = await initFixtureWorkspace();
  await addOrigin(dir);
  await writeFile(join(dir, 'untracked.txt'), 'x');
  const { client, calls } = makeFakeClient(null);

  await expect(runVersionMode(makeInputs(dir), client)).rejects.toThrow(
    /untracked\.txt/u,
  );
  expect(calls.created).toHaveLength(0);
  expect(await currentRef(dir)).toBe('main');
  await rm(join(dir, 'untracked.txt'));
});
