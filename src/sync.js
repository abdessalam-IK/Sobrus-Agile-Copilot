// Synchronisation Linear (+ exports Sheets) vers data/private/linear-<équipe>.json.
// Utilisée par la ligne de commande (npm run sync) et par le bouton de l'interface.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './adapters/linear-client.js';
import { importFromLinear } from './adapters/linear.js';
import { readSheets } from './adapters/sheets.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function syncLinear({ teamKey, closedCycles = 6, onProgress = () => {} } = {}) {
  loadEnv();
  const team = teamKey || process.env.LINEAR_TEAM || 'SUPP';
  const sheets = readSheets(path.join(root, 'data/private/Sheets'));
  const t0 = Date.now();
  const dataset = await importFromLinear({ teamKey: team, closedCycles, sheets, onProgress });
  const out = path.join(root, `data/private/linear-${team.toLowerCase()}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dataset, null, 2));
  return {
    file: path.relative(root, out),
    seconds: Math.round((Date.now() - t0) / 1000),
    syncedAt: dataset.meta.syncedAt,
    sheets: sheets ? { developers: sheets.developers.length, holidays: sheets.holidays.length } : null,
    sprints: dataset.sprints.map((s) => ({ name: s.name, start: s.start, end: s.end, status: s.status, issues: s.issues.length, done: s.issues.filter((i) => i.history.at(-1)?.to === 'done').length })),
    team: dataset.team.length,
    backlog: dataset.backlog.length,
  };
}
