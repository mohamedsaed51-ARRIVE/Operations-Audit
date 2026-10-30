import { AGE_CATEGORY_LABELS_AR, CHANGE_TYPES, CHANGE_TYPE_LABELS_AR, STATUS_AGE_UNKNOWN_LABEL, type AgeCategory, type ChangeType } from '@arrive/shared';
import { Alert, Box, Button, Card, CardContent, Chip, Pagination, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Comparison } from '../api';
import { Async, PageTitle, ltr, useAsync } from '../components/common';

const COUNT_KEY: Record<ChangeType, keyof Comparison> = {
  NEW: 'newCount', CONTINUED: 'continuedCount', STATUS_CHANGED: 'statusChangedCount', BRANCH_CHANGED: 'branchChangedCount',
  EMPLOYEE_CHANGED: 'employeeChangedCount', DISAPPEARED: 'disappearedCount', REAPPEARED: 'reappearedCount',
};
const BASIS_LABEL: Record<string, string> = {
  STATUS_ENTRY_DATE: 'من تاريخ دخول الحالة في الملف', OBSERVED_SNAPSHOTS: 'مدة ملاحَظة بين الجردات (حد أدنى)', UNKNOWN_INSUFFICIENT_HISTORY: STATUS_AGE_UNKNOWN_LABEL,
};

