export type GitUserSetup =
  | { readonly kind: 'actions-bot' }
  | { readonly kind: 'keep' }
  | { readonly kind: 'app'; readonly appSlug: string };

export type ModeWhenClean = 'publish' | 'none';

export type Inputs = {
  readonly build: string | null;
  readonly commitMessage: string;
  readonly prTitle: string;
  readonly baseBranch: string;
  readonly branchPrefix: string;
  readonly cwd: string;
  readonly gitUser: GitUserSetup;
  readonly createGithubReleases: boolean;
  readonly pushGitTags: boolean;
  readonly modeWhenClean: ModeWhenClean;
  readonly syncLockfile: boolean;
  readonly allowPrereleaseOnLatest: boolean;
  readonly githubToken: string;
};

export class InputError extends Error {
  constructor(issues: readonly string[]) {
    super(
      issues.length === 1
        ? (issues[0] ?? '')
        : `Invalid inputs:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'InputError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

// The runner exposes `with:` entries as INPUT_* using the same normalization
// as @actions/core: spaces become underscores, everything is uppercased.
const inputEnvName = (name: string): string =>
  `INPUT_${name.replaceAll(' ', '_').toUpperCase()}`;

const rawInput = (env: Env, name: string): string =>
  (env[inputEnvName(name)] ?? '').trim();

// changesets/action input names we deliberately do not support. The runner
// still forwards unknown `with:` keys as INPUT_*, so we can point at the
// replacement instead of silently ignoring them.
const LEGACY_INPUTS: ReadonlyMap<string, string> = new Map([
  [
    'publish',
    'publishing is built in — set `build` to the command to run before it',
  ],
  ['version', 'the version step is built in and cannot be replaced'],
  ['commit', 'use `commit-message`'],
  ['title', 'use `pr-title`'],
  ['branch', 'use `base-branch`'],
  ['setupGitUser', 'use `setup-git-user`'],
  ['createGithubReleases', 'use `create-github-releases`'],
  ['prDraft', '`pr-draft` is not available yet'],
]);

const detectLegacyInputs = (env: Env): string[] => {
  const issues: string[] = [];
  for (const [name, guidance] of LEGACY_INPUTS) {
    if (env[inputEnvName(name)] !== undefined) {
      issues.push(
        `\`${name}\` is a changesets/action input and is not supported: ${guidance}`,
      );
    }
  }
  return issues;
};

const parseBoolean = (
  env: Env,
  name: string,
  fallback: boolean,
  issues: string[],
): boolean => {
  const raw = rawInput(env, name);
  if (raw === '') return fallback;
  if (['true', 'True', 'TRUE'].includes(raw)) return true;
  if (['false', 'False', 'FALSE'].includes(raw)) return false;
  issues.push(`\`${name}\` must be \`true\` or \`false\`, got \`${raw}\``);
  return fallback;
};

const parseGitUser = (env: Env, issues: string[]): GitUserSetup => {
  // 真偽値の綴りは parseBoolean と同じ揺れ（True/TRUE 等）を受ける
  const raw = rawInput(env, 'setup-git-user') || 'true';
  const appSlug = rawInput(env, 'app-slug');
  if (raw !== 'app' && appSlug !== '') {
    issues.push('`app-slug` requires `setup-git-user: app`');
  }
  if (['true', 'True', 'TRUE'].includes(raw)) return { kind: 'actions-bot' };
  if (['false', 'False', 'FALSE'].includes(raw)) return { kind: 'keep' };
  if (raw === 'app') {
    if (appSlug === '') {
      issues.push('`setup-git-user: app` requires `app-slug`');
      return { kind: 'actions-bot' };
    }
    return { kind: 'app', appSlug };
  }
  issues.push(
    `\`setup-git-user\` must be \`true\`, \`false\`, or \`app\`, got \`${raw}\``,
  );
  return { kind: 'actions-bot' };
};

const parseModeWhenClean = (env: Env, issues: string[]): ModeWhenClean => {
  const raw = rawInput(env, 'mode-when-clean') || 'publish';
  if (raw === 'publish' || raw === 'none') return raw;
  issues.push(
    `\`mode-when-clean\` must be \`publish\` or \`none\`, got \`${raw}\``,
  );
  return 'publish';
};

// hard error にすると「昇格トークンを github-token に渡し、他ステップの gh CLI 用に
// GITHUB_TOKEN env はデフォルトのまま」という正当な構成（本アクションの推奨レシピ）を
// 弾いてしまうため、不一致は warning 止まりにする
export const detectTokenMismatch = (
  env: Env,
  githubToken: string,
): string | null => {
  if (
    env.GITHUB_TOKEN !== undefined &&
    env.GITHUB_TOKEN !== '' &&
    env.GITHUB_TOKEN !== githubToken
  ) {
    return 'the `GITHUB_TOKEN` environment variable is set but differs from the `github-token` input: this action only uses the input';
  }
  return null;
};

export const parseInputs = (env: Env): Inputs => {
  const issues: string[] = detectLegacyInputs(env);

  const gitUser = parseGitUser(env, issues);
  const modeWhenClean = parseModeWhenClean(env, issues);
  // どちらかの真偽値が壊れているときに相関チェックを走らせると、fallback 値由来の
  // 偽の指摘（または本物の見逃し）になるため、両方 parse できたときだけ検査する
  const issuesBeforeToggles = issues.length;
  const createGithubReleases = parseBoolean(
    env,
    'create-github-releases',
    true,
    issues,
  );
  const pushGitTags = parseBoolean(env, 'push-git-tags', true, issues);
  if (
    issues.length === issuesBeforeToggles &&
    createGithubReleases &&
    !pushGitTags
  ) {
    issues.push(
      'GitHub Releases are created from git tags: `push-git-tags: false` requires `create-github-releases: false`',
    );
  }

  // ref_name はタグや pull_request の merge ref でも埋まるため、明示入力が無い限り
  // branch トリガー（refs/heads/*）のときだけ既定値として採用する
  const explicitBaseBranch = rawInput(env, 'base-branch');
  const refIsBranch = (env.GITHUB_REF ?? '').startsWith('refs/heads/');
  const baseBranch =
    explicitBaseBranch || (refIsBranch ? (env.GITHUB_REF_NAME ?? '') : '');
  if (baseBranch === '') {
    issues.push(
      '`base-branch` could not be determined: set the input, or trigger the workflow on a branch (refs/heads/*)',
    );
  }

  const syncLockfile = parseBoolean(env, 'sync-lockfile', true, issues);
  const allowPrereleaseOnLatest = parseBoolean(
    env,
    'allow-prerelease-on-latest',
    false,
    issues,
  );

  const githubToken = rawInput(env, 'github-token');
  if (githubToken === '') {
    issues.push('`github-token` is required');
  }

  if (issues.length > 0) throw new InputError(issues);

  return {
    build: rawInput(env, 'build') || null,
    commitMessage: rawInput(env, 'commit-message') || 'chore: prepare release',
    prTitle: rawInput(env, 'pr-title') || 'chore: prepare release',
    baseBranch,
    branchPrefix: rawInput(env, 'branch-prefix') || 'pnpm-release/',
    cwd: rawInput(env, 'cwd') || (env.GITHUB_WORKSPACE ?? '.'),
    gitUser,
    createGithubReleases,
    pushGitTags,
    modeWhenClean,
    syncLockfile,
    allowPrereleaseOnLatest,
    githubToken,
  };
};
