import type { Octokit } from './octokit.ts';

export type ReleaseOps = {
  readonly hasRelease: (tag: string) => Promise<boolean>;
  readonly createRelease: (params: {
    tag: string;
    body: string;
    prerelease: boolean;
  }) => Promise<void>;
};

export const createReleaseOps = (
  octokit: Octokit,
  owner: string,
  repo: string,
): ReleaseOps => ({
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
});
