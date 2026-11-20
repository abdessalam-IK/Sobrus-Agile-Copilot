// Stockage de la version en ligne (Vercel) : Vercel Blob en accès PRIVÉ.
// Actif uniquement si BLOB_READ_WRITE_TOKEN est défini (Vercel l'ajoute quand le store est relié au projet).
//
// Contenu du store (compressé en gzip, jamais public) :
//   data/linear-<équipe>.json.gz   données synchronisées depuis Linear
//   config/equipe.json.gz          équipes déclarées (data/private/equipe.json)
//   config/sheets.json.gz          exports Sheets déjà lus (congés, jours fériés, réunions)
//
// Les fonctions Vercel n'ont qu'un disque temporaire (/tmp) : on y recopie les données au besoin,
// le reste du Copilot les lit comme en local.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { get, head, put } from '@vercel/blob';
import { TEAMS, teamFile } from './store.js';

export const cloudEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const dataName = (team) => `data/linear-${team.toLowerCase()}.json.gz`;

export async function putJson(name, value) {
  await put(name, gzipSync(Buffer.from(JSON.stringify(value))), {
    access: 'private',
    contentType: 'application/gzip',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function getJson(name) {
  const res = await get(name, { access: 'private', useCache: false });
  if (!res?.stream) return null;
  return JSON.parse(gunzipSync(Buffer.from(await new Response(res.stream).arrayBuffer())).toString('utf8'));
}

async function uploadedAt(name) {
  try {
    return (await head(name)).uploadedAt.getTime();
  } catch {
    return 0; // absent du store
  }
}

let lastCheck = 0;
let hydrating = null;

/**
 * Recopie dans /tmp les données du store plus récentes que la copie locale.
 * Vérification au plus une fois par minute et par instance.
 */
export function hydrate() {
  if (Date.now() - lastCheck < 60e3) return hydrating || Promise.resolve();
  lastCheck = Date.now();
  hydrating = (async () => {
    await Promise.all(TEAMS.map(async (team) => {
      const file = teamFile(team);
      const remote = await uploadedAt(dataName(team));
      if (!remote) return;
      const local = existsSync(file) ? statSync(file).mtimeMs : 0;
      if (remote <= local) return;
      const dataset = await getJson(dataName(team));
      if (!dataset) return;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(dataset));
    }));
  })().finally(() => { hydrating = null; });
  return hydrating;
}

/** Configuration privée du store ; à défaut, celle livrée avec le déploiement (`base`). */
export async function privateConfig(base = { teamConfig: {}, sheets: null }) {
  const [teamConfig, sheets] = await Promise.all([getJson('config/equipe.json.gz').catch(() => null), getJson(SHEETS_BLOB).catch(() => null)]);
  return { teamConfig: teamConfig || base.teamConfig, sheets: sheets || base.sheets, sheetsSource: sheets ? 'google' : 'csv' };
}

/** Données du Google Sheet envoyées par son Apps Script (voir scripts/apps-script/Copilot.gs). */
export const SHEETS_BLOB = 'config/sheets.json.gz';

/** Envoie au store les données d'une équipe déjà écrites dans /tmp (ou data/private en local). */
export async function uploadTeam(team) {
  await putJson(dataName(team), JSON.parse(readFileSync(teamFile(team), 'utf8')));
}
