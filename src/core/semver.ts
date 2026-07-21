// pnpm のバージョン床チェックにしか使わないため、semver ライブラリを足す代わりに
// major.minor.patch の数値比較だけを実装する。prerelease は「床より上のバージョンの
// prerelease は通す（12.0.0-alpha は 11.13.0 を満たす）」「床そのものの prerelease は
// 落とす（11.13.0-beta.0 は 11.13.0 に届いていない）」という semver 順序に従う。

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

export const satisfiesMinimum = (version: string, minimum: string): boolean => {
  const actual = parseVersion(version);
  const floor = parseVersion(minimum);
  if (actual === null || floor === null) return false;
  for (const index of [0, 1, 2] as const) {
    if (actual.triple[index] > floor.triple[index]) return true;
    if (actual.triple[index] < floor.triple[index]) return false;
  }
  return !actual.prerelease;
};
