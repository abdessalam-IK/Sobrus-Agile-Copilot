// Synchronise une équipe Linear (+ Sheets) vers data/private/linear-<équipe>.json
// Usage : npm run sync -- [TEAM_KEY] [nombre de cycles terminés]
//         npm run sync -- SUPP 6

import { syncLinear } from '../src/sync.js';

const r = await syncLinear({
  teamKey: process.argv[2],
  closedCycles: Number(process.argv[3] || 6),
  onProgress: (m) => console.log(`  ${m}`),
});

console.log(r.sheets ? `Sheets : ${r.sheets.developers} développeurs, ${r.sheets.holidays} jours fériés` : 'Sheets : aucun export trouvé (data/private/Sheets)');
console.log(`\n${r.sprints.length} sprints importés en ${r.seconds} s → ${r.file}`);
for (const s of r.sprints) {
  console.log(`  ${s.name.padEnd(20)} ${s.start} → ${s.end}  ${String(s.issues).padStart(3)} issues · ${s.done} terminées · ${s.status}`);
}
console.log(`Équipe : ${r.team} personnes · backlog du prochain cycle : ${r.backlog} issues`);
