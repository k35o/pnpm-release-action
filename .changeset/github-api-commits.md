---
'pnpm-release-action': minor
---

Create the version commit through the GitHub API by default (`commit-mode: github-api`): GitHub signs it as the token's identity, so release PRs satisfy required-signature rules and can merge without an admin bypass. A new `auto-merge` input arms GitHub auto-merge on the release PR, making the whole intent-to-release loop hands-free. `commit-mode: git-cli` keeps the previous local-commit behavior.
