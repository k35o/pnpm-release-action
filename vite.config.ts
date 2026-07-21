import { fmt, test, typescript } from '@k8o/oxc-config';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ...fmt,
    ignorePatterns: ['CHANGELOG.md'],
  },
  lint: {
    extends: [typescript],
    ignorePatterns: ['CHANGELOG.md'],
    options: {
      typeAware: true,
    },
    overrides: [
      {
        files: ['tests/**/*.test.ts'],
        plugins: [...(test.plugins ?? [])],
        rules: test.rules ?? {},
      },
    ],
  },
  pack: {
    // GitHub Actions のランタイムには node_modules が無いため、依存ごと単一ファイルに束ねる
    entry: ['src/index.ts'],
    format: 'esm',
    dts: false,
    outDir: 'dist',
    unbundle: false,
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
  staged: {
    '*.{js,ts,cjs,mjs,jsx,tsx,json,jsonc}': 'vp check --fix',
  },
});
