// pnpm のバージョン床チェックと latest の後退検知にしか使わないため、semver
// ライブラリを足す代わりに major.minor.patch の数値比較だけを実装する。同じ
// major.minor.patch なら prerelease を下に置く（11.13.0-beta.0 < 11.13.0）が、
// prerelease 同士の識別子は比べない。どちらの用途も一方が stable だからである。

const parseVersion = (
  version: string,
): { triple: [number, number, number]; prerelease: boolean } | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)(-)?/u.exec(version.trim());
  if (match === null) return null;
  return {
    triple: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] !== undefined,
  };
};

const compareVersions = (a: string, b: string): number | null => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) return null;
  for (const index of [0, 1, 2] as const) {
    const diff = left.triple[index] - right.triple[index];
    if (diff !== 0) return diff;
  }
  return Number(right.prerelease) - Number(left.prerelease);
};

export const satisfiesMinimum = (version: string, minimum: string): boolean => {
  const order = compareVersions(version, minimum);
  return order !== null && order >= 0;
};

export const isBelow = (version: string, other: string): boolean => {
  const order = compareVersions(version, other);
  return order !== null && order < 0;
};
