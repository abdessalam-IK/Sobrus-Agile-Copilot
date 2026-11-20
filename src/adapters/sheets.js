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

/** Lit un onglet (texte CSV) : saute les lignes de titre jusqu'à la ligne d'en-tête qui contient `firstHeader`. */
function readTab(tabs, name, firstHeader) {
  const text = tabs[name];
  if (!text) return [];
  const rows = parseCsv(text.replace(/^﻿/, ''));
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

export const TABS = ['Config', 'Manual_Input', 'Raw_Calendar'];

/** Exports CSV déposés à la main dans un dossier (« Taux d'Occupation Sobrus - Config.csv », …). */
export function readSheets(dir = 'data/private/Sheets') {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  const tabs = {};
  for (const name of TABS) {
    const file = files.find((f) => f.endsWith(`${name}.csv`));
    if (file) tabs[name] = readFileSync(path.join(dir, file), 'utf8');
  }
  return Object.keys(tabs).length ? sheetsFromTabs(tabs) : null;
}

/**
 * Google Sheet « Taux d'Occupation Sobrus » en direct, publié sur le Web (Fichier → Partager → Publier sur le Web).
 * `url` = le lien de publication (…/spreadsheets/d/e/<id>/pubhtml) ; chaque onglet est lu en CSV.
 */
export async function fetchSheets(url, token = process.env.GOOGLE_SHEET_TOKEN) {
  // Application Web Apps Script du Sheet (scripts/apps-script/Copilot.gs) : les 3 onglets en une requête
  if (/script\.google(usercontent)?\.com/.test(url)) {
    const res = await fetch(`${url.trim()}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.tabs) throw new Error(`Apps Script du Google Sheet : ${body?.error || `réponse inattendue (${res.status})`}`);
    return sheetsFromTabs(body.tabs);
  }
  const base = url.trim().replace(/\/pub(html)?([?#].*)?$/, '');
  const html = await (await fetch(`${base}/pubhtml`)).text();
  const gids = {};
  for (const m of html.matchAll(/switchToSheet\('(\d+)'\)[^>]*>([^<]+)</g)) gids[m[2].trim()] = m[1];
  for (const m of html.matchAll(/id="sheet-button-(\d+)"[^>]*>(?:<a[^>]*>)?([^<]+)</g)) gids[m[2].trim()] ??= m[1];
  const tabs = {};
  for (const name of TABS) {
    const gid = gids[name];
    if (gid == null) throw new Error(`Onglet « ${name} » introuvable dans le Google Sheet publié (onglets vus : ${Object.keys(gids).join(', ') || 'aucun'})`);
    const res = await fetch(`${base}/pub?gid=${gid}&single=true&output=csv`);
    if (!res.ok) throw new Error(`Google Sheet : onglet « ${name} » illisible (${res.status})`);
    tabs[name] = await res.text();
  }
  return sheetsFromTabs(tabs);
}

export function sheetsFromTabs(tabs) {
  const developers = readTab(tabs, 'Config', 'Email').filter((r) => r.Email.includes('@')).map((r) => ({ email: r.Email.toLowerCase(), name: r.Nom }));
  const sprints = readTab(tabs, 'Config', 'Sprint').filter((r) => r['Date début']).map((r) => ({ name: r.Sprint, start: r['Date début'], end: r['Date fin'], capacityHours: num(r['Capacité/dev (h)']), status: r.Statut }));

  // Congés / absences (en heures) et jours fériés, dédoublonnés (l'export contient des doublons)
  const seen = new Set();
  const absences = {};
  const holidays = new Set();
  for (const r of readTab(tabs, 'Manual_Input', 'Date')) {
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
  for (const r of readTab(tabs, 'Raw_Calendar', 'Date')) {
    const s = (meetings[r.Sprint] ||= {});
    const email = r.Email.toLowerCase();
    s[email] = Math.max(s[email] || 0, num(r['Heures réunion (cumul sprint)']));
  }

  return { developers, sprints, absences, holidays: [...holidays].sort(), meetings };
}
