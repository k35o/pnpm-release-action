export type FileChanges = {
  readonly additions: readonly string[];
  readonly deletions: readonly string[];
};

// `git status --porcelain -z` (リポジトリルートで実行) の出力を
// createCommitOnBranch 用の additions / deletions に変換する。
// -z 形式: "XY path\0"、rename/copy は "XY new\0old\0" の2エントリ。
export const parsePorcelain = (raw: string): FileChanges => {
  const additions: string[] = [];
  const deletions: string[] = [];
  const entries = raw.split('\0');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined || entry.length < 4) continue;
    const status = new Set(entry.slice(0, 2));
    const path = entry.slice(3);
    if (status.has('R') || status.has('C')) {
      // rename/copy: 次のエントリが旧パス。旧を削除・新を追加として扱う
      additions.push(path);
      const oldPath = entries[index + 1];
      if (oldPath !== undefined && oldPath !== '') {
        if (status.has('R')) deletions.push(oldPath);
        index += 1;
      }
      continue;
    }
    if (status.has('D')) {
      deletions.push(path);
      continue;
    }
    additions.push(path);
  }
  return { additions, deletions };
};
