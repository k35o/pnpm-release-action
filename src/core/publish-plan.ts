import { distTagFor } from './dist-tag.ts';
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

export type PublishGroup = {
  readonly tag: string;
  readonly names: readonly string[];
};

// `pnpm publish -r --tag` は選んだ全パッケージに同じ tag を付けるため、lane の
// prerelease と main lane の stable が同じリリースに混ざると tag ごとに分けて
// publish するしかない
export const planPublishGroups = (
  packages: readonly WorkspacePackage[],
  stableTag: string,
): { groups: PublishGroup[]; untaggable: WorkspacePackage[] } => {
  const byTag = new Map<string, string[]>();
  const untaggable: WorkspacePackage[] = [];
  for (const pkg of packages) {
    if (pkg.private || pkg.version === null) continue;
    const tag = distTagFor(pkg.version, stableTag);
    if (tag === null) {
      untaggable.push(pkg);
      continue;
    }
    byTag.set(tag, [...(byTag.get(tag) ?? []), pkg.name]);
  }
  return {
    groups: [...byTag].map(([tag, names]) => ({ tag, names })),
    untaggable,
  };
};

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
