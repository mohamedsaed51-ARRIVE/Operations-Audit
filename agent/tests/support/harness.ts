import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createPool, migrateUp, seedReferenceData, type Pool } from '@arrive/database';
import { buildApp } from '../../apps/api/src/app.js';
import type { Config } from '../../apps/api/src/config.js';
import { BRANCHES } from '../fixtures/expected.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://arrive:arrive_dev@127.0.0.1:5432/arrive_audit_test';

/** Tests run "on" this day, so date rules never depend on the machine clock. */
export const FIXED_NOW = new Date('2026-11-15T10:00:00Z');

export const FIXTURES = fileURLToPath(new URL('../fixtures/files/', import.meta.url));

export interface Harness {
  app: FastifyInstance;
  pool: Pool;
  uploadDir: string;
  close(): Promise<void>;
}

/** Fresh database + app with its own upload directory. */
export async function startHarness(opts: { seedBranches?: boolean } = {}): Promise<Harness> {
  const pool = createPool(TEST_DATABASE_URL, 8);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrateUp(pool);
  await seedReferenceData(pool);
  const uploadDir = mkdtempSync(join(tmpdir(), 'arrive-uploads-'));
  const config: Config = { env: 'test', port: 0, host: '127.0.0.1', databaseUrl: TEST_DATABASE_URL, uploadDir, logLevel: 'silent', authMode: 'none' };
  const app = await buildApp({ config, pool, clock: () => FIXED_NOW });
  await app.ready();
  const h: Harness = {
    app, pool, uploadDir,
    close: async () => { await app.close(); await pool.end(); rmSync(uploadDir, { recursive: true, force: true }); },
  };
  if (opts.seedBranches !== false) {
    for (const b of BRANCHES) {
      const r = await app.inject({ method: 'POST', url: '/api/branches', payload: b });
      if (r.statusCode !== 201) throw new Error(`branch seed failed: ${r.body}`);
    }
  }
  return h;
}

export function multipartBody(file: { name: string; data: Buffer; contentType?: string }, fields: Record<string, string>) {
  const boundary = '----arrive' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.contentType ?? 'application/octet-stream'}\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export const fixture = (name: string) => readFileSync(join(FIXTURES, name));
export const fixtureName = (path: string) => basename(path);

export async function upload(h: Harness, file: string | { name: string; data: Buffer }, snapshotDate: string, extra: Record<string, string> = {}) {
  const f = typeof file === 'string' ? { name: file, data: fixture(file) } : file;
  const { payload, headers } = multipartBody(f, { snapshotDate, ...extra });
  return h.app.inject({ method: 'POST', url: '/api/uploads', payload, headers });
}

export async function json<T = any>(res: { body: string }): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return JSON.parse(res.body) as T;
}

export interface UploadDetail {
  upload: { id: string; status: string; snapshotDate: string; fileType: string };
  sheets: { sheetIndex: number; name: string; headerRowIndex: number | null; detection: any; status: string }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  issueSummary: unknown;
}

export const mappingFor = (sheetIndex: number, fields: Record<string, number>, acknowledged: string[] = []) => ({
  sheetIndex, include: true, fields, acknowledged,
});

/** Upload → confirm mapping for the first sheet (others excluded) → process. Returns ids. */
export async function ingest(h: Harness, file: string, snapshotDate: string, fields: Record<string, number>, processBody: Record<string, unknown> = {}) {
  const up = await upload(h, file, snapshotDate);
  if (up.statusCode !== 201) throw new Error(`upload failed: ${up.body}`);
  const detail = await json<UploadDetail>(up);
  const id = detail.upload.id;
  const sheets = detail.sheets.map((s) => (s.sheetIndex === 0 ? mappingFor(0, fields) : { sheetIndex: s.sheetIndex, include: false, fields: {}, acknowledged: [] }));
  const map = await h.app.inject({ method: 'POST', url: `/api/uploads/${id}/mapping`, payload: { sheets } });
  if (map.statusCode !== 200) throw new Error(`mapping failed: ${map.body}`);
  const proc = await h.app.inject({ method: 'POST', url: `/api/uploads/${id}/process`, payload: processBody });
  return { uploadId: id, processRes: proc };
}
