import gte from 'semver/functions/gte';
import lt from 'semver/functions/lt';
import valid from 'semver/functions/valid';

// semver の比較関数は不正な版で throw するため、先に弾いて false に倒す
export const satisfiesMinimum = (version: string, minimum: string): boolean =>
  valid(version) !== null && gte(version, minimum);

export const isBelow = (version: string, other: string): boolean =>
  valid(version) !== null && valid(other) !== null && lt(version, other);
