// Synchronisation Linear (+ exports Sheets) vers data/private/linear-<équipe>.json.
// Utilisée par la ligne de commande (npm run sync) et par le bouton de l'interface.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './adapters/linear-client.js';
import { importFromLinear } from './adapters/linear.js';
import { readSheets, fetchSheets } from './adapters/sheets.js';
import { TEAMS, teamFile } from './store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Configuration privée locale : équipes déclarées (equipe.json) et exports Sheets. */
export function localPrivateConfig() {
  const configFile = path.join(root, 'data/private/equipe.json');
  return {
    sheets: readSheets(path.join(root, 'data/private/Sheets')),
    teamConfig: existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {},
  };
}

export async function syncLinear({ teamKey = TEAMS[0], closedCycles = 6, onProgress = () => {}, config = null } = {}) {
  loadEnv();
  const { sheets, teamConfig } = config || localPrivateConfig();
  const t0 = Date.now();
  const dataset = await importFromLinear({ teamKey, closedCycles, sheets, teamConfig, onProgress });
  const out = teamFile(teamKey);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dataset, null, 2));
  return {
    team: teamKey,
    product: dataset.meta.product,
    file: path.relative(root, out) || out,
    seconds: Math.round((Date.now() - t0) / 1000),
    syncedAt: dataset.meta.syncedAt,
    sheets: sheets ? { developers: sheets.developers.length, holidays: sheets.holidays.length } : null,
    sprints: dataset.sprints.map((s) => ({ name: s.name, start: s.start, end: s.end, status: s.status, issues: s.issues.length, done: s.issues.filter((i) => i.history.at(-1)?.to === 'done').length })),
    people: dataset.team.length,
    developers: dataset.team.filter((m) => m.delivery).map((m) => m.name),
    outsideCapacity: dataset.team.filter((m) => !m.delivery).map((m) => m.name),
    backlog: dataset.backlog.length,
  };
}

/** Synchronise toutes les équipes suivies, l'une après l'autre (limite de requêtes Linear). */
/** Configuration privée à jour : équipes (equipe.json) + Google Sheet en direct quand GOOGLE_SHEET_URL est défini. */
export async function freshPrivateConfig(base = localPrivateConfig()) {
  loadEnv();
  if (!process.env.GOOGLE_SHEET_URL) return base;
  try {
    return { ...base, sheets: await fetchSheets(process.env.GOOGLE_SHEET_URL), sheetsSource: 'google' };
  } catch (e) {
    console.error(`Google Sheet illisible, repli sur les CSV locaux : ${e.message}`);
    return { ...base, sheetsSource: 'csv' };
  }
}

export async function syncAll({ teams = TEAMS, closedCycles = 6, onProgress = () => {}, config = null } = {}) {
  const results = [];
  const shared = await freshPrivateConfig(config || localPrivateConfig());
  for (const teamKey of teams) {
    onProgress(`Équipe ${teamKey}…`);
    results.push(await syncLinear({ teamKey, closedCycles, onProgress, config: shared }));
  }
  return results;
}
