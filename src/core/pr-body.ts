import type { ChangelogPreview } from './changelog.ts';
import { releaseKey } from './keys.ts';
import { planTable } from './markdown.ts';
import type { PlanEntry } from './plan.ts';

// GitHub の PR body 上限は 65,536 文字。安全側の 60,000 で2段階に切り詰める。
const MAX_BODY_LENGTH = 60_000;

const HEADER =
  "Merging this PR releases the packages below. Versions and changelogs were computed by [pnpm's release management](https://pnpm.io/versioning); the PR is maintained by [pnpm-release-action](https://github.com/k35o/pnpm-release-action) and rebuilt on every push to the base branch.";

// parked された changelog セクションは "## <version>" 見出しから始まるが、
// パッケージごとの見出しはこちらで付けるため、重複する先頭行だけ取り除く
const stripVersionHeading = (section: string, version: string): string => {
  const lines = section.split('\n');
  if (lines[0]?.trim() === `## ${version}`) {
    return lines.slice(1).join('\n').trim();
  }
  return section.trim();
};

const packageHeading = (entry: PlanEntry): string =>
  `### \`${entry.name}\` ${entry.newVersion}`;

const packageBlock = (entry: PlanEntry, section: string | null): string => {
  if (section === null) {
    return `${packageHeading(entry)}\n\n_No changelog entry was found for this release._`;
  }
  return `${packageHeading(entry)}\n\n${stripVersionHeading(section, entry.newVersion)}`;
};

export const composePrBody = (
  plan: readonly PlanEntry[],
  previews: readonly ChangelogPreview[],
): string => {
  const sections = new Map(
    previews.map((preview) => [
      releaseKey(preview.name, preview.newVersion),
      preview.section,
    ]),
  );
  const assemble = (withBodies: boolean): string =>
    [
      HEADER,
      planTable(plan),
      ...plan.map((entry) =>
        withBodies
          ? packageBlock(
              entry,
              sections.get(releaseKey(entry.name, entry.newVersion)) ?? null,
            )
          : packageHeading(entry),
      ),
    ].join('\n\n');

  const full = assemble(true);
  if (full.length <= MAX_BODY_LENGTH) return full;

  const compact = `${assemble(false)}\n\n_Changelog previews were omitted: the full body exceeds GitHub's size limit._`;
  if (compact.length <= MAX_BODY_LENGTH) return compact;

  return `${HEADER}\n\n${String(plan.length)} packages are in this release — the plan is too large to render here. See the branch diff for details.`;
};
