import { satisfiesMinimum } from '../src/core/semver.ts';

test('the floor itself satisfies the minimum', () => {
  expect(satisfiesMinimum('11.13.0', '11.13.0')).toBe(true);
});

test('higher minor and major versions satisfy the minimum', () => {
  expect(satisfiesMinimum('11.15.1', '11.13.0')).toBe(true);
  expect(satisfiesMinimum('12.0.0', '11.13.0')).toBe(true);
});

test('lower versions do not satisfy the minimum', () => {
  expect(satisfiesMinimum('11.12.9', '11.13.0')).toBe(false);
  expect(satisfiesMinimum('10.33.0', '11.13.0')).toBe(false);
});

test('a prerelease above the floor satisfies it', () => {
  expect(satisfiesMinimum('12.0.0-alpha.17', '11.13.0')).toBe(true);
});

test('a prerelease of the floor itself does not satisfy it', () => {
  expect(satisfiesMinimum('11.13.0-beta.0', '11.13.0')).toBe(false);
});

test('unparsable versions fail closed', () => {
  expect(satisfiesMinimum('not-a-version', '11.13.0')).toBe(false);
});
