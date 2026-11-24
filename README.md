# pnpm-release-action

GitHub Action for [pnpm's built-in release management](https://pnpm.io/versioning) (pnpm 12.7+): opens a release PR from pending change intents, then stages the release on npm when the PR merges, waits for a maintainer to approve it, pushes tags, and creates GitHub Releases.

pnpm owns the hard parts — change intents (`pnpm change`), the release plan with propagation/fixed/epic semantics (`pnpm version -r`), the ledger, changelogs, and publish selection. This action owns the layer pnpm deliberately leaves to CI: git commits, branches, pull requests, tags, and GitHub Releases. It has zero semver logic and zero `@changesets/*` dependencies.

> Prefer pinning to a full commit SHA with a version comment (Renovate keeps both in sync); the floating `v0` tag also exists for convenience.

## How it works

Every run picks one of two modes by asking pnpm for the pending release plan (in a disposable git worktree, so your checkout is never touched):

- **Pending intents → version mode.** Rebuilds `<branch-prefix><base-branch>` from the trigger commit, applies `pnpm version -r`, syncs the lockfile, and opens (or force-updates) a single release PR with the plan table and changelog previews.
- **No intents → publish mode** (`mode-when-clean: publish`, the default). Runs your `build` command, then the built-in `pnpm stage publish -r --report-summary` once per dist-tag. Once a maintainer approves the staged versions on npm, it pushes a tag per released package and creates GitHub Releases with the changelog as the body (see [Staged publishing](#staged-publishing)). Private packages are tagged too, via the committed ledger.

Merging the release PR lands you in publish mode, and approving the staged versions on npm finishes it — that is the whole loop.

A public package whose current version is not on the registry yet is released at that version instead of being bumped (pnpm's first-release rule). The plan table lists it with `unpublished` in the From column.

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
    timeout-minutes: 45 # the run waits up to 30 minutes for the npm approval
    steps:
      - uses: actions/create-github-app-token@1b10c78c7865c340bc4f6099eb2f838309f1e8c3 # v3.1.1
        id: app-token
        with:
          client-id: ${{ secrets.APP_CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0
          token: ${{ steps.app-token.outputs.token }}
      # install pnpm >= 12.7.0 here (pnpm/action-setup, mise, ...)
      - uses: k35o/pnpm-release-action@9c884985ac053e708a8ef66738cd93d288efb096 # v0.1.0
        with:
          build: pnpm build
          github-token: ${{ steps.app-token.outputs.token }}
          auto-merge: true # release PR merges itself once its checks pass
```

Use a GitHub App token (`actions/create-github-app-token`) rather than the default `GITHUB_TOKEN`: pushes and PRs made with `GITHUB_TOKEN` do not trigger other workflows, so your release PR would get no CI. With the default `commit-mode: github-api`, the version commit is created through the API and **GitHub signs it as the App**, so branch rules requiring signed commits pass and `auto-merge: true` can carry the release PR to completion with no human clicks. In `git-cli` mode the action always pushes with the `github-token` input — a credential persisted by `actions/checkout` never silently takes over.

## Inputs

| input                    | default                  | description                                                                                                                                            |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `build`                  | –                        | Command run before the built-in stage publish (e.g. `pnpm build`). Skipped when empty; never runs in version-PR mode                                   |
| `commit-message`         | `chore: prepare release` | Version commit message                                                                                                                                 |
| `pr-title`               | `chore: prepare release` | Release PR title                                                                                                                                       |
| `base-branch`            | triggering branch        | Base branch of the release PR. Required explicitly on non-branch triggers                                                                              |
| `branch-prefix`          | `pnpm-release/`          | Release branch is `<branch-prefix><base-branch>`                                                                                                       |
| `cwd`                    | workspace root           | Working directory of the pnpm workspace (repo subdirectories supported)                                                                                |
| `setup-git-user`         | `true`                   | `true` (github-actions bot) / `false` (keep ambient config) / `app` (resolve the bot user of `app-slug`)                                               |
| `app-slug`               | –                        | App slug output of `actions/create-github-app-token`; required with `setup-git-user: app`                                                              |
| `create-github-releases` | `true`                   | Create a GitHub Release per released package                                                                                                           |
| `push-git-tags`          | `true`                   | Push tags (`v<version>` for single-package repos, `<name>@<version>` for monorepos)                                                                    |
| `mode-when-clean`        | `publish`                | `publish` or `none` when no intents are pending                                                                                                        |
| `commit-mode`            | `github-api`             | `github-api` creates the version commit via the API — GitHub signs it, satisfying required-signature rules. `git-cli` commits and force-pushes locally |
| `auto-merge`             | `false`                  | Arm GitHub auto-merge (merge commit) on the release PR                                                                                                 |
| `sync-lockfile`          | `true`                   | Run `pnpm install --lockfile-only` after versioning                                                                                                    |
| `dist-tag`               | `latest`                 | npm dist-tag for stable versions (e.g. `latest-3` on a maintenance branch). Prereleases always use their prerelease identifier                         |
| `github-token`           | `github.token`           | Token for git pushes, the release PR, tags, and Releases                                                                                               |

changesets/action input names (`publish`, `setupGitUser`, …) are intentionally not supported — they fail with guidance toward the replacement.

## Outputs

| output                | description                                                                           |
| --------------------- | ------------------------------------------------------------------------------------- |
| `mode`                | `version` / `publish` / `none`                                                        |
| `published`           | `"true"` when at least one package of the release was approved and is on the registry |
| `published-packages`  | JSON array of `{ name, version }` for those packages                                  |
| `has-pending-changes` | `"true"` when the release plan was non-empty                                          |
| `pr-number`           | Release PR number (empty outside version mode)                                        |

## Staged publishing

Publish mode never publishes on its own. It stages each release with `pnpm stage publish`, and npm keeps the staged versions off the registry until a maintainer approves them with 2FA, on [Staged Packages](https://www.npmjs.com/settings/~/staged-packages) or with `npm stage list` and `npm stage approve <stage-id>`. An OIDC token can stage but cannot approve, so whatever reaches `main` or the build still needs a human before it reaches npm.

npm sends no notification, so the run announces the staged versions in a warning annotation and the job summary, then checks the registry every 15 seconds for up to 30 minutes:

- When every version of the release is on the registry, the run pushes the tags, creates the GitHub Releases, and sets the `published` outputs.
- Otherwise the run fails and lists the versions still waiting. It creates no tags or Releases, not even for the approved packages of a monorepo release. Approve the rest and re-run the job: pnpm skips the versions already on the registry, and the run picks up the tags, the Releases, and the outputs. npm refuses to stage a version that is already staged, so a re-run before the approval fails at staging.

Give the job a `timeout-minutes` above 30 so the wait can finish. Once a release has gone through staging, turn off "Allow npm publish" on the package's trusted publisher so CI can only stage.

## Prereleases and maintenance branches

Stable versions go to the `dist-tag` input (`latest` by default). A prerelease goes to its prerelease identifier, so `2.0.0-beta.3` lands on `beta` — with [lanes](https://pnpm.io/cli/lane), that is the lane name. Its GitHub Release is marked as a prerelease and never becomes the repository's Latest release. A release that mixes main-lane and lane packages publishes once per dist-tag.

To ship a beta of the next major, move the package onto a lane; the next release PR carries `X.Y.Z-beta.N` versions:

```sh
pnpm lane beta --filter <package>   # release PRs now produce prereleases
pnpm lane main --filter <package>   # graduate: the next release is the stable X.Y.Z
```

To keep fixing an older major while `main` moves on, cut a branch from its last tag and run the same workflow on it. Once the newer major owns `latest`, give the old line its own dist-tag:

```yaml
on:
  push:
    branches: [main, v3]
# ...
- uses: k35o/pnpm-release-action@<sha>
  with:
    build: pnpm build
    dist-tag: ${{ github.ref_name == 'v3' && 'latest-3' || 'latest' }}
```

Publish mode refuses to move `latest` below the version already on it, so forgetting `dist-tag` on the maintenance branch fails the run instead of downgrading every install. Releases published under another dist-tag do not become the repository's Latest release either. npm rejects dist-tags that read as a semver range (`v3`, `3.x`), and so does this action — for the input and for prerelease identifiers.

## Requirements

- pnpm **>= 12.7.0** on `PATH` before this action runs
- `actions/checkout` with **`fetch-depth: 0`** (the release plan and released set need history)
- npm auth via **OIDC trusted publishing** whose trusted publisher allows staging (nothing to configure in the workflow), or an `NPM_TOKEN` env var that can stage
- A committed **`pnpm-lock.yaml`**: with `packageManager` pinned and no lockfile, pnpm writes one on its first command and `pnpm version` then aborts on the dirty tree
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
