// The spreadsheet worker is hand-written CommonJS (it must load inside a worker_thread
// without a TypeScript loader), so tsc does not emit it. Copy it next to the compiled output.
import { copyFileSync, mkdirSync } from 'node:fs';
import { URL } from 'node:url';
mkdirSync(new URL('../dist/parse/', import.meta.url), { recursive: true });
copyFileSync(new URL('../src/parse/xlsx-worker.cjs', import.meta.url), new URL('../dist/parse/xlsx-worker.cjs', import.meta.url));
