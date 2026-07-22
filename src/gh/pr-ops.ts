import type { Octokit } from './octokit.ts';

export type PrRef = { readonly number: number; readonly nodeId: string };

export type PrOps = {
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
  readonly enableAutoMerge: (params: {
    nodeId: string;
    number: number;
  }) => Promise<void>;
};

// enablePullRequestAutoMerge が「repo で auto-merge が無効」「PR が draft」など
// 設定・状態で拒否したときのメッセージ。PR 自体は作れているので arming の失敗だけで
// release run を落とさず warning に留めてよい範囲を判定する。権限やネットワーク等の
// 想定外エラーは対象外にして fatal のまま扱う。
const AUTO_MERGE_UNAVAILABLE: readonly RegExp[] = [
  /not allowed for this repository/iu,
  /draft/iu,
];

export const isAutoMergeUnavailable = (message: string): boolean =>
  AUTO_MERGE_UNAVAILABLE.some((pattern) => pattern.test(message));

export const createPrOps = (
  octokit: Octokit,
  owner: string,
  repo: string,
): PrOps => ({
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
    return pr === undefined ? null : { number: pr.number, nodeId: pr.node_id };
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
});
