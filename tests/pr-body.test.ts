import { composePrBody } from '../src/core/pr-body.ts';

const plan = [
  { name: '@scope/pkg-a', currentVersion: '1.0.0', newVersion: '1.1.0' },
];

test('renders the plan table and the changelog preview', () => {
  const body = composePrBody(plan, [
    {
      name: '@scope/pkg-a',
      newVersion: '1.1.0',
      section: '## 1.1.0\n\n### Minor Changes\n\n- Added a thing.',
    },
  ]);
  expect(body).toContain('| `@scope/pkg-a` | 1.0.0 | 1.1.0 |');
  expect(body).toContain('### `@scope/pkg-a` 1.1.0');
  expect(body).toContain('- Added a thing.');
  expect(body).not.toMatch(/^## 1\.1\.0$/mu);
});

test('notes a missing changelog entry', () => {
  const body = composePrBody(plan, [
    { name: '@scope/pkg-a', newVersion: '1.1.0', section: null },
  ]);
  expect(body).toContain('_No changelog entry was found');
});

test('drops changelog bodies when the full body exceeds the limit', () => {
  const body = composePrBody(plan, [
    {
      name: '@scope/pkg-a',
      newVersion: '1.1.0',
      section: `## 1.1.0\n\n${'x'.repeat(70_000)}`,
    },
  ]);
  expect(body.length).toBeLessThanOrEqual(60_000);
  expect(body).toContain('Changelog previews were omitted');
  expect(body).toContain('### `@scope/pkg-a` 1.1.0');
});

test('falls back to a package count when even headings overflow', () => {
  const hugePlan = Array.from({ length: 3000 }, (_, index) => ({
    name: `package-${'n'.repeat(20)}-${String(index)}`,
    currentVersion: '1.0.0',
    newVersion: '1.0.1',
  }));
  const body = composePrBody(hugePlan, []);
  expect(body.length).toBeLessThanOrEqual(60_000);
  expect(body).toContain('3000 packages');
});
