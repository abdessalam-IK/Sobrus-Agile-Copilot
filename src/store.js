// Chargement des données synchronisées depuis Linear (et les Sheets), un fichier par équipe.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

/** Équipes Linear suivies par le Copilot (clés Linear), dans l'ordre d'affichage. */
export const TEAMS = (process.env.LINEAR_TEAMS || 'SUPP,CEN')
  .split(',')
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

export const teamFile = (team) => path.join(root, `data/private/linear-${team.toLowerCase()}.json`);

/** Équipes déjà synchronisées (leur fichier existe). */
export const availableTeams = () => TEAMS.filter((t) => existsSync(teamFile(t)));

export function loadDataset(team = availableTeams()[0] || TEAMS[0]) {
  const file = teamFile(team);
  if (!existsSync(file)) {
    throw new Error(`Données de l’équipe ${team} introuvables. Lancez « npm run sync » pour importer Linear.`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

export const loadAll = () => availableTeams().map((t) => loadDataset(t));
