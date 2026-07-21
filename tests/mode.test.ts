import { decideMode } from '../src/core/mode.ts';

test('a pending plan always means version-PR mode', () => {
  expect(decideMode(true, 'publish')).toBe('version');
  expect(decideMode(true, 'none')).toBe('version');
});

test('an empty plan follows mode-when-clean', () => {
  expect(decideMode(false, 'publish')).toBe('publish');
  expect(decideMode(false, 'none')).toBe('none');
});
