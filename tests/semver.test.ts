import { describe, expect, test } from 'vite-plus/test';

import { isBelow, satisfiesMinimum } from '../src/core/semver.ts';

describe('isBelow', () => {
  test('an older line is below the current latest', () => {
    expect(isBelow('3.2.2', '4.0.0')).toBe(true);
    expect(isBelow('4.0.0', '4.0.1')).toBe(true);
  });

  test('the same or a newer version is not below', () => {
    expect(isBelow('4.0.0', '4.0.0')).toBe(false);
    expect(isBelow('4.1.0', '4.0.9')).toBe(false);
  });

  test('a stable version is above its own prerelease', () => {
    expect(isBelow('4.0.0', '4.0.0-beta.3')).toBe(false);
    expect(isBelow('4.0.0-beta.3', '4.0.0')).toBe(true);
  });

  test('unparsable versions are never below', () => {
    expect(isBelow('not-a-version', '1.0.0')).toBe(false);
  });
});

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
