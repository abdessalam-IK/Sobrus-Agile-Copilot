// Synchronise les équipes Linear suivies (+ Sheets) vers data/private/linear-<équipe>.json
// Usage : npm run sync                  → toutes les équipes de LINEAR_TEAMS (défaut SUPP,CEN)
//         npm run sync -- CEN [6]       → une seule équipe, 6 cycles terminés

import { syncAll } from '../src/sync.js';

const results = await syncAll({
  teams: process.argv[2] ? [process.argv[2].toUpperCase()] : undefined,
  closedCycles: Number(process.argv[3] || 6),
  onProgress: (m) => console.log(`  ${m}`),
});

for (const r of results) {
  console.log(`\n${r.product} (${r.team}) : ${r.sprints.length} sprints importés en ${r.seconds} s → ${r.file}`);
  for (const s of r.sprints) {
    console.log(`  ${s.name.padEnd(20)} ${s.start} → ${s.end}  ${String(s.issues).padStart(3)} issues · ${s.done} terminées · ${s.status}`);
  }
  console.log(`  Équipe : ${r.developers.join(', ') || '—'}`);
  console.log(`  Autres personnes assignées : ${r.outsideCapacity.join(', ') || '—'}`);
}
