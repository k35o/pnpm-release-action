import type { PlanEntry } from './plan.ts';

// pnpm は現在の版がレジストリに無いパッケージを bump せず、その版のまま初回
// リリースにする（currentVersion === newVersion）。版をそのまま並べると何も
// 変わらないリリースに見えるため、From 側を未公開として示す
const fromVersion = (entry: PlanEntry): string =>
  entry.currentVersion === entry.newVersion
    ? '_unpublished_'
    : entry.currentVersion;

// PR body と STEP_SUMMARY で共用するプラン表
export const planTable = (plan: readonly PlanEntry[]): string =>
  [
    '| Package | From | To |',
    '| --- | --- | --- |',
    ...plan.map(
      (entry) =>
        `| \`${entry.name}\` | ${fromVersion(entry)} | ${entry.newVersion} |`,
    ),
  ].join('\n');

export const publishedTable = (
  published: ReadonlyArray<{ name: string; version: string }>,
): string =>
  [
    '| Package | Version |',
    '| --- | --- |',
    ...published.map((pkg) => `| \`${pkg.name}\` | ${pkg.version} |`),
  ].join('\n');
