import { getOctokit } from '@actions/github';

import { createCommitOps } from './commit-ops.ts';
import type { CommitOps } from './commit-ops.ts';
import { createPrOps } from './pr-ops.ts';
import type { PrOps } from './pr-ops.ts';
import { createReleaseOps } from './release-ops.ts';
import type { ReleaseOps } from './release-ops.ts';

export type { PrRef } from './pr-ops.ts';
export { isAutoMergeUnavailable } from './pr-ops.ts';

export type GhClient = {
  readonly owner: string;
  readonly repo: string;
  readonly resolveBotUserId: (slug: string) => Promise<number>;
} & PrOps &
  CommitOps &
  ReleaseOps;

export const createGhClient = (
  token: string,
  owner: string,
  repo: string,
): GhClient => {
  // rate limit リトライは持たない: Release 作成は直列で件数も高々パッケージ数、
  // 万一 limit に当たっても再実行が冪等に収束する。依存を増やさない方を優先
  const octokit = getOctokit(token);
  return {
    owner,
    repo,
    resolveBotUserId: async (slug: string): Promise<number> => {
      const { data } = await octokit.rest.users.getByUsername({
        username: `${slug}[bot]`,
      });
      return data.id;
    },
    ...createPrOps(octokit, owner, repo),
    ...createCommitOps(octokit, owner, repo),
    ...createReleaseOps(octokit, owner, repo),
  };
};
