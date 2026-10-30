import { Alert, Box, Button, Card, CardContent, Chip, Link as MuiLink, Pagination, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import { Async, ErrorAlert, PageTitle, UploadStatusChip, fmtBytes, ltr, useAsync } from '../components/common';

const todayLocal = () => new Date().toISOString().slice(0, 10);

export function UploadCenter() {
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.uploads(page), [page]);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createUpload(file, date);
      nav(`/uploads/${res.upload.id}/preview`);
    } catch (e) {
      setError(e as Error);
      list.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title="مركز الرفع" subtitle="ارفع ملف الجرد اليومي (XLSX / XLS / CSV)، ثم راجع المعاينة وأكّد ربط الأعمدة قبل المعالجة." />
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
            <Button variant="outlined" component="label" sx={{ minWidth: 220 }}>
              {file ? file.name : 'اختيار ملف الجرد'}
              <input hidden type="file" accept=".xlsx,.xls,.csv" data-testid="file-input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Button>
            <TextField
              type="date" label="تاريخ الجرد (snapshot_date)" value={date} onChange={(e) => setDate(e.target.value)}
              InputLabelProps={{ shrink: true }} size="small" sx={{ minWidth: 220 }} inputProps={{ 'data-testid': 'snapshot-date' }}
              helperText="يُستخدم كتاريخ مرجعي لحساب العمر"
            />
            <Button variant="contained" size="large" disabled={!file || busy || !date} onClick={() => void submit()} data-testid="upload-btn">
              {busy ? 'جارٍ الرفع…' : 'رفع وفحص الملف'}
            </Button>
          </Stack>
          {file && <Typography variant="caption" color="text.secondary">{fmtBytes(file.size)}</Typography>}
          {error && <RejectionDetails error={error} />}
        </CardContent>
      </Card>

      <Typography variant="h6" sx={{ mb: 1 }}>سجل الرفع</Typography>
      <Async state={list}>
        {(d) => (
          <Card>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>الملف</TableCell><TableCell>تاريخ الجرد</TableCell><TableCell>الحالة</TableCell><TableCell>الحجم</TableCell>
                  <TableCell>أخطاء</TableCell><TableCell>تاريخ الرفع</TableCell><TableCell>إجراء</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {d.data.length === 0 && <TableRow><TableCell colSpan={7} align="center">لا توجد عمليات رفع بعد.</TableCell></TableRow>}
                {d.data.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell sx={ltr}>{u.originalFilename}</TableCell>
                    <TableCell sx={ltr}>{u.snapshotDate}</TableCell>
                    <TableCell><UploadStatusChip status={u.status} /></TableCell>
                    <TableCell sx={ltr}>{fmtBytes(u.sizeBytes)}</TableCell>
                    <TableCell>{u.errorCount ? <Chip size="small" color="error" label={u.errorCount} /> : '—'}</TableCell>
                    <TableCell sx={ltr}>{new Date(u.createdAt).toLocaleString('en-GB')}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1.5}>
                        {u.status !== 'REJECTED' && <MuiLink component={Link} to={`/uploads/${u.id}/preview`}>معاينة</MuiLink>}
                        {['UPLOADED', 'MAPPED', 'FAILED'].includes(u.status) && <MuiLink component={Link} to={`/uploads/${u.id}/mapping`}>ربط الأعمدة</MuiLink>}
                        <MuiLink component={Link} to={`/uploads/${u.id}/quality`}>جودة البيانات</MuiLink>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {d.pagination.totalPages > 1 && <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}><Pagination count={d.pagination.totalPages} page={page} onChange={(_, p) => setPage(p)} /></Box>}
          </Card>
        )}
      </Async>
    </>
  );
}

function RejectionDetails({ error }: { error: Error }) {
  const e = error as ApiError;
  const issues = (e.details as { issues?: { code: string; explanation: string; suggestion: string }[] } | undefined)?.issues;
  if (!issues) return <ErrorAlert error={error} />;
  return (
    <Alert severity="error" sx={{ mt: 2 }} data-testid="rejection">
      <Typography fontWeight={700}>رُفض الملف ولم يُنشأ أي جرد</Typography>
      {issues.map((i) => (
        <Typography key={i.code} variant="body2">• {i.explanation} <b>{i.suggestion}</b> <span dir="ltr">({i.code})</span></Typography>
      ))}
    </Alert>
  );
}
