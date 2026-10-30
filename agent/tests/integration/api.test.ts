import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, multipartBody, startHarness, type Harness } from '../support/harness.js';

let h: Harness;
beforeAll(async () => { h = await startHarness({ seedBranches: false }); });
afterAll(async () => { await h.close(); });

describe('envelope, request ids and errors', () => {
  it('serves health with a request id', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.statusCode).toBe(200);
    expect(await json(r)).toMatchObject({ status: 'ok', database: 'up' });
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('echoes a well-formed request id and replaces a malformed one', async () => {
    const ok = await h.app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'trace-abc-12345' } });
    expect(ok.headers['x-request-id']).toBe('trace-abc-12345');
    const bad = await h.app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'bad id\n<script>' } });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the same error envelope for validation, not-found and unknown routes', async () => {
    const v = await h.app.inject({ method: 'GET', url: '/api/uploads?page=0' });
    expect(v.statusCode).toBe(400);
    expect((await json(v)).error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: v.headers['x-request-id'] });

    const badId = await h.app.inject({ method: 'GET', url: '/api/uploads/not-a-uuid' });
    expect(badId.statusCode).toBe(400);

    const nf = await h.app.inject({ method: 'GET', url: '/api/uploads/00000000-0000-4000-8000-000000000000' });
    expect(nf.statusCode).toBe(404);
    expect((await json(nf)).error.code).toBe('NOT_FOUND');

    const snap = await h.app.inject({ method: 'GET', url: '/api/snapshots/00000000-0000-4000-8000-000000000000/summary' });
    expect(snap.statusCode).toBe(404);

    const unknown = await h.app.inject({ method: 'GET', url: '/api/nope' });
    expect(unknown.statusCode).toBe(404);
    expect((await json(unknown)).error.requestId).toBeTruthy();
  });

  it('rejects malformed bodies and non-multipart uploads without leaking internals', async () => {
    const np = await h.app.inject({ method: 'POST', url: '/api/uploads', payload: { a: 1 } });
    expect(np.statusCode).toBe(422);
    expect((await json(np)).error.code).toBe('MULTIPART_REQUIRED');

    const { payload, headers } = multipartBody({ name: 'x.csv', data: Buffer.from('a') }, {});
    const noDate = await h.app.inject({ method: 'POST', url: '/api/uploads', payload, headers });
    expect(noDate.statusCode).toBe(422);
    expect(noDate.body).not.toMatch(/node_modules|\/home\/|at .*\(.*:\d+:\d+\)/);

    const empty = multipartBody({ name: 'x.csv', data: Buffer.from('') }, { snapshotDate: '2026-10-20' });
    expect((await h.app.inject({ method: 'POST', url: '/api/uploads', payload: empty.payload, headers: empty.headers })).statusCode).toBe(422);
  });

  it('refuses unknown properties on strict bodies', async () => {
    const r = await h.app.inject({ method: 'POST', url: '/api/branches', payload: { name: 'فرع', hack: true } });
    expect(r.statusCode).toBe(400);
    const p = await h.app.inject({ method: 'POST', url: '/api/uploads/00000000-0000-4000-8000-000000000000/process', payload: { replaceExisting: 'yes' } });
    expect(p.statusCode).toBe(400);
  });
});

describe('registries and pagination', () => {
  it('creates, lists, searches and paginates branches; rejects duplicates', async () => {
    for (const name of ['فرع أ', 'فرع ب', 'فرع ج']) {
      expect((await h.app.inject({ method: 'POST', url: '/api/branches', payload: { name, aliases: [`${name} (alias)`] } })).statusCode).toBe(201);
    }
    const page1 = await json(await h.app.inject({ method: 'GET', url: '/api/branches?pageSize=2&page=1' }));
    expect(page1.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.data[0].aliases).toHaveLength(1);
    const page2 = await json(await h.app.inject({ method: 'GET', url: '/api/branches?pageSize=2&page=2' }));
    expect(page2.data).toHaveLength(1);
    const q = await json(await h.app.inject({ method: 'GET', url: `/api/branches?q=${encodeURIComponent('ب')}` }));
    expect(q.data.map((b: any) => b.name)).toEqual(['فرع ب']); // eslint-disable-line @typescript-eslint/no-explicit-any
    // the same name written with different Arabic letter forms is the same branch
    const dup = await h.app.inject({ method: 'POST', url: '/api/branches', payload: { name: 'فرع ا' } });
    expect(dup.statusCode).toBe(409);
    expect((await json(dup)).error.code).toBe('BRANCH_EXISTS');
    expect((await h.app.inject({ method: 'GET', url: '/api/branches?pageSize=500' })).statusCode).toBe(400);
  });

  it('lists employees (empty registry) and uploads with a pagination envelope', async () => {
    const e = await json(await h.app.inject({ method: 'GET', url: '/api/employees' }));
    expect(e).toEqual({ data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } });
    const u = await json(await h.app.inject({ method: 'GET', url: '/api/uploads' }));
    // the empty file rejected above is recorded as a REJECTED upload (rejections are audited, not dropped)
    expect(u.pagination.total).toBe(1);
    expect(u.data[0]).toMatchObject({ status: 'REJECTED', originalFilename: 'x.csv' });
    expect(u.data[0]).not.toHaveProperty('storedPath');
  });

  it('writes branch creation to the audit trail with the actor and request id', async () => {
    const rows = (await h.pool.query("SELECT actor_label, request_id, outcome FROM audit_log WHERE action = 'BRANCH_CREATED'")).rows;
    expect(rows.length).toBe(3);
    expect(rows[0]).toMatchObject({ actor_label: 'local-operator', outcome: 'SUCCESS' });
    expect(rows[0].request_id).toBeTruthy();
  });
});
