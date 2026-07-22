import {
  InputError,
  detectTokenMismatch,
  parseInputs,
} from '../src/core/inputs.ts';

const env = (
  overrides: Record<string, string> = {},
): Readonly<Record<string, string | undefined>> => ({
  'INPUT_GITHUB-TOKEN': 'ghs_dummy',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REF_NAME: 'main',
  ...overrides,
});

describe('defaults', () => {
  test('applies the documented defaults when only the token is provided', () => {
    const inputs = parseInputs(env());
    expect(inputs).toStrictEqual({
      build: null,
      commitMessage: 'chore: prepare release',
      prTitle: 'chore: prepare release',
      baseBranch: 'main',
      branchPrefix: 'pnpm-release/',
      cwd: '.',
      gitUser: { kind: 'keep' },
      createGithubReleases: true,
      pushGitTags: true,
      modeWhenClean: 'publish',
      commitMode: 'github-api',
      autoMerge: false,
      syncLockfile: true,
      allowPrereleaseOnLatest: false,
      githubToken: 'ghs_dummy',
    });
  });

  test('falls back to GITHUB_WORKSPACE for cwd', () => {
    const inputs = parseInputs(env({ GITHUB_WORKSPACE: '/work/repo' }));
    expect(inputs.cwd).toBe('/work/repo');
  });

  test('base-branch input wins over GITHUB_REF_NAME', () => {
    const inputs = parseInputs(env({ 'INPUT_BASE-BRANCH': 'develop' }));
    expect(inputs.baseBranch).toBe('develop');
  });

  test('non-branch refs do not become the default base branch', () => {
    expect(() =>
      parseInputs(
        env({ GITHUB_REF: 'refs/tags/v1.0.0', GITHUB_REF_NAME: 'v1.0.0' }),
      ),
    ).toThrow(/base-branch/u);
  });

  test('an explicit base-branch works on non-branch refs', () => {
    const inputs = parseInputs(
      env({
        GITHUB_REF: 'refs/tags/v1.0.0',
        GITHUB_REF_NAME: 'v1.0.0',
        'INPUT_BASE-BRANCH': 'main',
      }),
    );
    expect(inputs.baseBranch).toBe('main');
  });
});

describe('explicit values', () => {
  test('parses the full input surface', () => {
    const inputs = parseInputs(
      env({
        INPUT_BUILD: 'pnpm build',
        'INPUT_COMMIT-MESSAGE': 'release: bump',
        'INPUT_PR-TITLE': 'Release',
        'INPUT_BRANCH-PREFIX': 'release/',
        INPUT_CWD: 'packages/app',
        'INPUT_SETUP-GIT-USER': 'app',
        'INPUT_APP-SLUG': 'k35o-bot',
        'INPUT_CREATE-GITHUB-RELEASES': 'false',
        'INPUT_PUSH-GIT-TAGS': 'false',
        'INPUT_MODE-WHEN-CLEAN': 'none',
        'INPUT_COMMIT-MODE': 'git-cli',
        'INPUT_AUTO-MERGE': 'true',
        'INPUT_SYNC-LOCKFILE': 'false',
        'INPUT_ALLOW-PRERELEASE-ON-LATEST': 'true',
      }),
    );
    expect(inputs.build).toBe('pnpm build');
    expect(inputs.commitMessage).toBe('release: bump');
    expect(inputs.prTitle).toBe('Release');
    expect(inputs.branchPrefix).toBe('release/');
    expect(inputs.cwd).toBe('packages/app');
    expect(inputs.gitUser).toStrictEqual({ kind: 'app', appSlug: 'k35o-bot' });
    expect(inputs.createGithubReleases).toBe(false);
    expect(inputs.pushGitTags).toBe(false);
    expect(inputs.modeWhenClean).toBe('none');
    expect(inputs.commitMode).toBe('git-cli');
    expect(inputs.autoMerge).toBe(true);
    expect(inputs.syncLockfile).toBe(false);
    expect(inputs.allowPrereleaseOnLatest).toBe(true);
  });

  test('setup-git-user false keeps the ambient git config', () => {
    const inputs = parseInputs(
      env({ 'INPUT_SETUP-GIT-USER': 'false', 'INPUT_COMMIT-MODE': 'git-cli' }),
    );
    expect(inputs.gitUser).toStrictEqual({ kind: 'keep' });
  });

  test('setup-git-user accepts the same casings as other booleans', () => {
    expect(
      parseInputs(
        env({ 'INPUT_SETUP-GIT-USER': 'True', 'INPUT_COMMIT-MODE': 'git-cli' }),
      ).gitUser,
    ).toStrictEqual({ kind: 'actions-bot' });
    expect(
      parseInputs(
        env({
          'INPUT_SETUP-GIT-USER': 'FALSE',
          'INPUT_COMMIT-MODE': 'git-cli',
        }),
      ).gitUser,
    ).toStrictEqual({ kind: 'keep' });
  });

  test('a matching GITHUB_TOKEN env variable is accepted', () => {
    const inputs = parseInputs(env({ GITHUB_TOKEN: 'ghs_dummy' }));
    expect(inputs.githubToken).toBe('ghs_dummy');
  });
});

