---
'pnpm-release-action': patch
---

Exclude the pnpm-owned `.changeset/` directory from formatting and linting: the generated `ledger.yaml` broke the release PR's format check.
