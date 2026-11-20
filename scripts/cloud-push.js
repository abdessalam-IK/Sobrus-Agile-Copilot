// Dépose dans le store privé Vercel Blob ce qui ne vit que sur ce poste :
// équipes déclarées (data/private/equipe.json) et les dernières données synchronisées.
// À relancer quand equipe.json ou les Sheets changent.
//
// Usage : npm run cloud:push
// (le jeton du store est récupéré auprès de Vercel s'il n'est pas dans .env ; il faut être connecté : vercel login)

import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TEAMS, teamFile } from '../src/store.js';
import { localPrivateConfig } from '../src/sync.js';
import { cloudEnabled, putJson, uploadTeam } from '../src/cloud.js';

// Jeton du store de production : récupéré auprès de Vercel le temps de l'envoi, jamais écrit dans le projet
if (!cloudEnabled()) {
  const dir = mkdtempSync(path.join(tmpdir(), 'copilot-'));
  const file = path.join(dir, 'env');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  spawnSync(npx, ['-y', 'vercel@latest', 'env', 'pull', file, '--environment', 'production', '--yes'], { stdio: 'ignore', shell: process.platform === 'win32' });
  const line = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('BLOB_READ_WRITE_TOKEN=')) : null;
  rmSync(dir, { recursive: true, force: true });
  if (line) process.env.BLOB_READ_WRITE_TOKEN = line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, '');
}
if (!cloudEnabled()) {
  console.error('Jeton du store introuvable : connectez-vous à Vercel (npx vercel login) dans ce dossier, ou ajoutez BLOB_READ_WRITE_TOKEN à .env.');
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
