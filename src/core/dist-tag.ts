import validRange from 'semver/ranges/valid';

export const isValidDistTag = (tag: string): boolean =>
  validRange(tag) === null;

export const distTagFor = (
  version: string,
  stableTag: string,
): string | null => {
  const [release = ''] = version.split('+');
  const dash = release.indexOf('-');
  if (dash === -1) return stableTag;
  const [preid = ''] = release.slice(dash + 1).split('.');
  return preid !== 'latest' && isValidDistTag(preid) ? preid : null;
};
