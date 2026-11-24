import { describe, expect, test } from 'vite-plus/test';

import {
  buildReleaseTargets,
  planPublishGroups,
  tagNameFor,
} from '../src/core/publish-plan.ts';

describe('planPublishGroups', () => {
  test('splits public packages by dist-tag', () => {
    const { groups, untaggable } = planPublishGroups(
      [
        { name: 'a', version: '1.0.0', path: '/a', private: false },
        { name: 'b', version: '2.0.0-alpha.1', path: '/b', private: false },
        { name: 'c', version: '1.4.0', path: '/c', private: false },
        { name: 'd', version: '3.0.0-rc.0', path: '/d', private: true },
        { name: 'root', version: null, path: '/', private: true },
      ],
      'latest',
    );
    expect(groups).toStrictEqual([
      { tag: 'latest', names: ['a', 'c'] },
      { tag: 'alpha', names: ['b'] },
    ]);
    expect(untaggable).toStrictEqual([]);
  });

  test('sets aside prereleases without a usable identifier', () => {
    const { groups, untaggable } = planPublishGroups(
      [{ name: 'a', version: '1.0.0-0', path: '/a', private: false }],
      'latest',
    );
    expect(groups).toStrictEqual([]);
    expect(untaggable.map((pkg) => pkg.name)).toStrictEqual(['a']);
  });
});

describe('tagNameFor', () => {
  test('single-package workspaces use v-prefixed tags', () => {
    expect(tagNameFor(true, 'pkg', '1.2.3')).toBe('v1.2.3');
    expect(tagNameFor(false, '@scope/pkg', '1.2.3')).toBe('@scope/pkg@1.2.3');
  });
});

describe('buildReleaseTargets', () => {
  test('unions the summary and the ledger diff without duplicates', () => {
    const targets = buildReleaseTargets(
      [{ name: 'a', version: '1.1.0' }],
      [
        { name: 'a', version: '1.1.0' },
        { name: 'private-b', version: '0.2.0' },
      ],
      false,
    );
    expect(targets).toStrictEqual([
      { name: 'a', version: '1.1.0', tag: 'a@1.1.0' },
      { name: 'private-b', version: '0.2.0', tag: 'private-b@0.2.0' },
    ]);
  });
});
