// Serveur local : npm start  →  http://localhost:4300
// La logique HTTP est dans src/http.js (partagée avec la version en ligne Vercel, api/index.js).

import http from 'node:http';
import { TEAMS, availableTeams } from './src/store.js';
import { aiConfigured, aiModel } from './src/ai/claude.js';
import { handler, SYNC_EVERY_MIN, syncIfStale } from './src/http.js';

const PORT = Number(process.env.PORT || 4300);

http.createServer(handler).listen(PORT, () => {
  console.log(`Sobrus AI Copilot → http://localhost:${PORT}`);
  console.log(`Équipes suivies : ${TEAMS.join(', ')} · synchronisées : ${availableTeams().join(', ') || 'aucune (npm run sync)'}`);
  console.log(aiConfigured() ? `Couche IA générative active : ${aiModel()}.` : 'Couche IA générative inactive (installer Claude Code ou définir ANTHROPIC_API_KEY). Le moteur d’analyse fonctionne sans.');
  if (SYNC_EVERY_MIN) {
    console.log(`Synchronisation automatique de Linear toutes les ${SYNC_EVERY_MIN} min (SYNC_EVERY_MIN=0 pour la désactiver).`);
    syncIfStale();
    setInterval(syncIfStale, 60e3); // vérifie chaque minute si les données ont dépassé l'âge limite
  }
});
