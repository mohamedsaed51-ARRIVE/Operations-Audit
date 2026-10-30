import { Card, Chip, Link as MuiLink, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Async, PageTitle, fmtBytes, ltr, useAsync } from '../components/common';

const MODE: Record<string, string> = { BASELINE: 'أول جرد (بدون مقارنة)', COMPARED: 'تمت المقارنة', INVALID: 'مقارنة غير صالحة' };

export function SnapshotHistory() {
  const list = useAsync(() => api.snapshots(1), []);
  return (
    <>
      <PageTitle title="سجل الجرد" subtitle="كل جرد يومي صالح يُحفظ كنسخة مستقلة ولا يُستبدل. عند إعادة رفع نفس التاريخ تُنشأ نسخة جديدة وتبقى القديمة." />
      <Async state={list}>
        {(d) => (
          <Card>
            <Table size="small">
              <TableHead><TableRow>{['تاريخ الجرد', 'النسخة', 'الحالة', 'الملف', 'صفوف الملف', 'مُدرجة', 'مرفوضة', 'فارغة', 'مكررة', 'المقارنة', 'إجراء'].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {d.data.length === 0 && <TableRow><TableCell colSpan={11} align="center">لا توجد جردات محفوظة بعد.</TableCell></TableRow>}
                {d.data.map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell sx={ltr}>{s.snapshotDate}</TableCell>
                    <TableCell>{s.version}</TableCell>
                    <TableCell>{s.isActive ? <Chip size="small" color="success" label="النسخة المعتمدة" /> : <Chip size="small" label="نسخة سابقة" />}</TableCell>
                    <TableCell sx={ltr}>{s.originalFilename}</TableCell>
                    <TableCell>{s.totalRows}</TableCell><TableCell>{s.ingestedRows}</TableCell><TableCell>{s.rejectedRows}</TableCell><TableCell>{s.emptyRows}</TableCell><TableCell>{s.duplicateRows}</TableCell>
                    <TableCell>{MODE[s.comparisonMode ?? ''] ?? '—'}</TableCell>
                    <TableCell><MuiLink component={Link} to={`/snapshots/${s.id}/comparison`}>المقارنة والملخص</MuiLink></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </Async>
      <span hidden>{fmtBytes(0)}</span>
    </>
  );
}
