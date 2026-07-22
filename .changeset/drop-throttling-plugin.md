---
'pnpm-release-action': patch
---

Drop `@octokit/plugin-throttling`: Release creation is serial and bounded by package count, and reruns converge idempotently if a rate limit is ever hit — keeping the dependency surface minimal wins.
