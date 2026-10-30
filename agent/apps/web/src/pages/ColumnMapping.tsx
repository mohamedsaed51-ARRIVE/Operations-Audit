import { FIELD_KEYS, FIELD_LABELS_AR, REQUIRED_FIELDS, type FieldKey } from '@arrive/shared';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, FormControlLabel, MenuItem, Select, Stack, Switch, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api, type FieldDetection, type MappingOutcome, type ProcessResult, type Sheet, type UploadDetail } from '../api';
import { Async, ErrorAlert, PageTitle, colLetter, ltr, useAsync } from '../components/common';

const DETECTION_CHIP: Record<FieldDetection['status'], { label: string; color: 'success' | 'warning' | 'default' | 'info' }> = {
  CONFIDENT: { label: 'واثق', color: 'success' },
  AMBIGUOUS: { label: 'ملتبس — يلزم اختيارك', color: 'warning' },
  LOW: { label: 'ثقة منخفضة — يلزم تأكيدك', color: 'warning' },
  MISSING: { label: 'غير موجود', color: 'default' },
};

interface SheetState {
  include: boolean;
  fields: Partial<Record<FieldKey, number | ''>>;
  acknowledged: Set<FieldKey>;
}

/** Only CONFIDENT suggestions are pre-selected. Ambiguous / low-confidence fields start empty. */
function initialState(sheet: Sheet): SheetState {
  const fields: SheetState['fields'] = {};
  for (const k of FIELD_KEYS) {
    const d = sheet.detection?.fields[k];
    fields[k] = d && d.status === 'CONFIDENT' && d.suggestedColumn !== null ? d.suggestedColumn : '';
  }
  return { include: sheet.detection !== null && sheet.status !== 'SKIPPED', fields, acknowledged: new Set() };
}

export function ColumnMapping() {
  const { id = '' } = useParams();
  const detail = useAsync(() => api.upload(id), [id]);
  return <Async state={detail}>{(d) => <Editor key={d.upload.id} detail={d} />}</Async>;
}

