// Chargement des données synchronisées depuis Linear (et les Sheets), un fichier par équipe.

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

/** Équipes Linear suivies par le Copilot (clés Linear), dans l'ordre d'affichage. */
export const TEAMS = (process.env.LINEAR_TEAMS || 'SUPP,CEN')
  .split(',')
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

/** Dossier des données synchronisées : data/private en local, disque temporaire sur Vercel (lecture seule ailleurs). */
export const DATA_DIR = process.env.COPILOT_DATA_DIR || (process.env.VERCEL ? '/tmp/copilot' : path.join(root, 'data/private'));

export const teamFile = (team) => path.join(DATA_DIR, `linear-${team.toLowerCase()}.json`);

// Sur Vercel : les données livrées avec le déploiement (data/private, en lecture seule) servent de point de départ ;
// les synchronisations Linear suivantes écrivent dans /tmp.
if (process.env.VERCEL) {
  mkdirSync(DATA_DIR, { recursive: true });
  for (const team of TEAMS) {
    const bundled = path.join(root, `data/private/linear-${team.toLowerCase()}.json`);
    if (existsSync(bundled) && !existsSync(teamFile(team))) copyFileSync(bundled, teamFile(team));
  }
}

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
