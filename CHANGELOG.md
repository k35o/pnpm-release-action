# pnpm-release-action

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
