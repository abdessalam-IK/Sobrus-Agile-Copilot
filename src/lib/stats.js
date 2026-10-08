export const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);

export const mean = (arr) => (arr.length ? sum(arr) / arr.length : null);

export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Pente de la régression linéaire (x = 0..n-1). */
export function slope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(values);
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return den ? num / den : 0;
}

/** Générateur pseudo-aléatoire déterministe (simulations reproductibles). */
export function seededRandom(seed = 42) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
export const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
