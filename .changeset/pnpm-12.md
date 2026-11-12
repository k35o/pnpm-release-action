---
'pnpm-release-action': minor
---

Require pnpm >= 12.7.0 (was 11.13.0). The action is now developed and tested against pnpm 12, and 12.7.0 is the first release that always bumps private packages instead of holding them at their unpublished version; older versions fail the preflight check with a message naming the new floor.

Read the changelog of private packages from `CHANGELOG.md`, where pnpm writes it even with the default registry storage. Release PRs and GitHub Releases for private packages no longer fall back to "No changelog entry was found".

Show first releases as `unpublished` in the release plan. A public package whose current version is not on the registry yet is released at that version instead of being bumped, which used to render as an unchanged `0.1.0 | 0.1.0` row.
