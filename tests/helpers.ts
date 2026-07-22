import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getExecOutput } from '@actions/exec';

export const sh = async (
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<string> => {
  const { stdout } = await getExecOutput(command, [...args], {
    cwd,
    silent: true,
  });
  return stdout.trim();
};

// git リポジトリのルート（subdir 指定時はサブディレクトリ）に単一パッケージの
// pnpm workspace を作る。返り値は workspace のパス。
export const initFixtureWorkspace = async (
  options: { storage?: 'repository'; subdir?: string } = {},
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'pra-fixture-'));
  const dir = options.subdir === undefined ? root : join(root, options.subdir);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-pkg', version: '0.1.0' }),
  );
  await writeFile(
    join(dir, 'pnpm-workspace.yaml'),
    options.storage === 'repository'
      ? 'versioning:\n  changelog:\n    storage: repository\n'
      : '# single-package fixture\n',
  );
  await mkdir(join(dir, '.changeset'), { recursive: true });
  await writeFile(
    join(dir, '.changeset', 'fixture-intent.md'),
    "---\n'fixture-pkg': minor\n---\n\nAdd a fixture feature.\n",
  );
  await sh(root, 'git', ['init', '-q', '-b', 'main']);
  await sh(root, 'git', ['config', 'user.name', 'fixture']);
  await sh(root, 'git', ['config', 'user.email', 'fixture@example.com']);
  await sh(root, 'git', ['config', 'commit.gpgsign', 'false']);
  await sh(root, 'git', ['add', '-A']);
  await sh(root, 'git', ['commit', '-q', '-m', 'init']);
  return dir;
};
