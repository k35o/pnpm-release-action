import { mkdtemp, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';

import type { GhClient } from '../src/gh/client.ts';
import { run } from '../src/main.ts';
import { initFixtureWorkspace } from './helpers.ts';

const home = vi.hoisted(() => ({ dir: '' }));

// NPM_TOKEN の書き込み先を使い捨てのディレクトリに向ける。HOME 環境変数を差し替える
// と、子プロセスの pnpm（mise の shim など）が自分のインストール先を見失う
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof os>()),
  homedir: () => home.dir,
}));

let commands: string[] = [];

beforeEach(async () => {
  home.dir = await mkdtemp(join(os.tmpdir(), 'pra-home-'));
  // pnpm には ~/.npmrc の代わりに、同じ使い捨ての .npmrc を読ませる
  vi.stubEnv('NPM_CONFIG_USERCONFIG', join(home.dir, '.npmrc'));
  const output = join(await mkdtemp(join(os.tmpdir(), 'pra-out-')), 'output');
  await writeFile(output, '');
  vi.stubEnv('GITHUB_OUTPUT', output);
  vi.stubEnv('GITHUB_STEP_SUMMARY', undefined);
  vi.stubEnv('GITHUB_REPOSITORY', 'k35o/fixture');
  vi.stubEnv('INPUT_GITHUB-TOKEN', 'dummy-token');
  vi.stubEnv('INPUT_BASE-BRANCH', 'main');
  // 開発者の環境にある本物のトークンを拾わない
  vi.stubEnv('NPM_TOKEN', undefined);
  // run() は失敗を例外ではなく ::error:: で伝える。CI のランナーに解釈させずに集める
  commands = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    commands.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const makeFakeClient = (): { client: GhClient; prBodies: string[] } => {
  const prBodies: string[] = [];
  const client: GhClient = {
    owner: 'k35o',
    repo: 'fixture',
    resolveBotUserId: () => Promise.resolve(1),
    findOpenPr: () => Promise.resolve(null),
    createPr: (params) => {
      prBodies.push(params.body);
      return Promise.resolve({ number: 1, nodeId: 'N' });
    },
    updatePr: () => Promise.resolve(),
    hasRelease: () => Promise.resolve(false),
    createRelease: () => Promise.resolve(),
    resetBranch: () => Promise.resolve(),
    commitOnBranch: () => Promise.resolve('NEWSHA'),
    deleteBranch: () => Promise.resolve(),
    enableAutoMerge: () => Promise.resolve(),
  };
  return { client, prBodies };
};

test('NPM_TOKEN lets the release PR bump a restricted package', async () => {
  const dir = await initFixtureWorkspace({ restricted: true });
  vi.stubEnv('INPUT_CWD', dir);
  vi.stubEnv('NPM_TOKEN', 'fixture-token');
  const { client, prBodies } = makeFakeClient();

  await run(() => client);

  expect(commands.filter((line) => line.startsWith('::error::'))).toStrictEqual(
    [],
  );
  expect(prBodies).toHaveLength(1);
  expect(prBodies[0]).toContain('| `fixture-pkg` | 0.1.0 | 0.2.0 |');
});

test('without NPM_TOKEN the release PR lists a restricted package as unpublished', async () => {
  const dir = await initFixtureWorkspace({ restricted: true });
  vi.stubEnv('INPUT_CWD', dir);
  const { client, prBodies } = makeFakeClient();

  await run(() => client);

  expect(commands.filter((line) => line.startsWith('::error::'))).toStrictEqual(
    [],
  );
  expect(prBodies).toHaveLength(1);
  expect(prBodies[0]).toContain('| `fixture-pkg` | _unpublished_ | 0.1.0 |');
});
