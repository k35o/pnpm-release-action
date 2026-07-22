import type { Octokit } from './octokit.ts';

export type CommitOps = {
  readonly resetBranch: (params: {
    branch: string;
    sha: string;
  }) => Promise<void>;
  readonly commitOnBranch: (params: {
    branch: string;
    expectedHeadOid: string;
    message: string;
    additions: ReadonlyArray<{ path: string; contents: string }>;
    deletions: ReadonlyArray<{ path: string }>;
  }) => Promise<string>;
  readonly deleteBranch: (branch: string) => Promise<void>;
};

export const createCommitOps = (
  octokit: Octokit,
  owner: string,
  repo: string,
): CommitOps => ({
  // リリースブランチをトリガー SHA に作り直す（存在しなければ作成）
  resetBranch: async ({ branch, sha }): Promise<void> => {
    try {
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha,
        force: true,
      });
    } catch (error) {
      const { status } = error as { status?: number };
      if (status !== 404 && status !== 422) throw error;
      try {
        await octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branch}`,
          sha,
        });
      } catch {
        // 422 は「ref が無い」以外（保護ルール拒否等）もあり得る。createRef も
        // 失敗したなら元の updateRef エラーの方が根本原因を示している
        throw error;
      }
    }
  },
  // createCommitOnBranch はトークンの主体（App / github-actions）として
  // GitHub が署名するため、required_signatures な ruleset を満たせる
  commitOnBranch: async ({
    branch,
    expectedHeadOid,
    message,
    additions,
    deletions,
  }): Promise<string> => {
    const response = await octokit.graphql<{
      createCommitOnBranch: { commit: { oid: string } };
    }>(
      `mutation($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) { commit { oid } }
      }`,
      {
        input: {
          branch: {
            repositoryNameWithOwner: `${owner}/${repo}`,
            branchName: branch,
          },
          expectedHeadOid,
          message: { headline: message },
          fileChanges: {
            additions: [...additions],
            deletions: [...deletions],
          },
        },
      },
    );
    return response.createCommitOnBranch.commit.oid;
  },
  deleteBranch: async (branch: string): Promise<void> => {
    try {
      await octokit.rest.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
    } catch (error) {
      const { status } = error as { status?: number };
      // 既に無い分には困らない
      if (status !== 404 && status !== 422) throw error;
    }
  },
});
