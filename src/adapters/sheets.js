// Lecture des exports CSV du Google Sheet « Taux d'Occupation Sobrus » (Apps Script).
// On en tire : la liste des développeurs, les congés / absences, les jours fériés,
// et les heures de réunion par sprint (pour le focus time).
// Les fichiers restent dans data/private/Sheets (jamais versionnés).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Lit un onglet : saute les lignes de titre jusqu'à la ligne d'en-tête qui contient `firstHeader`. */
function readTab(dir, suffix, firstHeader) {
  const file = readdirSync(dir).find((f) => f.endsWith(`${suffix}.csv`));
  if (!file) return [];
  const rows = parseCsv(readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, ''));
  const h = rows.findIndex((r) => r[0]?.trim() === firstHeader);
  if (h < 0) return [];
  const header = rows[h].map((x) => x.trim());
  const out = [];
  for (const r of rows.slice(h + 1)) {
    if (!r[0]?.trim()) break; // fin du tableau
    out.push(Object.fromEntries(header.map((k, i) => [k, (r[i] ?? '').trim()])));
  }
  return out;
}

const num = (s) => Number(String(s || '0').replace(',', '.')) || 0;
const isoDate = (s) => (/^\d{2}\/\d{2}\/\d{4}$/.test(s) ? `${s.slice(6)}-${s.slice(3, 5)}-${s.slice(0, 2)}` : s);

export function readSheets(dir = 'data/private/Sheets') {
  if (!existsSync(dir)) return null;

  const developers = readTab(dir, 'Config', 'Email').filter((r) => r.Email.includes('@')).map((r) => ({ email: r.Email.toLowerCase(), name: r.Nom }));
  const sprints = readTab(dir, 'Config', 'Sprint').filter((r) => r['Date début']).map((r) => ({ name: r.Sprint, start: r['Date début'], end: r['Date fin'], capacityHours: num(r['Capacité/dev (h)']), status: r.Statut }));

  // Congés / absences (en heures) et jours fériés, dédoublonnés (l'export contient des doublons)
  const seen = new Set();
  const absences = {};
  const holidays = new Set();
  for (const r of readTab(dir, 'Manual_Input', 'Date')) {
    const key = `${r.Date}|${r.Email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const date = isoDate(r.Date);
    if (num(r['Jour férié (h)']) > 0) holidays.add(date);
    const off = num(r['Congé (h)']) + num(r['Absence (h)']);
    if (off >= 4) (absences[r.Email.toLowerCase()] ||= []).push(date); // une demi-journée ou plus = jour d'absence
  }

  // Heures de réunion : valeurs cumulées → on garde le maximum par sprint et par dev
  const meetings = {};
  for (const r of readTab(dir, 'Raw_Calendar', 'Date')) {
    const s = (meetings[r.Sprint] ||= {});
    const email = r.Email.toLowerCase();
    s[email] = Math.max(s[email] || 0, num(r['Heures réunion (cumul sprint)']));
  }

  return { developers, sprints, absences, holidays: [...holidays].sort(), meetings };
}
