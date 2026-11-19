// Fuseau horaire unique du Copilot (dates locales, heures affichées).
// Réglable via COPILOT_TZ dans .env : les bases d'heure de Node, de Windows et du navigateur
// peuvent diverger pour le Maroc, ce réglage garantit que tout le Copilot parle de la même heure.
const cache = new Map();

/** Fuseau en vigueur (lu à chaque appel : .env peut être chargé après l'import des modules). */
export const timeZone = () => process.env.COPILOT_TZ || 'Africa/Casablanca';

/** Formateur Intl mis en cache par fuseau et par options. */
export function fmt(locale, options) {
  const key = `${timeZone()}|${locale}|${JSON.stringify(options)}`;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(locale, { ...options, timeZone: timeZone() }));
  return cache.get(key);
}

/** Décalage du fuseau par rapport à UTC, en minutes, à une date donnée (selon les données de Node). */
export function offsetMinutes(date = new Date()) {
  const p = Object.fromEntries(fmt('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60e3) * 60e3) / 60e3);
}
