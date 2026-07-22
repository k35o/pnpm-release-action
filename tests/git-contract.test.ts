import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertCleanTree,
  checkout,
  commitAll,
  currentRef,
  forcePush,
  rebuildBranch,
  revParseHead,
} from '../src/git/repo.ts';
import { initFixtureWorkspace, sh } from './helpers.ts';

test('rebuilds, commits, and force-pushes the release branch', async () => {
  const origin = await mkdtemp(join(tmpdir(), 'pra-origin-'));
  await sh(origin, 'git', ['init', '-q', '--bare', '-b', 'main']);
  const dir = await initFixtureWorkspace();
  await sh(dir, 'git', ['remote', 'add', 'origin', origin]);

  const sha = await revParseHead(dir);
  await rebuildBranch(dir, 'pnpm-release/main', sha);
  await writeFile(join(dir, 'bumped.txt'), 'v1');
  expect(await commitAll(dir, 'chore: prepare release')).toBe(true);
  await forcePush(dir, 'pnpm-release/main', 'dummy-token');
  expect(
    await sh(origin, 'git', ['rev-parse', 'refs/heads/pnpm-release/main']),
  ).toBe(await revParseHead(dir));

  // 再実行: 同じ SHA から作り直して force-push しても収束する
  await rebuildBranch(dir, 'pnpm-release/main', sha);
  await writeFile(join(dir, 'bumped.txt'), 'v1');
  expect(await commitAll(dir, 'chore: prepare release')).toBe(true);
  await forcePush(dir, 'pnpm-release/main', 'dummy-token');
  expect(
    await sh(origin, 'git', ['rev-parse', 'refs/heads/pnpm-release/main']),
  ).toBe(await revParseHead(dir));
});

test('commitAll reports a clean tree without committing', async () => {
  const dir = await initFixtureWorkspace();
  const before = await revParseHead(dir);
  expect(await commitAll(dir, 'noop')).toBe(false);
  expect(await revParseHead(dir)).toBe(before);
});

test('assertCleanTree names the offending paths', async () => {
  const dir = await initFixtureWorkspace();
  await expect(assertCleanTree(dir)).resolves.toBeUndefined();
  await writeFile(join(dir, 'untracked.txt'), 'x');
  await expect(assertCleanTree(dir)).rejects.toThrow(/untracked\.txt/u);
});

test('currentRef reports the branch and survives a round-trip', async () => {
  const dir = await initFixtureWorkspace();
  expect(await currentRef(dir)).toBe('main');
  const sha = await revParseHead(dir);
  await rebuildBranch(dir, 'pnpm-release/main', sha);
  await checkout(dir, 'main');
  expect(await currentRef(dir)).toBe('main');
});
