import { expect, test } from 'vite-plus/test';

import { PlanParseError, parsePlanOutput } from '../src/core/plan.ts';

test('parses the observed JSON array shape', () => {
  expect(
    parsePlanOutput(
      '[{"name":"@scope/pkg-b","currentVersion":"2.1.0","newVersion":"2.2.0"}]',
    ),
  ).toStrictEqual([
    { name: '@scope/pkg-b', currentVersion: '2.1.0', newVersion: '2.2.0' },
  ]);
});

test('parses an empty array as an empty plan', () => {
  expect(parsePlanOutput('[]\n')).toStrictEqual([]);
});

test('fails loudly on unrecognized output', () => {
  expect(() => parsePlanOutput('something else entirely')).toThrow(
    PlanParseError,
  );
  expect(() => parsePlanOutput('')).toThrow(PlanParseError);
  expect(() => parsePlanOutput('[broken')).toThrow(PlanParseError);
  expect(() => parsePlanOutput('[{"name":1}]')).toThrow(PlanParseError);
  expect(() => parsePlanOutput('{"not":"an array"}')).toThrow(PlanParseError);
});
