import type { Queryable } from './pool.js';

export interface AuditEntry {
  requestId?: string | null;
  actorId?: string | null;
  actorLabel: string;
  action: string;
  entityType?: string;
  entityId?: string;
  outcome?: 'SUCCESS' | 'FAILURE';
  details?: Record<string, unknown>;
}

/** Appends to the immutable audit trail. */
export async function writeAudit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (request_id, actor_id, actor_label, action, entity_type, entity_id, outcome, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.requestId ?? null, e.actorId ?? null, e.actorLabel, e.action, e.entityType ?? null, e.entityId ?? null, e.outcome ?? 'SUCCESS', JSON.stringify(e.details ?? {})],
  );
}

export async function listAudit(db: Queryable, filter: { entityType?: string; entityId?: string; limit?: number }) {
  const r = await db.query(
    `SELECT id, occurred_at, request_id, actor_label, action, entity_type, entity_id, outcome, details
     FROM audit_log WHERE ($1::text IS NULL OR entity_type = $1) AND ($2::text IS NULL OR entity_id = $2)
     ORDER BY id DESC LIMIT $3`,
    [filter.entityType ?? null, filter.entityId ?? null, filter.limit ?? 100],
  );
  return r.rows;
}
