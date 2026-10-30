import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './vitest.shared.js';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/api/test/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    // DB-backed suites share one PostgreSQL schema and must not run in parallel.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/index.ts', 'packages/database/src/cli.ts', 'apps/api/src/server.ts'],
      reporter: ['text-summary', 'text', 'json-summary'],
    },
  },
});
