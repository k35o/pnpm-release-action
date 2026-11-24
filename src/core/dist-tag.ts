// npm は semver range として読める名前（`v3`、`4`、`3.x` など）を dist-tag として
// 受け付けない。lane 名と `dist-tag` input で現実に起きうる形だけを弾く
export const isValidDistTag = (tag: string): boolean =>
  tag !== '' && !/^v?\d/u.test(tag);

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
