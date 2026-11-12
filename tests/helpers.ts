import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getExecOutput } from '@actions/exec';

import rootManifest from '../package.json' with { type: 'json' };

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

const FIXTURE_NAME = 'fixture-pkg';

export const writeFixtureManifest = async (
  dir: string,
  options: { version?: string; private?: boolean } = {},
): Promise<void> => {
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: FIXTURE_NAME,
      version: options.version ?? '0.1.0',
      // リポジトリの固定版をそのまま使う: mise 等の per-directory 解決でも常に同じ
      // pnpm を掴み（PATH 漏れに依存しない）、スイートが検証する版が 1 箇所で決まる
      packageManager: rootManifest.packageManager,
      ...(options.private === true ? { private: true } : {}),
    }),
  );
};

// pnpm は version / publish の前に、対象の版が公開済みかをレジストリへ問い合わせる
// （未公開なら bump せず、その版のまま初回リリースにする）。npmjs.org に同名の
// パッケージがあるかどうかで結果が変わらないよう、返事を決め打ちするレジストリを立てる
const startFakeRegistry = async (
  publishedVersion: string | null,
  restricted: boolean,
): Promise<string> => {
  const server = createServer((request, response) => {
    const found =
      publishedVersion !== null &&
      // プロキシとして受けた問い合わせは絶対 URL で届く
      new URL(request.url ?? '/', 'http://registry').pathname ===
        `/${FIXTURE_NAME}` &&
      (!restricted || request.headers.authorization !== undefined);
    response.writeHead(found ? 200 : 404, {
      'content-type': 'application/json',
    });
    response.end(
      found
        ? JSON.stringify({
            name: FIXTURE_NAME,
            'dist-tags': { latest: publishedVersion },
            versions: {
              [publishedVersion]: {
                name: FIXTURE_NAME,
                version: publishedVersion,
              },
            },
          })
        : '{"error":"Not found"}',
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  // フィクスチャごとに閉じて回らなくても、テストワーカーの終了を妨げない
  server.unref();
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}/`;
};

// git リポジトリのルート（subdir 指定時はサブディレクトリ）に単一パッケージの
// pnpm workspace を作る。返り値は workspace のパス。
export const initFixtureWorkspace = async (
  options: {
    storage?: 'repository';
    subdir?: string;
    version?: string;
    private?: boolean;
    // false: 現在の版がレジストリに無い（初回リリース前の）パッケージにする
    published?: boolean;
    // true: npmjs.org の restricted パッケージのように、認証の無い問い合わせには
    // パッケージの存在を隠す
    restricted?: boolean;
  } = {},
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'pra-fixture-'));
  const dir = options.subdir === undefined ? root : join(root, options.subdir);
  await mkdir(dir, { recursive: true });
  await writeFixtureManifest(dir, options);
  // private は決して公開されない: レジストリに無い状態が実態で、それでも bump される
  // ことが検証対象になる
  const published = options.published ?? options.private !== true;
  const restricted = options.restricted === true;
  const registry = await startFakeRegistry(
    published ? (options.version ?? '0.1.0') : null,
    restricted,
  );
  await writeFile(
    join(dir, 'pnpm-workspace.yaml'),
    `${
      // NPM_TOKEN の認証行は registry.npmjs.org 宛てにしか書かれない。偽レジストリを
      // その名前のプロキシとして立て、本物と同じ宛先のままトークンを受け取る
      restricted
        ? `registry: http://registry.npmjs.org/\nhttpProxy: ${registry}\n`
        : `registry: ${registry}\n`
    }${
      options.storage === 'repository'
        ? 'versioning:\n  changelog:\n    storage: repository\n'
        : ''
    }`,
  );
  await mkdir(join(dir, '.changeset'), { recursive: true });
  await writeFile(
    join(dir, '.changeset', 'fixture-intent.md'),
    "---\n'fixture-pkg': minor\n---\n\nAdd a fixture feature.\n",
  );
  // pnpm 12 は packageManager を固定した lockfile の無いプロジェクトで、最初の
  // コマンドが pnpm-lock.yaml を書いて作業ツリーを汚す。実プロジェクトと同じく
  // lockfile をコミットしておく
  await sh(dir, 'pnpm', ['install', '--lockfile-only']);
  await sh(root, 'git', ['init', '-q', '-b', 'main']);
  await sh(root, 'git', ['config', 'user.name', 'fixture']);
  await sh(root, 'git', ['config', 'user.email', 'fixture@example.com']);
  await sh(root, 'git', ['config', 'commit.gpgsign', 'false']);
  await sh(root, 'git', ['add', '-A']);
  await sh(root, 'git', ['commit', '-q', '-m', 'init']);
  return dir;
};
