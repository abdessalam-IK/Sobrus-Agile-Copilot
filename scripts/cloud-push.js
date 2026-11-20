// Dépose dans le store privé Vercel Blob ce qui ne vit que sur ce poste :
// équipes déclarées (data/private/equipe.json) et les dernières données synchronisées.
// À relancer quand equipe.json ou les Sheets changent.
//
// Prérequis : BLOB_READ_WRITE_TOKEN dans .env (Vercel → Storage → le store Blob → .env.local).
// Usage : npm run cloud:push

import { existsSync } from 'node:fs';
import { TEAMS, teamFile } from '../src/store.js';
import { localPrivateConfig } from '../src/sync.js';
import { cloudEnabled, putJson, uploadTeam } from '../src/cloud.js';

if (!cloudEnabled()) {
  console.error('BLOB_READ_WRITE_TOKEN manquant dans .env (Vercel → Storage → store Blob → onglet .env.local).');
  process.exit(1);
}

const { teamConfig } = localPrivateConfig();
await putJson('config/equipe.json.gz', teamConfig);
console.log(`Équipes déclarées envoyées : ${Object.keys(teamConfig.equipes || {}).join(', ') || 'aucune'}`);
// Les Sheets ne sont pas envoyés d'ici : l'Apps Script du Google Sheet les envoie lui-même, à jour (scripts/apps-script/Copilot.gs).
for (const team of TEAMS) {
  if (!existsSync(teamFile(team))) { console.log(`${team} : pas encore synchronisé, ignoré`); continue; }
  await uploadTeam(team);
  console.log(`${team} : données envoyées`);
}
console.log('Terminé. La version en ligne se synchronisera ensuite seule avec Linear.');
