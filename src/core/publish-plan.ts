import { releaseKey } from './keys.ts';

export type PublishedPackage = {
  readonly name: string;
  readonly version: string;
};

export type WorkspacePackage = {
  readonly name: string;
  readonly version: string | null;
  readonly path: string;
  readonly private: boolean;
};

// 内蔵 publish は dist-tag を指定しない（= latest）ため、prerelease が混ざって
// いたら guard で止める。private は publish されないので対象外
export const findPrereleaseLeaks = (
  packages: readonly WorkspacePackage[],
): WorkspacePackage[] =>
  packages.filter((pkg) => !pkg.private && pkg.version?.includes('-') === true);

export const tagNameFor = (
  singlePackage: boolean,
  name: string,
  version: string,
): string => (singlePackage ? `v${version}` : `${name}@${version}`);

export type ReleaseTarget = {
  readonly name: string;
  readonly version: string;
  readonly tag: string;
};

// タグ/Release の対象 = publish summary（一次）∪ ledger 差分（private など
// publish されないが version されたものの補完）。name@version で重複排除
export const buildReleaseTargets = (
  published: readonly PublishedPackage[],
  ledgerNew: ReadonlyArray<{ readonly name: string; readonly version: string }>,
  singlePackage: boolean,
): ReleaseTarget[] => {
  const seen = new Set<string>();
  const targets: ReleaseTarget[] = [];
  for (const { name, version } of [...published, ...ledgerNew]) {
    const key = releaseKey(name, version);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      name,
      version,
      tag: tagNameFor(singlePackage, name, version),
    });
  }
  return targets;
};
