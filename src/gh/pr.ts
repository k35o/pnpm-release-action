import { getOctokit } from '@actions/github';

export type PrRef = { readonly number: number; readonly nodeId: string };

export type PrClient = {
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
};

export const createPrClient = (
  token: string,
  owner: string,
  repo: string,
): PrClient => {
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
  };
};
