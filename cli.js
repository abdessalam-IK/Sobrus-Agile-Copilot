// CLI : rapports en ligne de commande et import Jira.
//   node cli.js report [S6] [--asOf 2026-10-06] [--out rapport.md]
//   node cli.js signals [S6]
//   node cli.js import-jira --board 12 [--out data/jira.json]

import { writeFileSync } from 'node:fs';
import { analyze } from './src/engine/index.js';
import { loadDataset, loadFeedback } from './src/store.js';

const [cmd = 'report', ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] || '').startsWith('--'));

async function main() {
  if (cmd === 'import-jira') {
    const { importFromJira } = await import('./src/adapters/jira.js');
    const board = opt('board');
    if (!board) throw new Error('--board <id> est requis');
    const dataset = await importFromJira({ boardId: board, sprints: Number(opt('sprints') || 6) });
    const out = opt('out') || 'data/jira.json';
    writeFileSync(out, JSON.stringify(dataset, null, 2));
    console.log(`Import terminé : ${out} (${dataset.sprints.length} sprints). Lancez : SOBRUS_DATA_FILE=${out} npm start`);
    return;
  }

  const dataset = loadDataset();
  const sprintId = positional[0] || dataset.sprints.at(-1).id;
  const result = analyze(dataset, sprintId, { asOf: opt('asOf'), feedback: loadFeedback().bySignal });

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

main().catch((err) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(1);
});
