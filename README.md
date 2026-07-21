# pnpm-release-action

GitHub Action for [pnpm's built-in release management](https://pnpm.io/versioning): opens a release PR from pending change intents, then publishes to npm, pushes tags, and creates GitHub Releases when the PR merges.

pnpm 11.13+ owns the hard parts — change intents (`pnpm change`), the release plan (`pnpm version -r`), the ledger, changelogs, and publish selection. This action owns the layer pnpm deliberately leaves to CI: git commits, branches, pull requests, tags, and GitHub Releases.

> **Status: pre-release.** Under active development; nothing is published yet.

## Develop

```sh
pnpm install
pnpm check     # fmt + lint
pnpm typecheck
pnpm test
pnpm build     # vp pack -> dist/
```

## Release

This repository is versioned with pnpm's built-in release management and — once bootstrapped — releases itself with this very action.

```sh
pnpm change   # record a change intent
```
