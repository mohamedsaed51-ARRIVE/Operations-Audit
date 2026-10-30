import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Resolve workspace packages to their TypeScript sources so tests never depend on a prior build. */
export const workspaceAliases = {
  '@arrive/shared': r('./packages/shared/src/index.ts'),
  '@arrive/engine': r('./packages/engine/src/index.ts'),
  '@arrive/database': r('./packages/database/src/index.ts'),
  '@arrive/ai': r('./packages/ai/src/index.ts'),
};
