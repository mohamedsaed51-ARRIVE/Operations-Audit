import { foldKey, type RegistryContext } from '@arrive/engine';
import type { Queryable } from './pool.js';
import { camelizeAll } from './rows.js';

export async function loadRegistries(db: Queryable): Promise<RegistryContext> {
  const statuses = new Map<string, { code: string; label: string }>();
  const sr = await db.query<{ alias_key: string; code: string; label_ar: string }>(
    `SELECT a.alias_key, d.code, d.label_ar FROM status_aliases a JOIN status_dictionary d ON d.id = a.status_id WHERE d.is_active`);
  for (const r of sr.rows) statuses.set(r.alias_key, { code: r.code, label: r.label_ar });

  const branches = new Map<string, { id: string; name: string }>();
  const br = await db.query<{ id: string; name: string; name_key: string }>('SELECT id, name, name_key FROM branches WHERE is_active');
  for (const r of br.rows) branches.set(r.name_key, { id: r.id, name: r.name });
  const ar = await db.query<{ alias_key: string; id: string; name: string }>(
    'SELECT a.alias_key, b.id, b.name FROM branch_aliases a JOIN branches b ON b.id = a.branch_id WHERE b.is_active');
  for (const r of ar.rows) if (!branches.has(r.alias_key)) branches.set(r.alias_key, { id: r.id, name: r.name });

  const employees = new Map<string, { id: string; branchId: string | null; verified: boolean }>();
  const er = await db.query<{ id: string; name_key: string; branch_id: string | null; is_verified: boolean }>(
    'SELECT id, name_key, branch_id, is_verified FROM employees WHERE is_active');
  for (const r of er.rows) employees.set(r.name_key, { id: r.id, branchId: r.branch_id, verified: r.is_verified });
  return { statuses, branches, employees };
}

export interface Page { page: number; pageSize: number }
const offsetOf = (p: Page) => (p.page - 1) * p.pageSize;

export async function listBranches(db: Queryable, p: Page, q?: string) {
  const like = q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null;
  const total = (await db.query<{ n: number }>(
    'SELECT count(*) AS n FROM branches WHERE ($1::text IS NULL OR name ILIKE $1 OR name_key ILIKE $1)', [like])).rows[0]!.n;
  const rows = (await db.query(
    `SELECT b.id, b.name, b.code, b.governorate, b.is_active, b.source, b.created_at,
            COALESCE((SELECT array_agg(alias ORDER BY alias) FROM branch_aliases a WHERE a.branch_id = b.id), '{}') AS aliases
     FROM branches b WHERE ($1::text IS NULL OR b.name ILIKE $1 OR b.name_key ILIKE $1)
     ORDER BY b.name LIMIT $2 OFFSET $3`, [like, p.pageSize, offsetOf(p)])).rows;
  return { rows: camelizeAll(rows), total };
}

export async function createBranch(db: Queryable, input: { name: string; code?: string | null; governorate?: string | null; aliases?: string[]; source?: 'MANUAL' | 'AUTO_REGISTERED_FROM_UPLOAD' }) {
  const key = foldKey(input.name);
  const r = await db.query<{ id: string }>(
    `INSERT INTO branches (name, name_key, code, governorate, source) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [input.name, key, input.code ?? null, input.governorate ?? null, input.source ?? 'MANUAL']);
  const id = r.rows[0]!.id;
  for (const alias of input.aliases ?? []) {
    await db.query('INSERT INTO branch_aliases (branch_id, alias, alias_key) VALUES ($1,$2,$3) ON CONFLICT (alias_key) DO NOTHING', [id, alias, foldKey(alias)]);
  }
  return id;
}

export async function listEmployees(db: Queryable, p: Page, q?: string) {
  const like = q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null;
  const total = (await db.query<{ n: number }>(
    'SELECT count(*) AS n FROM employees WHERE ($1::text IS NULL OR name ILIKE $1 OR name_key ILIKE $1)', [like])).rows[0]!.n;
  const rows = (await db.query(
    `SELECT e.id, e.name, e.is_verified, e.is_active, e.source, e.created_at, e.branch_id, b.name AS branch_name
     FROM employees e LEFT JOIN branches b ON b.id = e.branch_id
     WHERE ($1::text IS NULL OR e.name ILIKE $1 OR e.name_key ILIKE $1)
     ORDER BY e.name LIMIT $2 OFFSET $3`, [like, p.pageSize, offsetOf(p)])).rows;
  return { rows: camelizeAll(rows), total };
}

export async function createEmployee(db: Queryable, input: { name: string; branchId?: string | null; verified?: boolean; source?: 'MANUAL' | 'AUTO_REGISTERED_FROM_UPLOAD' }) {
  const r = await db.query<{ id: string }>(
    'INSERT INTO employees (name, name_key, branch_id, is_verified, source) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [input.name, foldKey(input.name), input.branchId ?? null, input.verified ?? false, input.source ?? 'MANUAL']);
  return r.rows[0]!.id;
}