function Editor({ detail }: { detail: UploadDetail }) {
  const id = detail.upload.id;
  const nav = useNavigate();
  const [state, setState] = useState<Record<number, SheetState>>(() => Object.fromEntries(detail.sheets.map((s) => [s.sheetIndex, initialState(s)])));
  const [result, setResult] = useState<MappingOutcome[] | null>(null);
  const [saved, setSaved] = useState(detail.upload.status === 'MAPPED');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState({ replaceExisting: false, registerUnknownBranches: false, registerUnknownEmployees: false });
  const [processed, setProcessed] = useState<ProcessResult | null>(null);

  const update = (idx: number, fn: (s: SheetState) => SheetState) => { setState((p) => ({ ...p, [idx]: fn(p[idx]!) })); setSaved(false); setResult(null); };

  const payload = () => detail.sheets.map((s) => {
    const st = state[s.sheetIndex]!;
    if (!st.include) return { sheetIndex: s.sheetIndex, include: false, fields: {}, acknowledged: [] };
    const fields: Record<string, number | null> = {};
    for (const k of FIELD_KEYS) fields[k] = st.fields[k] === '' || st.fields[k] === undefined ? null : (st.fields[k] as number);
    return { sheetIndex: s.sheetIndex, include: true, fields, acknowledged: [...st.acknowledged].filter((k) => fields[k] !== null) };
  });

  const run = async (dryRun: boolean) => {
    setBusy(true); setError(null);
    try {
      const r = await api.mapping(id, payload(), dryRun);
      setResult(r.sheets);
      if (!dryRun) setSaved(true);
    } catch (e) {
      setError(e as Error);
      const details = (e as ApiError).details as { sheets?: MappingOutcome[] } | undefined;
      if (details?.sheets) setResult(details.sheets);
    } finally { setBusy(false); }
  };

  const process = async () => {
    setBusy(true); setError(null);
    try { setProcessed(await api.process(id, opts)); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  };

  return (
    <>
      <PageTitle title="ربط الأعمدة" subtitle={`${detail.upload.originalFilename} — تاريخ الجرد ${detail.upload.snapshotDate}`}
        actions={<Button component={Link} to={`/uploads/${id}/preview`} variant="outlined">العودة للمعاينة</Button>} />
      <Alert severity="info" sx={{ mb: 2 }}>
        الاقتراحات التلقائية <b>ليست قرارًا</b>: يُحدَّد مسبقًا فقط ما كان واثقًا. أي عمود ملتبس أو منخفض الثقة يجب اختياره يدويًا وتأكيده صراحةً.
        الحقول المطلوبة: {REQUIRED_FIELDS.map((k) => FIELD_LABELS_AR[k]).join(' · ')}.
      </Alert>

      {detail.sheets.map((sheet) => (
        <SheetCard key={sheet.id} sheet={sheet} st={state[sheet.sheetIndex]!} update={(fn) => update(sheet.sheetIndex, fn)} outcome={result?.find((r) => r.sheetIndex === sheet.sheetIndex)} />
      ))}

      {error && <ErrorAlert error={error} />}
      {result && <Preview result={result} />}

      <Stack direction="row" spacing={2} sx={{ my: 3 }} flexWrap="wrap" useFlexGap>
        <Button variant="outlined" disabled={busy} onClick={() => void run(true)} data-testid="dry-run">تحقق ومعاينة السجلات (دون حفظ)</Button>
        <Button variant="contained" disabled={busy} onClick={() => void run(false)} data-testid="save-mapping">اعتماد الربط</Button>
      </Stack>

      {saved && !processed && (
        <Card sx={{ borderColor: 'secondary.main', borderWidth: 2, borderStyle: 'solid' }}>
          <CardContent>
            <Typography variant="h6">المعالجة وإنشاء الجرد</Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              تتم المعالجة في معاملة واحدة: عند أي فشل لا يُحفظ جرد جزئي. البيانات الأصلية تبقى دون تعديل.
            </Typography>
            <Stack>
              <FormControlLabel control={<Checkbox checked={opts.replaceExisting} onChange={(e) => setOpts({ ...opts, replaceExisting: e.target.checked })} />} label="السماح بإنشاء نسخة جديدة إن وُجد جرد بنفس التاريخ (تبقى النسخة القديمة محفوظة)" />
              <FormControlLabel control={<Checkbox checked={opts.registerUnknownBranches} onChange={(e) => setOpts({ ...opts, registerUnknownBranches: e.target.checked })} />} label="تسجيل أسماء الفروع غير المعروفة في سجل الفروع (مصدر: تسجيل تلقائي من الملف)" />
              <FormControlLabel control={<Checkbox checked={opts.registerUnknownEmployees} onChange={(e) => setOpts({ ...opts, registerUnknownEmployees: e.target.checked })} />} label="تسجيل الموظفين غير المعروفين (غير معتمدين) في سجل الموظفين" />
            </Stack>
            <Button sx={{ mt: 1 }} variant="contained" color="secondary" size="large" disabled={busy} onClick={() => void process()} data-testid="process">معالجة وإنشاء الجرد</Button>
          </CardContent>
        </Card>
      )}

      {processed && (
        <Alert severity="success" data-testid="process-done" action={
          <Stack direction="row" spacing={1}>
            <Button color="inherit" onClick={() => nav(`/uploads/${id}/quality`)}>نتائج جودة البيانات</Button>
            <Button color="inherit" onClick={() => nav(`/snapshots/${processed.snapshotId}/comparison`)}>مقارنة الجرد</Button>
          </Stack>}>
          تم إنشاء الجرد بتاريخ {processed.snapshotDate} (النسخة {processed.version}): {processed.stats.ingestedRows} صفًا مُدرجًا،
          {' '}{processed.stats.rejectedRows} مرفوضًا، {processed.stats.emptyRows} فارغًا، {processed.stats.duplicateRows} مكررًا.
        </Alert>
      )}
    </>
  );
}

function SheetCard({ sheet, st, update, outcome }: { sheet: Sheet; st: SheetState; update: (fn: (s: SheetState) => SheetState) => void; outcome?: MappingOutcome }) {
  const headers = sheet.detection?.headers ?? [];
  const optionLabel = (i: number) => `${colLetter(i)} — ${headers[i] || '(بدون عنوان)'}`;
  return (
    <Card sx={{ mb: 2, opacity: st.include ? 1 : 0.65 }} data-testid={`sheet-${sheet.sheetIndex}`}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap">
          <Box>
            <Typography variant="h6">الورقة: {sheet.name}</Typography>
            <Typography variant="caption" color="text.secondary">{sheet.rowCount} صفًا · {sheet.detection ? `صف العناوين ${sheet.firstExcelRow + (sheet.headerRowIndex ?? 0)}` : 'لم يُكتشف صف عناوين'}</Typography>
          </Box>
          <FormControlLabel control={<Switch checked={st.include} disabled={!sheet.detection} onChange={(e) => update((s) => ({ ...s, include: e.target.checked }))} />} label="ورقة جرد (تُدرج في الجرد)" />
        </Stack>
        {st.include && sheet.detection && (
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead><TableRow><TableCell>الحقل</TableCell><TableCell>نتيجة الكشف</TableCell><TableCell sx={{ minWidth: 240 }}>العمود</TableCell><TableCell>تأكيد</TableCell><TableCell>المرشحون</TableCell></TableRow></TableHead>
            <TableBody>
              {FIELD_KEYS.map((k) => {
                const d = sheet.detection!.fields[k];
                const value = st.fields[k] ?? '';
                const needsAck = d.status !== 'CONFIDENT' && value !== '';
                const required = REQUIRED_FIELDS.includes(k);
                return (
                  <TableRow key={k}>
                    <TableCell>{FIELD_LABELS_AR[k]}{required && <b style={{ color: '#B91C1C' }}> *</b>}</TableCell>
                    <TableCell><Chip size="small" color={DETECTION_CHIP[d.status].color} label={DETECTION_CHIP[d.status].label} /></TableCell>
                    <TableCell>
                      <Select size="small" fullWidth displayEmpty value={value} inputProps={{ 'data-testid': `select-${sheet.sheetIndex}-${k}` }}
                        onChange={(e) => update((s) => {
                          const v = e.target.value === '' ? '' : Number(e.target.value);
                          const ack = new Set(s.acknowledged);
                          ack.delete(k);
                          return { ...s, fields: { ...s.fields, [k]: v }, acknowledged: ack };
                        })}>
                        <MenuItem value=""><em>— غير مربوط —</em></MenuItem>
                        {headers.map((_, i) => <MenuItem key={i} value={i}>{optionLabel(i)}</MenuItem>)}
                      </Select>
                    </TableCell>
                    <TableCell>
                      {needsAck && (
                        <FormControlLabel label="أؤكد" control={<Checkbox size="small" checked={st.acknowledged.has(k)} inputProps={{ 'aria-label': `confirm-${sheet.sheetIndex}-${k}` }}
                          onChange={(e) => update((s) => { const a = new Set(s.acknowledged); if (e.target.checked) a.add(k); else a.delete(k); return { ...s, acknowledged: a }; })} />} />
                      )}
                    </TableCell>
                    <TableCell sx={{ ...ltr, fontSize: 12, color: 'text.secondary' }}>
                      {d.candidates.map((c) => `${colLetter(c.columnIndex)}:${c.header || '∅'} (${c.score})`).join(' | ')}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {outcome && outcome.included && (
          <Box sx={{ mt: 1 }}>
            {outcome.errors.map((e, i) => <Alert key={i} severity="error" sx={{ mt: 0.5 }}>{FIELD_LABELS_AR[e.field as FieldKey] ?? e.field}: {e.explanation}</Alert>)}
            {outcome.warnings.filter((w) => w.severity !== 'INFO').map((w, i) => <Alert key={i} severity="warning" sx={{ mt: 0.5 }}>{FIELD_LABELS_AR[w.field as FieldKey] ?? w.field}: {w.explanation}</Alert>)}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function Preview({ result }: { result: MappingOutcome[] }) {
  const sheets = result.filter((r) => r.included && r.normalizedPreview.length > 0);
  if (sheets.length === 0) return null;
  return (
    <>
      {sheets.map((s) => (
        <Card key={s.sheetIndex} sx={{ mb: 2 }} data-testid="normalized-preview">
          <CardContent>
            <Typography variant="h6">معاينة السجلات بعد التطبيع — {s.sheetName}</Typography>
            <Typography variant="caption" color="text.secondary">أول {s.normalizedPreview.length} سجلات (لم يُحفظ شيء بعد)</Typography>
            <Table size="small" sx={{ mt: 1 }}>
              <TableHead><TableRow>{['صف', 'رقم الشحنة', 'الحالة', 'الفرع', 'الموظف', 'تاريخ الإنشاء', 'العمر (يوم)', 'الفئة'].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {s.normalizedPreview.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{String(r.rowNumber)}</TableCell><TableCell sx={ltr}>{String(r.trackingNumber)}</TableCell><TableCell>{String(r.statusRaw ?? '—')}</TableCell>
                    <TableCell>{String(r.branchRaw ?? '—')}</TableCell><TableCell>{r.employeeMissing ? <Chip size="small" color="warning" label="بدون عهدة" /> : String(r.employeeRaw ?? '—')}</TableCell>
                    <TableCell sx={ltr}>{String(r.createdDate ?? '—')}</TableCell><TableCell>{r.shipmentAgeDays === null ? '—' : String(r.shipmentAgeDays)}</TableCell><TableCell sx={ltr}>{String(r.ageCategory ?? '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {s.previewIssues.filter((i) => i.severity !== 'INFO').length > 0 && (
              <Alert severity="warning" sx={{ mt: 1 }}>ملاحظات على هذه السجلات: {s.previewIssues.filter((i) => i.severity !== 'INFO').map((i) => `${i.code} (صف ${i.rowNumber})`).join(' · ')}</Alert>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
