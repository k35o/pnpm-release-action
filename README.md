# pnpm-release-action

GitHub Action for [pnpm's built-in release management](https://pnpm.io/versioning) (pnpm 11.13+): opens a release PR from pending change intents, then publishes to npm, pushes tags, and creates GitHub Releases when the PR merges.

pnpm owns the hard parts — change intents (`pnpm change`), the release plan with propagation/fixed/epic semantics (`pnpm version -r`), the ledger, changelogs, and publish selection. This action owns the layer pnpm deliberately leaves to CI: git commits, branches, pull requests, tags, and GitHub Releases. It has zero semver logic and zero `@changesets/*` dependencies.

> **Status: pre-release.** The API below is implemented and tested, but nothing is tagged yet — pin to a commit SHA once the first release is out.

## How it works

Every run picks one of two modes by asking pnpm for the pending release plan (in a disposable git worktree, so your checkout is never touched):

- **Pending intents → version mode.** Rebuilds `<branch-prefix><base-branch>` from the trigger commit, applies `pnpm version -r`, syncs the lockfile, and opens (or force-updates) a single release PR with the plan table and changelog previews.
- **No intents → publish mode** (`mode-when-clean: publish`, the default). Runs your `build` command, then the built-in `pnpm publish -r --report-summary`, pushes a tag per released package, and creates GitHub Releases with the changelog as the body. Private packages are tagged too, via the committed ledger.

Merging the release PR lands you in publish mode — that is the whole loop.

## Usage

```yaml
name: Release
on:
  push:
    branches: [main]
  workflow_dispatch:
concurrency: ${{ github.workflow }}-${{ github.ref }}
permissions:
  contents: write
  pull-requests: write
  id-token: write # npm OIDC trusted publishing
jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<sha> # v6
        with:
          fetch-depth: 0
      # install pnpm >= 11.13.0 here (pnpm/action-setup, mise, ...)
      - uses: k35o/pnpm-release-action@<sha> # pin a release once one exists
        with:
          build: pnpm build
          github-token: ${{ steps.app-token.outputs.token }}
          setup-git-user: app
          app-slug: ${{ steps.app-token.outputs.app-slug }}
```

Use a GitHub App token (`actions/create-github-app-token`) rather than the default `GITHUB_TOKEN`: pushes and PRs made with `GITHUB_TOKEN` do not trigger other workflows, so your release PR would get no CI. This action always pushes with the `github-token` input — a credential persisted by `actions/checkout` never silently takes over.

## Inputs

| input | default | description |
| --- | --- | --- |
| `build` | – | Command run before the built-in publish (e.g. `pnpm build`). Skipped when empty; never runs in version-PR mode |
| `commit-message` | `chore: prepare release` | Version commit message |
| `pr-title` | `chore: prepare release` | Release PR title |
| `base-branch` | triggering branch | Base branch of the release PR. Required explicitly on non-branch triggers |
| `branch-prefix` | `pnpm-release/` | Release branch is `<branch-prefix><base-branch>` |
| `cwd` | workspace root | Working directory of the pnpm workspace (repo subdirectories supported) |
| `setup-git-user` | `true` | `true` (github-actions bot) / `false` (keep ambient config) / `app` (resolve the bot user of `app-slug`) |
| `app-slug` | – | App slug output of `actions/create-github-app-token`; required with `setup-git-user: app` |
| `create-github-releases` | `true` | Create a GitHub Release per released package |
| `push-git-tags` | `true` | Push tags (`v<version>` for single-package repos, `<name>@<version>` for monorepos) |
| `mode-when-clean` | `publish` | `publish` or `none` when no intents are pending |
| `sync-lockfile` | `true` | Run `pnpm install --lockfile-only` after versioning |
| `allow-prerelease-on-latest` | `false` | Allow prereleases in the release to reach the `latest` dist-tag |
| `github-token` | `github.token` | Token for git pushes, the release PR, tags, and Releases |

changesets/action input names (`publish`, `setupGitUser`, …) are intentionally not supported — they fail with guidance toward the replacement.

## Outputs

| output | description |
| --- | --- |
| `mode` | `version` / `publish` / `none` |
| `published` | `"true"` when at least one package was published |
| `published-packages` | JSON array of `{ name, version }` |
| `has-pending-changes` | `"true"` when the release plan was non-empty |
| `pr-number` | Release PR number (empty outside version mode) |

## Requirements

- pnpm **>= 11.13.0** on `PATH` before this action runs
- `actions/checkout` with **`fetch-depth: 0`** (the release plan and released set need history)
- npm auth via **OIDC trusted publishing** (nothing to configure here), or an `NPM_TOKEN` env var for the classic flow
- A clean working tree: steps that generate uncommitted files belong after this action

## Migrating from changesets/action

Intent files are the changesets format — your existing `.changeset/*.md` keep working. One-time changes:

1. Move `fixed` / `ignore` from `.changeset/config.json` to the `versioning` key of `pnpm-workspace.yaml`; delete the config and the `@changesets/*` devDependencies.
2. Set `versioning.changelog.storage: repository` if you want `CHANGELOG.md` committed (pnpm's default parks changelogs for the registry).
3. Replace the step: `publish: pnpm release` (a build+publish script) becomes `build: pnpm build` — publishing is built in.
4. Rename inputs: `commit` → `commit-message`, `title` → `pr-title`, `branch` → `base-branch`, `setupGitUser` → `setup-git-user`, `createGithubReleases` → `create-github-releases`. Outputs: `publishedPackages` → `published-packages`, `hasChangesets` → `has-pending-changes`, `pullRequestNumber` → `pr-number`.
5. Close the open `changeset-release/*` PR (or set `branch-prefix: changeset-release/` to keep it).

Known regression: pnpm's changelog format is fixed — `@changesets/changelog-github`-style PR links and contributor credits cannot be reproduced yet.

## Development

```sh
pnpm install
pnpm check && pnpm typecheck && pnpm test
pnpm build   # bundles to the committed dist/
```

This repository versions and releases itself with the action (`uses: ./` in [release.yml](.github/workflows/release.yml)).
