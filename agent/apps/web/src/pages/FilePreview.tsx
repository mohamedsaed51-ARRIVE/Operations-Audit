import { Alert, Box, Button, Card, CardContent, Chip, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography } from '@mui/material';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Async, PageTitle, UploadStatusChip, colLetter, ltr, useAsync } from '../components/common';

export function FilePreview() {
  const { id = '' } = useParams();
  const detail = useAsync(() => api.upload(id), [id]);
  const [sheet, setSheet] = useState(0);
  const preview = useAsync(() => api.preview(id, sheet, 20), [id, sheet]);

  return (
    <Async state={detail}>
      {(d) => (
        <>
          <PageTitle
            title="معاينة الملف"
            subtitle={d.upload.originalFilename}
            actions={<>
              <Button component={Link} to="/" variant="outlined">رجوع</Button>
              {['UPLOADED', 'MAPPED', 'FAILED'].includes(d.upload.status) && <Button component={Link} to={`/uploads/${id}/mapping`} variant="contained" data-testid="go-mapping">الانتقال إلى ربط الأعمدة</Button>}
            </>}
          />
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <UploadStatusChip status={d.upload.status} />
            <Chip size="small" label={`تاريخ الجرد: ${d.upload.snapshotDate}`} />
            <Chip size="small" label={`النوع: ${d.upload.fileType?.toUpperCase()}`} />
            <Chip size="small" label={`${d.sheets.length} ورقة`} />
          </Stack>
          {d.issueSummary.byCode.length > 0 && (
            <Alert severity={d.issueSummary.byCode.some((c) => c.severity === 'ERROR') ? 'error' : 'info'} sx={{ mb: 2 }}>
              ملاحظات الفحص الأولي: {d.issueSummary.byCode.map((c) => `${c.code} ×${c.n}`).join(' · ')}
            </Alert>
          )}
          <Tabs value={sheet} onChange={(_, v: number) => setSheet(v)} variant="scrollable" sx={{ mb: 2 }}>
            {d.sheets.map((s) => <Tab key={s.id} value={s.sheetIndex} label={`${s.name} (${s.rowCount})${s.hidden ? ' · مخفية' : ''}`} />)}
          </Tabs>
          <Async state={preview}>
            {(p) => (
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    صف العناوين المكتشف: {p.sheet.headerRowIndex === null ? 'غير موجود' : `صف إكسل رقم ${p.sheet.firstExcelRow + p.sheet.headerRowIndex}`} · أول {p.rows.length} سجلات
                  </Typography>
                  {p.maskedColumns.length > 0 && <Alert severity="info" sx={{ mb: 1 }}>{p.note}</Alert>}
                  <TableContainer sx={{ maxHeight: 520 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>#</TableCell>
                          {p.headers.map((h, i) => (
                            <TableCell key={i}>
                              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>{colLetter(i)}</Box> {h || '—'}
                              {p.maskedColumns.includes(i) && <Chip size="small" label="محجوب" sx={{ ms: 0.5 }} />}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {p.rows.map((r) => (
                          <TableRow key={r.rowNumber} hover>
                            <TableCell sx={{ color: 'text.secondary' }}>{r.rowNumber}</TableCell>
                            {r.cells.map((c, i) => <TableCell key={i} sx={ltr}>{c ?? <span style={{ color: '#94A3B8' }}>∅</span>}</TableCell>)}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            )}
          </Async>
        </>
      )}
    </Async>
  );
}
