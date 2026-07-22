import { diffLedger, parseLedger } from '../src/core/ledger.ts';

const raw = [
  '"@scope/pkg-a@1.1.0":',
  '  dir: packages/a',
  '  intents:',
  '    - one',
  '"pkg-b@2.0.0":',
  '  dir: packages/b',
  '  intents: []',
].join('\n');

test('parses scoped keys at the last @', () => {
  const ledger = parseLedger(raw);
  expect(ledger.get('@scope/pkg-a@1.1.0')).toStrictEqual({
    name: '@scope/pkg-a',
    version: '1.1.0',
    dir: 'packages/a',
  });
  expect(ledger.get('pkg-b@2.0.0')?.name).toBe('pkg-b');
});

test('null and malformed input parse as an empty ledger', () => {
  expect(parseLedger(null).size).toBe(0);
  expect(parseLedger('just a string').size).toBe(0);
});

test('diff returns only entries missing from the previous ledger', () => {
  const previous = parseLedger('"pkg-b@2.0.0":\n  dir: packages/b\n');
  const added = diffLedger(parseLedger(raw), previous);
  expect(added).toStrictEqual([
    { name: '@scope/pkg-a', version: '1.1.0', dir: 'packages/a' },
  ]);
});
