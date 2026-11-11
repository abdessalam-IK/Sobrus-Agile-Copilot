// CLI : rapports en ligne de commande.
//   node cli.js report [C154] [--asOf 2026-10-06] [--out rapport.md]
//   node cli.js signals [C154]
// Synchronisation Linear : npm run sync

import { writeFileSync } from 'node:fs';
import { analyze } from './src/engine/index.js';
import { loadDataset } from './src/store.js';

const [cmd = 'report', ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] || '').startsWith('--'));

function main() {
  const dataset = loadDataset();
  const sprintId = positional[0] || dataset.sprints.at(-1).id;
  const result = analyze(dataset, sprintId, { asOf: opt('asOf') });

  if (cmd === 'signals') {
    console.log(result.think.headline, '\n');
    for (const s of result.think.signals) console.log(`[${s.level.label.padEnd(12)}] ${s.severity.toFixed(2)}  ${s.title}`);
    return;
  }
  if (cmd === 'report') {
    const out = opt('out');
    if (out) {
      writeFileSync(out, result.report);
      console.log(`Rapport écrit : ${out}`);
    } else {
      console.log(result.report);
    }
    return;
  }
  throw new Error(`Commande inconnue : ${cmd}`);
}

try {
  main();
} catch (err) {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
}
