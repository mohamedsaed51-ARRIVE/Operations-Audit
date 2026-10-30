import { createTheme } from '@mui/material/styles';

/** ARRIVE brand: blue #0837C9, turquoise #00C7E6, navy #0F172A. Independent from the legacy dashboards. */
export const theme = createTheme({
  direction: 'rtl',
  palette: {
    primary: { main: '#0837C9', dark: '#062BA0', contrastText: '#fff' },
    secondary: { main: '#00C7E6', dark: '#00A9C4', contrastText: '#0F172A' },
    text: { primary: '#0F172A', secondary: '#475569' },
    background: { default: '#F4F8FD', paper: '#ffffff' },
    success: { main: '#15803D' },
    warning: { main: '#B45309' },
    error: { main: '#B91C1C' },
    divider: '#E2E8F0',
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Cairo", "Segoe UI", Tahoma, Arial, sans-serif',
    h4: { fontWeight: 800 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { fontWeight: 700, textTransform: 'none' },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 700, backgroundColor: '#F1F5F9', whiteSpace: 'nowrap' } } },
  },
});
