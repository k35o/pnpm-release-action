export type ChangelogPreview = {
  readonly name: string;
  readonly newVersion: string;
  readonly section: string | null;
};

// CHANGELOG.md から "## <version>" セクションを次の "## " 見出しの手前まで抜き出す
export const extractVersionSection = (
  changelog: string,
  version: string,
): string | null => {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith('## ') === true) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
};
