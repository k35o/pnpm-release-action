---
'pnpm-release-action': minor
---

Publish to npm dist-tags instead of always `latest`, so lanes and maintenance branches release through the same workflow. A prerelease goes to its prerelease identifier (`2.0.0-beta.3` → `beta`), which is the lane name under `versioning.lanes`, and a release that mixes main-lane and lane packages publishes once per dist-tag. The new `dist-tag` input sets the dist-tag for stable versions, e.g. `latest-3` when releasing an older major from a maintenance branch. A prerelease identifier that cannot be a dist-tag (numeric, `latest`, or readable as a semver range) fails the run when it is part of the release, and is left unpublished with a warning otherwise. `allow-prerelease-on-latest` is removed: prereleases no longer reach `latest`.

Refuse to move `latest` below the version the registry already has there. A maintenance release without `dist-tag` now fails before publishing instead of downgrading every install.

Create GitHub Releases for versions published outside `latest` with `make_latest: false`, so they no longer become the repository's Latest release.
