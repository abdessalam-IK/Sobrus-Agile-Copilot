// Serveur HTTP sans framework : API JSON + interface web statique.
// Usage : npm start  →  http://localhost:4300
// Chaque route d'analyse prend ?team=SUPP (équipe Linear) ; par défaut, la première équipe synchronisée.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, summary } from './src/engine/index.js';
import { crossTeamLoad } from './src/engine/portfolio.js';
import { sobrusOverview } from './src/engine/sobrus.js';
import { TEAMS, availableTeams, loadDataset, loadAll } from './src/store.js';
import { generate, aiConfigured, aiModel, aiProvider, AI_KINDS } from './src/ai/claude.js';

const PORT = Number(process.env.PORT || 4300);
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

/** Analyse d'un sprint d'une équipe, avec la charge des développeurs tous projets confondus. */
function runAnalysis(team, sprintId, asOf) {
  const dataset = loadDataset(team);
  return { dataset, analysis: analyze(dataset, sprintId, { asOf, portfolio: crossTeamLoad(loadAll()) }) };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const asOf = url.searchParams.get('asOf') || undefined;
  const team = (url.searchParams.get('team') || availableTeams()[0] || TEAMS[0]).toUpperCase();

  if (parts[0] !== 'api') {
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Interdit' });
    try {
      return send(res, 200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch {
      return send(res, 404, { error: 'Introuvable' });
    }
  }

  if (req.method === 'GET' && parts[1] === 'config') {
    return send(res, 200, { ai: { configured: aiConfigured(), provider: aiProvider(), model: aiModel(), kinds: AI_KINDS } });
  }
  if (req.method === 'GET' && parts[1] === 'teams') {
    return send(res, 200, availableTeams().map((t) => {
      const { meta } = loadDataset(t);
      return { key: t, product: meta.product, syncedAt: meta.syncedAt };
    }));
  }
  if (req.method === 'GET' && parts[1] === 'sobrus') {
    const all = loadAll();
    return send(res, 200, sobrusOverview(all, crossTeamLoad(all)));
  }
  if (req.method === 'GET' && parts[1] === 'summary') return send(res, 200, summary(loadDataset(team)));
  if (req.method === 'GET' && parts[1] === 'analysis' && parts[2]) return send(res, 200, runAnalysis(team, parts[2], asOf).analysis);
  if (req.method === 'GET' && parts[1] === 'report' && parts[2]) {
    return send(res, 200, runAnalysis(team, parts[2].replace(/\.md$/, ''), asOf).analysis.report, 'text/markdown; charset=utf-8');
  }
  if (req.method === 'POST' && parts[1] === 'sync') {
    // Toutes les équipes : la charge multi-projets a besoin de données fraîches partout
    const { syncAll } = await import('./src/sync.js');
    return send(res, 200, await syncAll());
  }
  if (req.method === 'POST' && parts[1] === 'ai' && parts[2]) {
    const { kind, asOf: bodyAsOf, team: bodyTeam } = await readBody(req);
    const { dataset, analysis } = runAnalysis((bodyTeam || team).toUpperCase(), parts[2], bodyAsOf);
    return send(res, 200, await generate(kind, analysis, dataset));
  }
  return send(res, 404, { error: 'Route inconnue' });
}

http
  .createServer((req, res) => {
    route(req, res).catch((err) => {
      console.error(err);
      send(res, err.status || 500, { error: err.message });
    });
  })
  .listen(PORT, () => {
    console.log(`Sobrus AI Copilot → http://localhost:${PORT}`);
    console.log(`Équipes suivies : ${TEAMS.join(', ')} · synchronisées : ${availableTeams().join(', ') || 'aucune (npm run sync)'}`);
    console.log(aiConfigured() ? `Couche IA générative active : ${aiModel()}.` : 'Couche IA générative inactive (installer Claude Code ou définir ANTHROPIC_API_KEY). Le moteur d’analyse fonctionne sans.');
  });
