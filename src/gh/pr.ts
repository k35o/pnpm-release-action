import { getOctokit } from '@actions/github';
import { throttling } from '@octokit/plugin-throttling';

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
};

// @actions/github の型はハンドラを void 扱いだが、throttling プラグインは boolean の
// 返り値でリトライ可否を判定する（実挙動に合わせて boolean を返す）
const retryTwice = (
  _retryAfter: number,
  _options: unknown,
  _octokit: unknown,
  retryCount: number,
): boolean => retryCount < 2;

export const createGhClient = (
  token: string,
  owner: string,
  repo: string,
): GhClient => {
  // 大きい monorepo の Release 連続作成は secondary rate limit を踏みやすいので
  // throttling プラグインで 2 回まで自動リトライする
  const octokit = getOctokit(
    token,
    {
      throttle: {
        onRateLimit: retryTwice,
        onSecondaryRateLimit: retryTwice,
      },
    },
    throttling,
  );
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
  };
};
