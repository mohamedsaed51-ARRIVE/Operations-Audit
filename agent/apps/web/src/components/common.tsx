import { Alert, Box, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../api';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const run = useCallback(fn, deps);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    run().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error: Error) => live && setState({ data: null, error, loading: false }),
    );
    return () => { live = false; };
  }, [run, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function Async<T>({ state, children }: { state: { data: T | null; error: Error | null; loading: boolean }; children: (d: T) => ReactNode }) {
  if (state.loading && !state.data) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;
  if (state.error) return <ErrorAlert error={state.error} />;
  return state.data ? <>{children(state.data)}</> : null;
}

export function ErrorAlert({ error }: { error: Error }) {
  const e = error as ApiError;
  return (
    <Alert severity="error" sx={{ my: 2 }}>
      <Typography fontWeight={700}>{e.message}</Typography>
      {e.code && <Typography variant="caption" sx={{ direction: 'ltr', display: 'block' }}>{e.code}{e.requestId ? ` · ${e.requestId}` : ''}</Typography>}
    </Alert>
  );
}

const SEVERITY: Record<string, { label: string; color: 'error' | 'warning' | 'info' }> = {
  ERROR: { label: 'خطأ', color: 'error' }, WARNING: { label: 'تحذير', color: 'warning' }, INFO: { label: 'معلومة', color: 'info' },
};
export const SeverityChip = ({ severity }: { severity: string }) => (
  <Chip size="small" label={SEVERITY[severity]?.label ?? severity} color={SEVERITY[severity]?.color ?? 'default'} variant="outlined" />
);

export const CATEGORY_LABEL: Record<string, string> = {
  FILE_LEVEL: 'أخطاء على مستوى الملف', ROW_LEVEL: 'أخطاء على مستوى الصف', BUSINESS_WARNING: 'تحذيرات قواعد العمل', MAPPING_WARNING: 'تحذيرات الربط',
};

const STATUS_LABEL: Record<string, { label: string; color: 'default' | 'success' | 'error' | 'warning' | 'info' }> = {
  UPLOADED: { label: 'بانتظار الربط', color: 'info' }, MAPPED: { label: 'تم الربط', color: 'warning' }, PROCESSING: { label: 'قيد المعالجة', color: 'warning' },
  PROCESSED: { label: 'تمت المعالجة', color: 'success' }, FAILED: { label: 'فشلت', color: 'error' }, REJECTED: { label: 'مرفوض', color: 'error' },
};
export const UploadStatusChip = ({ status }: { status: string }) => (
  <Chip size="small" label={STATUS_LABEL[status]?.label ?? status} color={STATUS_LABEL[status]?.color ?? 'default'} />
);

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 3 }} spacing={2} flexWrap="wrap" useFlexGap>
      <Box>
        <Typography variant="h4" component="h1" color="primary.main">{title}</Typography>
        {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
      </Box>
      <Stack direction="row" spacing={1}>{actions}</Stack>
    </Stack>
  );
}

export const ltr = { direction: 'ltr' as const, unicodeBidi: 'plaintext' as const, textAlign: 'right' as const };
export const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const colLetter = (i: number) => { let s = ''; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
