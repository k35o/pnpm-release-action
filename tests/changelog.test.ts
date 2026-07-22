import { extractVersionSection } from '../src/core/changelog.ts';

const changelog = [
  '# fixture-pkg',
  '',
  '## 1.1.0',
  '',
  '### Minor Changes',
  '',
  '- New feature.',
  '',
  '## 1.0.0',
  '',
  '- Initial release.',
  '',
].join('\n');

test('extracts a section up to the next version heading', () => {
  const section = extractVersionSection(changelog, '1.1.0');
  expect(section).toContain('- New feature.');
  expect(section).not.toContain('- Initial release.');
});

test('extracts the last section to the end of the file', () => {
  expect(extractVersionSection(changelog, '1.0.0')).toContain(
    '- Initial release.',
  );
});

test('returns null for an unknown version', () => {
  expect(extractVersionSection(changelog, '9.9.9')).toBeNull();
});