export function SnapshotComparison() {
  const { id = '' } = useParams();
  const summary = useAsync(() => api.summary(id), [id]);
  const [type, setType] = useState<ChangeType | undefined>(undefined);
  const [page, setPage] = useState(1);
  const cmp = useAsync(() => api.comparison(id, type, page), [id, type, page]);

  return (
    <>
      <PageTitle title="مقارنة الجرد اليومي" subtitle="مقارنة الجرد الحالي بآخر جرد صالح سابق عبر رقم الشحنة" actions={<Button component={Link} to="/snapshots" variant="outlined">سجل الجرد</Button>} />
      <Async state={summary}>
        {(s) => (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6">ملخص جرد {s.snapshot.snapshotDate} (النسخة {s.snapshot.version})</Typography>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(6, 1fr)' }, my: 2 }}>
                {[
                  ['شحنات فريدة', s.totals.uniqueShipments], ['أكثر من 15 يومًا', s.totals.overMaxAge], ['أكثر من 25 يومًا (حرجة)', s.totals.overCriticalAge],
                  ['عمر غير قابل للحساب', s.totals.ageUnknown], ['بدون عهدة (موظف)', s.totals.missingEmployee], ['عمر الحالة غير معروف', s.totals.statusAgeUnknown],
                ].map(([label, v]) => (
                  <Box key={String(label)} sx={{ p: 1.5, bgcolor: '#F1F5F9', borderRadius: 2 }}>
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                    <Typography variant="h5" data-testid={`kpi-${label}`}>{v}</Typography>
                  </Box>
                ))}
              </Box>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
                <Box>
                  <Typography fontWeight={700}>توزيع عمر الشحنة (تاريخ الجرد − تاريخ الإنشاء)</Typography>
                  <Table size="small"><TableBody>
                    {(Object.keys(AGE_CATEGORY_LABELS_AR) as AgeCategory[]).map((c) => (
                      <TableRow key={c}><TableCell>{AGE_CATEGORY_LABELS_AR[c]}</TableCell><TableCell>{s.byAgeCategory.find((x) => x.ageCategory === c)?.n ?? 0}</TableCell></TableRow>
                    ))}
                    <TableRow><TableCell>بدون عمر (تاريخ ناقص/غير صالح)</TableCell><TableCell>{s.byAgeCategory.find((x) => x.ageCategory === null)?.n ?? 0}</TableCell></TableRow>
                  </TableBody></Table>
                </Box>
                <Box>
                  <Typography fontWeight={700}>أساس حساب عمر الحالة الحالية</Typography>
                  <Table size="small"><TableBody>
                    {s.byStatusAgeBasis.map((b) => <TableRow key={b.basis}><TableCell sx={b.basis.startsWith('UNKNOWN') ? ltr : undefined}>{BASIS_LABEL[b.basis] ?? b.basis}</TableCell><TableCell>{b.n}</TableCell></TableRow>)}
                  </TableBody></Table>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Async>

      <Async state={cmp}>
        {(c) => (
          <>
            {c.comparison.mode === 'BASELINE' && <Alert severity="info" sx={{ mb: 2 }}>هذا أول جرد صالح؛ لا توجد مقارنة. عمر الحالة الحالية غير معروف حتى الجرد التالي.</Alert>}
            {c.comparison.warnings.filter((w) => w.code !== 'NO_PREVIOUS_SNAPSHOT').map((w) => <Alert key={w.code} severity="warning" sx={{ mb: 2 }} data-testid="cmp-warning">{w.message}</Alert>)}
            {c.comparison.mode !== 'BASELINE' && (
              <>
                <Typography sx={{ mb: 1 }}>مقارنة مع جرد <b dir="ltr">{c.comparison.previousSnapshotDate}</b>{c.comparison.daysBetween ? ` (بفارق ${c.comparison.daysBetween} يوم)` : ''}</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                  <Chip label="الكل" color={type ? 'default' : 'primary'} onClick={() => { setType(undefined); setPage(1); }} />
                  {CHANGE_TYPES.map((t) => (
                    <Chip key={t} data-testid={`chip-${t}`} color={type === t ? 'primary' : 'default'} variant={type === t ? 'filled' : 'outlined'}
                      label={`${CHANGE_TYPE_LABELS_AR[t]}: ${c.comparison[COUNT_KEY[t]] as number}`} onClick={() => { setType(type === t ? undefined : t); setPage(1); }} />
                  ))}
                </Stack>
                <Alert severity="info" sx={{ mb: 2 }}>الشحنة «المختفية» لا تعني أنها سُلّمت، وتغيّر الحالة لا يعني إجراءً ناجحًا؛ لا تُستنتج نتيجة نهائية دون دليل.</Alert>
                <Card>
                  <Table size="small">
                    <TableHead><TableRow>{['رقم الشحنة', 'التغيّر', 'الحالة (قبل ← بعد)', 'الفرع (قبل ← بعد)', 'الموظف (قبل ← بعد)', 'آخر ظهور سابق'].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
                    <TableBody>
                      {c.items.data.length === 0 && <TableRow><TableCell colSpan={6} align="center">لا توجد عناصر.</TableCell></TableRow>}
                      {c.items.data.map((i) => (
                        <TableRow key={i.trackingNumber} hover>
                          <TableCell sx={ltr}>{i.trackingNumber}</TableCell>
                          <TableCell>{i.changeTypes.filter((t) => t !== 'CONTINUED' || i.changeTypes.length === 1).map((t) => <Chip key={t} size="small" sx={{ me: 0.5 }} label={CHANGE_TYPE_LABELS_AR[t as ChangeType] ?? t} />)}</TableCell>
                          <TableCell>{ba(i.prevStatusRaw, i.currStatusRaw)}</TableCell>
                          <TableCell>{ba(i.prevBranchRaw, i.currBranchRaw)}</TableCell>
                          <TableCell>{ba(i.prevEmployeeRaw, i.currEmployeeRaw)}</TableCell>
                          <TableCell sx={ltr}>{i.lastSeenDate ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}><Pagination count={c.items.pagination.totalPages} page={page} onChange={(_, v) => setPage(v)} /></Box>
                </Card>
              </>
            )}
          </>
        )}
      </Async>
    </>
  );
}

function ba(a: string | null, b: string | null) {
  const f = (v: string | null) => v ?? '∅';
  return a === b ? f(b) : <span>{f(a)} ← <b>{f(b)}</b></span>;
}
