---
'pnpm-release-action': patch
---

Set up npm auth from `NPM_TOKEN` before computing the release plan. pnpm asks the registry whether the current version is published while it plans, and an unauthenticated lookup cannot see a restricted package, so the release PR kept the package at its current version as a first release instead of bumping it.
