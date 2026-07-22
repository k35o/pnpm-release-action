import { parsePorcelain } from '../src/core/file-changes.ts';

const NUL = '\0';

test('classifies modified, added, untracked, and deleted entries', () => {
  const raw = [
    ' M package.json',
    'A  .changeset/ledger.yaml',
    '?? .changeset/changelogs/pkg@1.0.0.md',
    ' D .changeset/old-intent.md',
    '',
  ].join(NUL);
  expect(parsePorcelain(raw)).toStrictEqual({
    additions: [
      'package.json',
      '.changeset/ledger.yaml',
      '.changeset/changelogs/pkg@1.0.0.md',
    ],
    deletions: ['.changeset/old-intent.md'],
  });
});

test('a rename becomes an addition of the new path and a deletion of the old', () => {
  const raw = `R  new/path.md${NUL}old/path.md${NUL}`;
  expect(parsePorcelain(raw)).toStrictEqual({
    additions: ['new/path.md'],
    deletions: ['old/path.md'],
  });
});

test('empty status parses to no changes', () => {
  expect(parsePorcelain('')).toStrictEqual({ additions: [], deletions: [] });
});
