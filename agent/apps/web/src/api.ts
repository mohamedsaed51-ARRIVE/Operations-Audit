import type { ApiErrorBody, Paginated } from '@arrive/shared';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public requestId?: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `HTTP ${res.status}`, e?.details, e?.requestId);
  }
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ───── shapes returned by the API (only the fields the UI reads) ─────
export interface Candidate { columnIndex: number; header: string; score: number; reasons: string[] }
export interface FieldDetection { field: string; status: 'CONFIDENT' | 'AMBIGUOUS' | 'LOW' | 'MISSING'; suggestedColumn: number | null; confidence: number; candidates: Candidate[] }
export interface Detection { headerRowIndex: number; headerConfidence: 'HIGH' | 'LOW'; headers: string[]; fields: Record<string, FieldDetection> }
export interface Sheet { id: string; firstExcelRow: number; sheetIndex: number; name: string; hidden: boolean; rowCount: number; headerRowIndex: number | null; headers: string[]; detection: Detection | null; status: string; mapping: { version: number; columns: Record<string, number>; acknowledged: string[] } | null }
export interface Upload { id: string; originalFilename: string; fileType: string | null; snapshotDate: string; status: string; sizeBytes: number; createdAt: string; failureReason: string | null; errorCount?: number }
export interface IssueCount { category: string; severity: string; n: number }
export interface UploadDetail { upload: Upload; snapshot: { id: string; snapshotDate: string; version: number } | null; sheets: Sheet[]; issueSummary: { byCategory: IssueCount[]; byCode: { code: string; category: string; severity: string; n: number }[] } }
export interface Preview { sheet: { index: number; name: string; rowCount: number; firstExcelRow: number; headerRowIndex: number | null }; headers: string[]; maskedColumns: number[]; rows: { rowNumber: number; cells: (string | null)[] }[]; note: string }
export interface Issue { issueId: number; stage: string; code: string; category: string; severity: string; worksheet: string | null; rowNumber: number | null; field: string | null; originalValue: string | null; explanation: string; suggestion: string }
export interface MappingOutcome { sheetIndex: number; sheetName: string; included: boolean; ok: boolean; errors: Issue[]; warnings: Issue[]; normalizedPreview: Record<string, unknown>[]; previewIssues: Issue[] }
export interface Snapshot { id: string; snapshotDate: string; version: number; isActive: boolean; originalFilename: string; totalRows: number; ingestedRows: number; rejectedRows: number; emptyRows: number; duplicateRows: number; comparisonMode: string | null; completedAt: string }
export interface Summary { snapshot: Snapshot & { uploadId: string }; totals: Record<string, number>; byAgeCategory: { ageCategory: string | null; n: number }[]; byStatus: { status: string; n: number }[]; byBranch: { branch: string; n: number; overMaxAge: number; missingEmployee: number }[]; byStatusAgeBasis: { basis: string; n: number }[] }
export interface Comparison { id: string; previousSnapshotDate: string | null; daysBetween: number | null; mode: string; newCount: number; continuedCount: number; statusChangedCount: number; branchChangedCount: number; employeeChangedCount: number; disappearedCount: number; reappearedCount: number; warnings: { code: string; message: string }[] }
export interface ComparisonItem { trackingNumber: string; changeTypes: string[]; prevStatusRaw: string | null; prevBranchRaw: string | null; prevEmployeeRaw: string | null; currStatusRaw: string | null; currBranchRaw: string | null; currEmployeeRaw: string | null; lastSeenDate: string | null }
export interface ProcessResult { snapshotId: string; snapshotDate: string; version: number; stats: Record<string, number>; comparison: { mode: string; counts: Record<string, number>; warnings: { code: string; message: string }[] } }

export const api = {
  uploads: (page = 1) => call<Paginated<Upload>>(`/api/uploads${qs({ page, pageSize: 20 })}`),
  upload: (id: string) => call<UploadDetail>(`/api/uploads/${id}`),
  createUpload: (file: File, snapshotDate: string) => {
    const f = new FormData();
    f.append('snapshotDate', snapshotDate);
    f.append('file', file);
    return call<UploadDetail>('/api/uploads', { method: 'POST', body: f });
  },
  preview: (id: string, sheet: number, limit = 20) => call<Preview>(`/api/uploads/${id}/preview${qs({ sheet, limit })}`),
  issues: (id: string, q: Record<string, string | number | undefined>) => call<Paginated<Issue>>(`/api/uploads/${id}/issues${qs(q)}`),
  mapping: (id: string, sheets: unknown[], dryRun: boolean) =>
    call<{ saved: boolean; sheets: MappingOutcome[] }>(`/api/uploads/${id}/mapping${dryRun ? '?dryRun=true' : ''}`, json('POST', { sheets })),
  process: (id: string, body: Record<string, boolean>) => call<ProcessResult>(`/api/uploads/${id}/process`, json('POST', body)),
  snapshots: (page = 1) => call<Paginated<Snapshot>>(`/api/snapshots${qs({ page, pageSize: 30 })}`),
  summary: (id: string) => call<Summary>(`/api/snapshots/${id}/summary`),
  comparison: (id: string, changeType: string | undefined, page: number) =>
    call<{ comparison: Comparison; items: Paginated<ComparisonItem> }>(`/api/snapshots/${id}/comparison${qs({ changeType, page, pageSize: 25 })}`),
  branches: () => call<Paginated<{ id: string; name: string }>>('/api/branches?pageSize=200'),
  health: () => call<{ status: string; database: string }>('/api/health'),
};
