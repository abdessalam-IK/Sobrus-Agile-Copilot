// Build Vercel : aucun fichier statique servi directement.
// Tout passe par la fonction api/index.js, qui vérifie la connexion avant de servir l'interface.
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('vercel-static', { recursive: true });
writeFileSync('vercel-static/.keep', '');
console.log('Interface servie par la fonction (connexion Google obligatoire).');
