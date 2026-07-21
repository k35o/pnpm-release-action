# @k8o/pnpm-release-action

CI layer for pnpm built-in versioning: release PRs, tags, and GitHub Releases

## Install

```sh
pnpm add @k8o/pnpm-release-action
```

## Develop

```sh
pnpm install
pnpm check     # fmt + lint
pnpm typecheck
pnpm test
pnpm build     # vp pack -> dist/
```

## Release

Versioned and published with [Changesets](https://github.com/changesets/changesets).

```sh
pnpm changeset   # describe the change
```

Merging to `main` lets the release workflow open a version PR and publish to npm.
