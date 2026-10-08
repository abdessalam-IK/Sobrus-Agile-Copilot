// Calendrier de travail : dates ISO (YYYY-MM-DD), jours ouvrés, jours fériés.

export const toDate = (s) => new Date(`${s}T00:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);

export function addDays(s, n) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function isWeekend(s) {
  const day = toDate(s).getUTCDay();
  return day === 0 || day === 6;
}

/** Jours ouvrés entre start et end inclus. */
export function workingDays(start, end, holidays = []) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!isWeekend(d) && !holidays.includes(d)) out.push(d);
  }
  return out;
}

/** Nombre de jours ouvrés strictement après `a`, jusqu'à `b` inclus. */
export function workingDaysBetween(a, b, holidays = []) {
  if (!a || !b || b <= a) return 0;
  return workingDays(addDays(a, 1), b, holidays).length;
}

export const clampDate = (d, min, max) => (d < min ? min : d > max ? max : d);

export function formatDate(s) {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
