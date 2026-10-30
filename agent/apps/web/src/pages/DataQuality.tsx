import { Alert, Box, Button, Card, CardContent, Chip, MenuItem, Pagination, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Async, CATEGORY_LABEL, PageTitle, SeverityChip, UploadStatusChip, ltr, useAsync } from '../components/common';

export function DataQuality() {
  const { id = '' } = useParams();
  const detail = useAsync(() => api.upload(id), [id]);
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [code, setCode] = useState('');
  const [page, setPage] = useState(1);
  const issues = useAsync(() => api.issues(id, { category, severity, code, page, pageSize: 25 }), [id, category, severity, code, page]);

  return (
    <Async state={detail}>
      {(d) => {
        const total = (cat: string, sev?: string) => d.issueSummary.byCategory.filter((c) => c.category === cat && (!sev || c.severity === sev)).reduce((s, c) => s + c.n, 0);
        return (
          <>
            <PageTitle title="نتائج جودة البيانات" subtitle={d.upload.originalFilename}
              actions={<>
                <Button component={Link} to="/" variant="outlined">رجوع</Button>
                {d.snapshot && <Button component={Link} to={`/snapshots/${d.snapshot.id}/comparison`} variant="contained">مقارنة الجرد اليومي</Button>}
              </>} />
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}><UploadStatusChip status={d.upload.status} /><Chip size="small" label={`تاريخ الجرد: ${d.upload.snapshotDate}`} /></Stack>
            {d.upload.failureReason && <Alert severity="error" sx={{ mb: 2 }}>{d.upload.failureReason}</Alert>}
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' }, mb: 3 }}>
              {Object.entries(CATEGORY_LABEL).map(([cat, label]) => (
                <Card key={cat} onClick={() => { setCategory(category === cat ? '' : cat); setPage(1); }} sx={{ cursor: 'pointer', outline: category === cat ? '2px solid #0837C9' : 'none' }} data-testid={`cat-${cat}`}>
                  <CardContent>
                    <Typography color="text.secondary">{label}</Typography>
                    <Typography variant="h4">{total(cat)}</Typography>
                    <Typography variant="caption">أخطاء {total(cat, 'ERROR')} · تحذيرات {total(cat, 'WARNING')} · معلومات {total(cat, 'INFO')}</Typography>
                  </CardContent>
                </Card>
              ))}
            </Box>
            <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
              <Select size="small" displayEmpty value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} sx={{ minWidth: 160 }}>
                <MenuItem value=""><em>كل درجات الخطورة</em></MenuItem><MenuItem value="ERROR">خطأ</MenuItem><MenuItem value="WARNING">تحذير</MenuItem><MenuItem value="INFO">معلومة</MenuItem>
              </Select>
              <Select size="small" displayEmpty value={code} onChange={(e) => { setCode(e.target.value); setPage(1); }} sx={{ minWidth: 260 }}>
                <MenuItem value=""><em>كل أنواع المشكلات</em></MenuItem>
                {d.issueSummary.byCode.map((c) => <MenuItem key={c.code} value={c.code}><span dir="ltr">{c.code} ({c.n})</span></MenuItem>)}
              </Select>
              {(category || severity || code) && <Button onClick={() => { setCategory(''); setSeverity(''); setCode(''); setPage(1); }}>مسح الفلاتر</Button>}
            </Stack>
            <Async state={issues}>
              {(p) => (
                <Card>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>{['رقم المشكلة', 'الورقة', 'صف إكسل', 'الحقل', 'القيمة الأصلية', 'التصنيف', 'الخطورة', 'الشرح', 'التصحيح المقترح'].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow>
                      </TableHead>
                      <TableBody>
                        {p.data.length === 0 && <TableRow><TableCell colSpan={9} align="center">لا توجد مشكلات مطابقة.</TableCell></TableRow>}
                        {p.data.map((i) => (
                          <TableRow key={i.issueId} hover>
                            <TableCell sx={ltr}>{i.issueId}</TableCell>
                            <TableCell>{i.worksheet ?? '—'}</TableCell>
                            <TableCell>{i.rowNumber ?? '—'}</TableCell>
                            <TableCell sx={ltr}>{i.field ?? '—'}</TableCell>
                            <TableCell sx={ltr}>{i.originalValue ?? <span style={{ color: '#94A3B8' }}>∅</span>}</TableCell>
                            <TableCell><Chip size="small" variant="outlined" label={CATEGORY_LABEL[i.category] ?? i.category} /> <Box component="span" sx={{ ...ltr, fontSize: 11, display: 'block', color: 'text.secondary' }}>{i.code}</Box></TableCell>
                            <TableCell><SeverityChip severity={i.severity} /></TableCell>
                            <TableCell sx={{ minWidth: 260 }}>{i.explanation}</TableCell>
                            <TableCell sx={{ minWidth: 200 }}>{i.suggestion}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption">الإجمالي: {p.pagination.total}</Typography>
                    <Pagination count={p.pagination.totalPages} page={page} onChange={(_, v) => setPage(v)} />
                  </Box>
                </Card>
              )}
            </Async>
          </>
        );
      }}
    </Async>
  );
}
