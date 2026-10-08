// Persistance locale : jeu de données et mémoire d'apprentissage (feedback humain).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const DATA_FILE = path.resolve(root, process.env.SOBRUS_DATA_FILE || 'data/sobrus-demo.json');
const FEEDBACK_FILE = path.resolve(root, 'data/feedback.json');

export function loadDataset() {
  if (!existsSync(DATA_FILE)) {
    throw new Error(`Jeu de données introuvable (${DATA_FILE}). Lancez « npm run generate » ou importez Jira.`);
  }
  return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
}

export function loadFeedback() {
  if (!existsSync(FEEDBACK_FILE)) return { bySignal: {}, log: [] };
  return JSON.parse(readFileSync(FEEDBACK_FILE, 'utf8'));
}

/** Enregistre un retour 👍/👎 sur un type de signal : c'est ce qui permet au Copilot d'apprendre. */
export function recordFeedback({ signalType, useful, sprintId, comment }) {
  if (!signalType || typeof useful !== 'boolean') throw new Error('signalType et useful (booléen) sont requis');
  const fb = loadFeedback();
  const entry = (fb.bySignal[signalType] ||= { useful: 0, notUseful: 0 });
  if (useful) entry.useful++;
  else entry.notUseful++;
  fb.log.push({ at: new Date().toISOString(), signalType, useful, sprintId, comment: comment || null });
  writeFileSync(FEEDBACK_FILE, JSON.stringify(fb, null, 2));
  return fb;
}
