---
'pnpm-release-action': minor
---

Stage releases on npm instead of publishing them. Publish mode now runs `pnpm stage publish`, and npm holds the versions until a maintainer approves them with 2FA. The run announces the staged versions in a warning annotation and the job summary, with a link to npm's Staged Packages page, then waits up to 30 minutes for every version of the release to appear on the registry. Tags, GitHub Releases, and the `published` outputs come only after that. A timeout fails the run with the versions still waiting and creates none of them, even when part of a monorepo release was approved; approve the rest and re-run the job to finish the release. Direct publishing is removed: before upgrading, allow staging on the trusted publisher and raise the job's `timeout-minutes` above 30.

`published-packages` now lists every version of the release that is on the registry, including versions approved after an earlier run timed out.
