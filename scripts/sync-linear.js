// Synchronise une équipe Linear (+ Sheets) vers data/private/<équipe>.json
// Usage : npm run sync -- [TEAM_KEY] [nombre de cycles terminés]
//         npm run sync -- SUPP 6

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../src/adapters/linear-client.js';
import { importFromLinear } from '../src/adapters/linear.js';
import { readSheets } from '../src/adapters/sheets.js';

loadEnv();
const teamKey = process.argv[2] || process.env.LINEAR_TEAM || 'SUPP';
const closedCycles = Number(process.argv[3] || 6);

const sheets = readSheets();
console.log(sheets ? `Sheets : ${sheets.developers.length} développeurs, ${sheets.holidays.length} jours fériés` : 'Sheets : aucun export trouvé (data/private/Sheets)');

const t0 = Date.now();
const dataset = await importFromLinear({ teamKey, closedCycles, sheets, onProgress: (m) => console.log(`  ${m}`) });
const out = `data/private/linear-${teamKey.toLowerCase()}.json`;
mkdirSync('data/private', { recursive: true });
writeFileSync(out, JSON.stringify(dataset, null, 2));

console.log(`\n${dataset.sprints.length} sprints importés en ${Math.round((Date.now() - t0) / 1000)} s → ${out}`);
for (const s of dataset.sprints) {
  const done = s.issues.filter((i) => i.history.at(-1)?.to === 'done').length;
  console.log(`  ${s.name.padEnd(20)} ${s.start} → ${s.end}  ${String(s.issues.length).padStart(3)} issues · ${done} terminées · ${s.status}`);
}
console.log(`Équipe : ${dataset.team.length} personnes · backlog du prochain cycle : ${dataset.backlog.length} issues`);
