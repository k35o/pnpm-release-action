import type { PlanEntry } from './plan.ts';

// PR body と STEP_SUMMARY で共用するプラン表
export const planTable = (plan: readonly PlanEntry[]): string =>
  [
    '| Package | From | To |',
    '| --- | --- | --- |',
    ...plan.map(
      (entry) =>
        `| \`${entry.name}\` | ${entry.currentVersion} | ${entry.newVersion} |`,
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
