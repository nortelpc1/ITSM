export function fmtDate(v, withTime = true) {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString(undefined, withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ago(v) {
  if (!v) return '';
  const s = (Date.now() - new Date(v)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function duration(minutes) {
  const m = Math.abs(Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 60 * 48) return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} m` : ''}`.trim();
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

export const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
export const fileSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
