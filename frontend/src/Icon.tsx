type IconName = 'eye' | 'eye-off' | 'upload' | 'image' | 'trash' | 'search' | 'print' | 'alert' | 'refresh' | 'lock' | 'close' | 'check' | 'menu' | 'home' | 'arrow-right';
const paths: Record<IconName, string> = {
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  'eye-off': 'm3 3 18 18M10.6 5.1A13 13 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1M6.1 6.1A19 19 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.1-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'm3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10',
  'arrow-right': 'M4 12h16m-6-6 6 6-6 6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  image: 'M3 3h18v18H3zM3 16l5-5 5 5 3-3 5 5M15 8h.01',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  print: 'M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6zM17 12h.01',
  alert: 'M12 3 2 21h20L12 3zM12 9v5m0 3h.01',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15',
  lock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4M12 14v3',
  close: 'm6 6 12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
};
export default function Icon({ name }: { name: IconName }) {
  return <svg className="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
