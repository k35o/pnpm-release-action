import { getOctokit } from '@actions/github';

export type PrRef = { readonly number: number; readonly nodeId: string };

export type GhClient = {
  readonly resolveBotUserId: (slug: string) => Promise<number>;
  readonly findOpenPr: (params: {
    head: string;
    base: string;
  }) => Promise<PrRef | null>;
  readonly createPr: (params: {
    head: string;
    base: string;
    title: string;
    body: string;
  }) => Promise<PrRef>;
  readonly updatePr: (params: {
    nodeId: string;
    title: string;
    body: string;
  }) => Promise<void>;
  readonly hasRelease: (tag: string) => Promise<boolean>;
  readonly createRelease: (params: {
    tag: string;
    body: string;
    prerelease: boolean;
  }) => Promise<void>;
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
  }) => Promise<void>;
  readonly enableAutoMerge: (params: {
    nodeId: string;
    number: number;
  }) => Promise<void>;
};

export const createGhClient = (
  token: string,
  owner: string,
  repo: string,
): GhClient => {
  // rate limit リトライは持たない: Release 作成は直列で件数も高々パッケージ数、
  // 万一 limit に当たっても再実行が冪等に収束する。依存を増やさない方を優先
  const octokit = getOctokit(token);
  return {
    resolveBotUserId: async (slug: string): Promise<number> => {
      const { data } = await octokit.rest.users.getByUsername({
        username: `${slug}[bot]`,
      });
      return data.id;
    },
    findOpenPr: async ({ head, base }): Promise<PrRef | null> => {
      const { data } = await octokit.rest.pulls.list({
        owner,
        repo,
        state: 'open',
        head: `${owner}:${head}`,
        base,
        per_page: 1,
      });
      const pr = data[0];
      return pr === undefined
        ? null
        : { number: pr.number, nodeId: pr.node_id };
    },
    createPr: async ({ head, base, title, body }): Promise<PrRef> => {
      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        head,
        base,
        title,
        body,
      });
      return { number: data.number, nodeId: data.node_id };
    },
    // update は state: OPEN を常に含む単一 mutation — 自動 close からの復帰を兼ねる
    updatePr: async ({ nodeId, title, body }): Promise<void> => {
      await octokit.graphql(
        `mutation($id: ID!, $title: String!, $body: String!) {
          updatePullRequest(input: { pullRequestId: $id, title: $title, body: $body, state: OPEN }) {
            pullRequest { number }
          }
        }`,
        { id: nodeId, title, body },
      );
    },
    hasRelease: async (tag: string): Promise<boolean> => {
      try {
        await octokit.rest.repos.getReleaseByTag({ owner, repo, tag });
        return true;
      } catch (error) {
        if ((error as { status?: number }).status === 404) return false;
        throw error;
      }
    },
    createRelease: async ({ tag, body, prerelease }): Promise<void> => {
      await octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name: tag,
        body,
        prerelease,
      });
    },
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
    }): Promise<void> => {
      await octokit.graphql(
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
    },
    // PR が既に clean なら auto-merge は予約できないので直接マージする
    enableAutoMerge: async ({ nodeId, number }): Promise<void> => {
      try {
        await octokit.graphql(
          `mutation($id: ID!) {
            enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) {
              pullRequest { number }
            }
          }`,
          { id: nodeId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // clean は「即マージ可能」、unstable は「必須でないチェックが未完/失敗」
        // — どちらも auto-merge は予約できないが REST merge は通る
        if (/is in (?:clean|unstable) status/u.test(message)) {
          await octokit.rest.pulls.merge({
            owner,
            repo,
            pull_number: number,
            merge_method: 'merge',
          });
          return;
        }
        throw error;
      }
    },
  };
};
