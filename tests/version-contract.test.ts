import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { collectChangelogPreviews } from '../src/pnpm/changelogs.ts';
import { applyVersion, detectPlan } from '../src/pnpm/version.ts';
import { initFixtureWorkspace, sh } from './helpers.ts';

describe('registry storage (pnpm default)', () => {
  test('detectPlan reads the plan without touching the tree', async () => {
    const dir = await initFixtureWorkspace();
    const plan = await detectPlan(dir);
    expect(plan).toStrictEqual([
      { name: 'fixture-pkg', currentVersion: '0.1.0', newVersion: '0.2.0' },
    ]);
    expect(await sh(dir, 'git', ['status', '--porcelain'])).toBe('');
  });

  test('applyVersion bumps and parks the changelog for the preview', async () => {
    const dir = await initFixtureWorkspace();
    const plan = await applyVersion(dir);
    const manifest = JSON.parse(
      await readFile(join(dir, 'package.json'), 'utf8'),
    ) as { version: string };
    expect(manifest.version).toBe('0.2.0');
    const previews = await collectChangelogPreviews(dir, plan);
    expect(previews[0]?.section).toContain('Add a fixture feature.');
  });

  test('a released state detects as an empty plan via the ledger', async () => {
    const dir = await initFixtureWorkspace();
    await applyVersion(dir);
    await sh(dir, 'git', ['add', '-A']);
    await sh(dir, 'git', ['commit', '-q', '-m', 'release']);
    // registry storage では intent ファイルが残るが、ledger が再消費を防ぐ
    expect(await detectPlan(dir)).toStrictEqual([]);
  });

  test('detects the plan when the workspace is a repo subdirectory', async () => {
    const dir = await initFixtureWorkspace({ subdir: 'workspace' });
    const plan = await detectPlan(dir);
    expect(plan).toStrictEqual([
      { name: 'fixture-pkg', currentVersion: '0.1.0', newVersion: '0.2.0' },
    ]);
  });

  test('pnpm failures surface the underlying diagnostic', async () => {
    const dir = await initFixtureWorkspace();
    await writeFile(join(dir, 'dirty.txt'), 'x');
    await expect(applyVersion(dir)).rejects.toThrow(
      /ERR_PNPM_UNCLEAN_WORKING_TREE/u,
    );
  });
});

describe('repository storage', () => {
  test('the CHANGELOG.md section backs the preview', async () => {
    const dir = await initFixtureWorkspace({ storage: 'repository' });
    const plan = await applyVersion(dir);
    const previews = await collectChangelogPreviews(dir, plan);
    expect(previews[0]?.section).toContain('### Minor Changes');
    expect(previews[0]?.section).toContain('Add a fixture feature.');
  });
});
