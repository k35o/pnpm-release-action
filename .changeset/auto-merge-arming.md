---
'pnpm-release-action': patch
---

Keep the release run green when auto-merge cannot be armed: repo configuration or PR-state failures (repo auto-merge disabled, draft PR) now emit a `core.warning` with the fix (`gh api repos/<owner>/<repo> -X PATCH -F allow_auto_merge=true`) and let the run finish, instead of failing after the release PR was already created. Genuinely unexpected arming errors stay fatal.
