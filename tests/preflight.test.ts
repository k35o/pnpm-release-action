import { PreflightError, assertPnpmVersion } from '../src/pnpm/preflight.ts';

test('resolves the pnpm version in a valid cwd', async () => {
  await expect(assertPnpmVersion('.')).resolves.toMatch(/^\d+\.\d+\.\d+/u);
});

test('surfaces the underlying failure instead of blaming a missing pnpm', async () => {
  const missingCwd = './tests/__no-such-directory__';
  await expect(assertPnpmVersion(missingCwd)).rejects.toThrow(PreflightError);
  await expect(assertPnpmVersion(missingCwd)).rejects.toThrow(
    /__no-such-directory__/u,
  );
});
