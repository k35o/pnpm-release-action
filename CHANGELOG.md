# pnpm-release-action

## 0.4.0

### Minor Changes

- Stage releases on npm instead of publishing them. Publish mode now runs `pnpm stage publish`, and npm holds the versions until a maintainer approves them with 2FA. The run announces the staged versions in a warning annotation and the job summary, with a link to npm's Staged Packages page, then waits up to 30 minutes for every version of the release to appear on the registry. Tags, GitHub Releases, and the `published` outputs come only after that. A timeout fails the run with the versions still waiting and creates none of them, even when part of a monorepo release was approved; approve the rest and re-run the job to finish the release. Direct publishing is removed: before upgrading, allow staging on the trusted publisher and raise the job's `timeout-minutes` above 30.

  `published-packages` now lists every version of the release that is on the registry, including versions approved after an earlier run timed out.

## 0.3.0

### Minor Changes

- Require pnpm >= 12.7.0 (was 11.13.0). The action is now developed and tested against pnpm 12, and 12.7.0 is the first release that always bumps private packages instead of holding them at their unpublished version; older versions fail the preflight check with a message naming the new floor.

  Read the changelog of private packages from `CHANGELOG.md`, where pnpm writes it even with the default registry storage. Release PRs and GitHub Releases for private packages no longer fall back to "No changelog entry was found".

  Show first releases as `unpublished` in the release plan. A public package whose current version is not on the registry yet is released at that version instead of being bumped, which used to render as an unchanged `0.1.0 | 0.1.0` row.

- Publish to npm dist-tags instead of always `latest`, so lanes and maintenance branches release through the same workflow. A prerelease goes to its prerelease identifier (`2.0.0-beta.3` → `beta`), which is the lane name under `versioning.lanes`, and a release that mixes main-lane and lane packages publishes once per dist-tag. The new `dist-tag` input sets the dist-tag for stable versions, e.g. `latest-3` when releasing an older major from a maintenance branch. A prerelease identifier that cannot be a dist-tag (numeric, `latest`, or readable as a semver range) fails the run when it is part of the release, and is left unpublished with a warning otherwise. `allow-prerelease-on-latest` is removed: prereleases no longer reach `latest`.

  Refuse to move `latest` below the version the registry already has there. A maintenance release without `dist-tag` now fails before publishing instead of downgrading every install.

  Create GitHub Releases for versions published outside `latest` with `make_latest: false`, so they no longer become the repository's Latest release.

### Patch Changes

- Refresh the bundled dist with updated dependencies: yaml 2.9.1, undici 6.29.1, and the @octokit packages pulled in by @actions/github. The toolchain moves to Vite+ 1.5 (Vitest 5, tsdown 0.23); the action's behavior is unchanged.

- Set up npm auth from `NPM_TOKEN` before computing the release plan. pnpm asks the registry whether the current version is published while it plans, and an unauthenticated lookup cannot see a restricted package, so the release PR kept the package at its current version as a first release instead of bumping it.

## 0.2.2

### Patch Changes

- Keep the release run green when auto-merge cannot be armed: repo configuration or PR-state failures (repo auto-merge disabled, draft PR) now emit a `core.warning` with the fix (`gh api repos/<owner>/<repo> -X PATCH -F allow_auto_merge=true`) and let the run finish, instead of failing after the release PR was already created. Genuinely unexpected arming errors stay fatal.

## 0.2.1

### Patch Changes

- Drop `@octokit/plugin-throttling`: Release creation is serial and bounded by package count, and reruns converge idempotently if a rate limit is ever hit — keeping the dependency surface minimal wins.

## 0.2.0

### Minor Changes

- Create the version commit through the GitHub API by default (`commit-mode: github-api`): GitHub signs it as the token's identity, so release PRs satisfy required-signature rules and can merge without an admin bypass. A new `auto-merge` input arms GitHub auto-merge on the release PR, making the whole intent-to-release loop hands-free. `commit-mode: git-cli` keeps the previous local-commit behavior.

### Patch Changes

- Fix `commit-mode: github-api` closing the open release PR: resetting the release branch to base before committing let GitHub observe an even-with-base window and auto-close the PR (unrecoverably, since force-updated PRs cannot reopen). The signed commit is now created on a staging branch and the release branch moves to it atomically, matching the old force-push observability.

- Refresh the bundled dist with updated dependencies and adapt to the vite-plus 0.2.x toolchain (real vitest instead of the discontinued @voidzero-dev companion overrides).

## 0.1.0

### Minor Changes

- Scaffold the action surface: `action.yml` with the MVP input/output contract, strict input parsing that rejects changesets/action input names with guidance, mode decision, and a pnpm version preflight.

- Implement publish mode: optional build command, built-in `pnpm publish -r --report-summary`, structured outputs from the summary, tags complemented by the ledger diff (private packages included), idempotent GitHub Releases with changelog bodies, and a prerelease-on-latest guard.

- Implement version-PR mode: release-plan detection in a disposable worktree, release-branch rebuild with force-push, lockfile sync, changelog previews from parked files or CHANGELOG.md, and a single upserted release PR.

### Patch Changes

- Exclude the pnpm-owned `.changeset/` directory from formatting and linting: the generated `ledger.yaml` broke the release PR's format check.

- Ship the self-release workflow (`uses: ./`), enforce committed-dist freshness in CI, and document the full input/output contract in the README.
