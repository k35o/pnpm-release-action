---
'pnpm-release-action': patch
---

Fix `commit-mode: github-api` closing the open release PR: resetting the release branch to base before committing let GitHub observe an even-with-base window and auto-close the PR (unrecoverably, since force-updated PRs cannot reopen). The signed commit is now created on a staging branch and the release branch moves to it atomically, matching the old force-push observability.
