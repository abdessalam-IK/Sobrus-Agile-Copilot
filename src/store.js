// Chargement du jeu de données synchronisé depuis Linear (et les Sheets).

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const DATA_FILE = path.resolve(root, process.env.SOBRUS_DATA_FILE || 'data/private/linear-supp.json');

export function loadDataset() {
  if (!existsSync(DATA_FILE)) {
    throw new Error(`Données introuvables (${path.relative(root, DATA_FILE)}). Lancez « npm run sync » pour importer Linear.`);
  }
  return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
}
