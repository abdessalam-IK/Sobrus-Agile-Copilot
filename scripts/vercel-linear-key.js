// Transmet à Vercel la clé Linear du fichier .env (sans l'afficher), puis redéploie la version en ligne.
// La version en ligne peut ensuite se synchroniser seule avec Linear toutes les 30 min.
// Usage : node scripts/vercel-linear-key.js

import { spawnSync } from 'node:child_process';

process.loadEnvFile('.env');
const key = process.env.LINEAR_API_KEY;
if (!key) {
  console.error('LINEAR_API_KEY introuvable dans .env');
  process.exit(1);
}

const vercel = (args, input) => spawnSync('npx.cmd', ['-y', 'vercel@latest', ...args], { input, stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'], shell: true });

console.log('Envoi de la clé Linear à Vercel (production)…');
vercel(['env', 'rm', 'LINEAR_API_KEY', 'production', '--yes']); // remplace une éventuelle ancienne valeur
const add = vercel(['env', 'add', 'LINEAR_API_KEY', 'production'], key);
if (add.status !== 0) process.exit(add.status ?? 1);

console.log('Redéploiement de la version en ligne…');
process.exit(vercel(['deploy', '--prod', '--yes']).status ?? 0);
