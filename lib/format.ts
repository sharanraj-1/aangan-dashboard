// Formatting helpers (all times rendered in IST).

const TZ = 'Asia/Kolkata';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatInr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** ₹12.4 L / ₹1.20 Cr — the units the studio actually talks in. */
export function formatLakhCr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `₹${(n / 100_000).toFixed(abs >= 1_000_000 ? 1 : 2)} L`;
  return formatInr(n);
}

export function formatRange(low: number | null, high: number | null): string {
  if (low === null && high === null) return '—';
  if (low === null || high === null || low === high) return formatLakhCr(low ?? high);
  return `${formatLakhCr(low)} – ${formatLakhCr(high)}`;
}

const dtFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' });
const longDateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });

export const formatDateTime = (iso: string | Date | null | undefined) => (iso ? dtFmt.format(new Date(iso)).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase()) : '—');
export const formatDate = (iso: string | Date | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatLongDate = (d: Date) => longDateFmt.format(d);
export const formatTime = (d: Date) => timeFmt.format(d).replace(/\b(am|pm)\b/i, (m) => m.toLowerCase());

/** Minutes → "17 min", "4.2 h", "3.8 d". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  if (minutes < 1) return '<1 min';
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
export const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
