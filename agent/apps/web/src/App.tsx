import { AppBar, Box, Chip, Container, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { useAsync } from './components/common';
import { ColumnMapping } from './pages/ColumnMapping';
import { DataQuality } from './pages/DataQuality';
import { FilePreview } from './pages/FilePreview';
import { SnapshotComparison } from './pages/SnapshotComparison';
import { SnapshotHistory } from './pages/SnapshotHistory';
import { UploadCenter } from './pages/UploadCenter';

const NAV = [
  { to: '/', label: 'مركز الرفع' },
  { to: '/snapshots', label: 'سجل الجرد' },
];

export function App() {
  const { pathname } = useLocation();
  const health = useAsync(() => api.health(), []);
  const tab = pathname.startsWith('/snapshots') ? '/snapshots' : '/';
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: '#0F172A', borderBottom: '3px solid #00C7E6' }}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap' }}>
          <Box component={Link} to="/" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, textDecoration: 'none', color: 'inherit' }}>
            <Box component="img" src="/arrive-logo.png" alt="ARRIVE" sx={{ height: 34, bgcolor: '#fff', borderRadius: 1, px: 0.75, py: 0.25 }} />
            <Box>
              <Typography fontWeight={800} lineHeight={1.2}>منصة تدقيق المخزون</Typography>
              <Typography variant="caption" sx={{ opacity: 0.75 }}>المرحلة 2 — الاستيعاب ومقارنة الجرد اليومي</Typography>
            </Box>
          </Box>
          <Tabs value={tab} textColor="inherit" indicatorColor="secondary" sx={{ ms: 'auto' }}>
            {NAV.map((n) => <Tab key={n.to} value={n.to} label={n.label} component={Link} to={n.to} />)}
          </Tabs>
          <Chip
            size="small"
            label={health.data ? 'الخادم متصل' : health.loading ? '…' : 'الخادم غير متاح'}
            color={health.data ? 'success' : health.loading ? 'default' : 'error'}
          />
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Routes>
          <Route path="/" element={<UploadCenter />} />
          <Route path="/uploads/:id/preview" element={<FilePreview />} />
          <Route path="/uploads/:id/mapping" element={<ColumnMapping />} />
          <Route path="/uploads/:id/quality" element={<DataQuality />} />
          <Route path="/snapshots" element={<SnapshotHistory />} />
          <Route path="/snapshots/:id/comparison" element={<SnapshotComparison />} />
          <Route path="*" element={<Typography>الصفحة غير موجودة.</Typography>} />
        </Routes>
      </Container>
    </Box>
  );
}