describe('detectTokenMismatch', () => {
  test('warns when GITHUB_TOKEN differs from the input', () => {
    expect(
      detectTokenMismatch({ GITHUB_TOKEN: 'ghs_other' }, 'ghs_dummy'),
    ).toMatch(/only uses the input/u);
  });

  test('stays silent when GITHUB_TOKEN matches, is empty, or is unset', () => {
    expect(
      detectTokenMismatch({ GITHUB_TOKEN: 'ghs_dummy' }, 'ghs_dummy'),
    ).toBeNull();
    expect(detectTokenMismatch({ GITHUB_TOKEN: '' }, 'ghs_dummy')).toBeNull();
    expect(detectTokenMismatch({}, 'ghs_dummy')).toBeNull();
  });
});

describe('validation errors', () => {
  test('rejects an unknown setup-git-user value', () => {
    expect(() =>
      parseInputs(
        env({ 'INPUT_SETUP-GIT-USER': 'bot', 'INPUT_COMMIT-MODE': 'git-cli' }),
      ),
    ).toThrow(/setup-git-user/u);
  });

  test('rejects setup-git-user app without app-slug', () => {
    expect(() =>
      parseInputs(
        env({ 'INPUT_SETUP-GIT-USER': 'app', 'INPUT_COMMIT-MODE': 'git-cli' }),
      ),
    ).toThrow(/app-slug/u);
  });

  test('rejects app-slug without setup-git-user app', () => {
    expect(() =>
      parseInputs(
        env({ 'INPUT_APP-SLUG': 'k35o-bot', 'INPUT_COMMIT-MODE': 'git-cli' }),
      ),
    ).toThrow(/setup-git-user: app/u);
  });

  test('rejects an unknown mode-when-clean value', () => {
    expect(() =>
      parseInputs(env({ 'INPUT_MODE-WHEN-CLEAN': 'version' })),
    ).toThrow(/mode-when-clean/u);
  });

  test('rejects an unknown commit-mode value', () => {
    expect(() => parseInputs(env({ 'INPUT_COMMIT-MODE': 'api' }))).toThrow(
      /commit-mode/u,
    );
  });

  test('rejects a non-boolean sync-lockfile value', () => {
    expect(() => parseInputs(env({ 'INPUT_SYNC-LOCKFILE': 'yes' }))).toThrow(
      /sync-lockfile/u,
    );
  });

  test('rejects tags disabled while releases are enabled', () => {
    expect(() => parseInputs(env({ 'INPUT_PUSH-GIT-TAGS': 'false' }))).toThrow(
      /push-git-tags: false/u,
    );
  });

  test('requires github-token', () => {
    expect(() => parseInputs({ GITHUB_REF_NAME: 'main' })).toThrow(
      /github-token/u,
    );
  });

  test('requires a resolvable base branch', () => {
    expect(() => parseInputs({ 'INPUT_GITHUB-TOKEN': 'ghs_dummy' })).toThrow(
      /base-branch/u,
    );
  });

  test('skips the tags/releases cross-check when a toggle failed to parse', () => {
    let caught: unknown;
    try {
      parseInputs(
        env({
          'INPUT_CREATE-GITHUB-RELEASES': 'no',
          'INPUT_PUSH-GIT-TAGS': 'false',
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InputError);
    const { message } = caught as InputError;
    expect(message).toContain('create-github-releases');
    expect(message).not.toContain('created from git tags');
  });
});

describe('changesets/action input names', () => {
  test('rejects `publish` and points at `build`', () => {
    expect(() => parseInputs(env({ INPUT_PUBLISH: 'pnpm release' }))).toThrow(
      /set `build`/u,
    );
  });

  test('rejects camelCase names with their replacement', () => {
    expect(() => parseInputs(env({ INPUT_SETUPGITUSER: 'false' }))).toThrow(
      /setup-git-user/u,
    );
  });

  test('rejects a legacy input even when its value is empty', () => {
    expect(() => parseInputs(env({ INPUT_PUBLISH: '' }))).toThrow(
      /set `build`/u,
    );
  });

  test('aggregates every issue into one error', () => {
    let caught: unknown;
    try {
      parseInputs(
        env({
          INPUT_PUBLISH: 'pnpm release',
          INPUT_TITLE: 'Version Packages',
          'INPUT_MODE-WHEN-CLEAN': 'auto',
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InputError);
    const { message } = caught as InputError;
    expect(message).toContain('publish');
    expect(message).toContain('pr-title');
    expect(message).toContain('mode-when-clean');
  });
});
