import { describe, expect, test } from 'vite-plus/test';

import { distTagFor, isValidDistTag } from '../src/core/dist-tag.ts';

describe('distTagFor', () => {
  test('stable versions take the stable tag', () => {
    expect(distTagFor('3.2.2', 'latest')).toBe('latest');
    expect(distTagFor('3.2.2', 'latest-3')).toBe('latest-3');
  });

  test('prereleases take their prerelease identifier', () => {
    expect(distTagFor('4.0.0-beta.0', 'latest')).toBe('beta');
    expect(distTagFor('4.0.0-next-major.2', 'latest-3')).toBe('next-major');
    expect(distTagFor('4.0.0-v4-lts.0', 'latest')).toBe('v4-lts');
  });

  test('build metadata does not count as a prerelease', () => {
    expect(distTagFor('1.0.0+build-5', 'latest')).toBe('latest');
    expect(distTagFor('1.0.0-rc.1+build-5', 'latest')).toBe('rc');
  });

  test('prerelease identifiers that cannot be a dist-tag yield null', () => {
    expect(distTagFor('1.0.0-0', 'latest')).toBeNull();
    expect(distTagFor('1.0.0-v4.0', 'latest')).toBeNull();
    expect(distTagFor('1.0.0-latest.0', 'latest')).toBeNull();
  });
});

describe('isValidDistTag', () => {
  test('accepts names npm keeps as tags', () => {
    expect(isValidDistTag('latest-3')).toBe(true);
    expect(isValidDistTag('beta')).toBe(true);
  });

  test('accepts version-prefixed names that are not a semver range', () => {
    expect(isValidDistTag('v3-lts')).toBe(true);
    expect(isValidDistTag('v2-latest')).toBe(true);
  });

  test('rejects names npm would read as a semver range', () => {
    expect(isValidDistTag('v3')).toBe(false);
    expect(isValidDistTag('3.x')).toBe(false);
    expect(isValidDistTag('^3')).toBe(false);
    expect(isValidDistTag('*')).toBe(false);
    expect(isValidDistTag('')).toBe(false);
  });
});
