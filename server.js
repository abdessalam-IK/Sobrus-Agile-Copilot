// Serveur HTTP sans framework : API JSON + interface web statique.
// Usage : npm start  →  http://localhost:4300

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, summary } from './src/engine/index.js';
import { loadDataset, loadFeedback, recordFeedback } from './src/store.js';
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

const runAnalysis = (sprintId, asOf) => analyze(loadDataset(), sprintId, { asOf, feedback: loadFeedback().bySignal });

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const asOf = url.searchParams.get('asOf') || undefined;

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
  if (req.method === 'GET' && parts[1] === 'summary') return send(res, 200, summary(loadDataset()));
  if (req.method === 'GET' && parts[1] === 'analysis' && parts[2]) return send(res, 200, runAnalysis(parts[2], asOf));
  if (req.method === 'GET' && parts[1] === 'report' && parts[2]) {
    return send(res, 200, runAnalysis(parts[2].replace(/\.md$/, ''), asOf).report, 'text/markdown; charset=utf-8');
  }
  if (req.method === 'POST' && parts[1] === 'sync') {
    const { syncLinear } = await import('./src/sync.js');
    const current = loadDataset();
    if (current.meta?.source !== 'linear') return send(res, 400, { error: 'Le jeu de données actuel ne provient pas de Linear.' });
    return send(res, 200, await syncLinear({ teamKey: current.meta.teamKey }));
  }
  if (req.method === 'GET' && parts[1] === 'feedback') return send(res, 200, loadFeedback());
  if (req.method === 'POST' && parts[1] === 'feedback') return send(res, 200, recordFeedback(await readBody(req)));
  if (req.method === 'POST' && parts[1] === 'ai' && parts[2]) {
    const { kind, asOf: bodyAsOf } = await readBody(req);
    const dataset = loadDataset();
    const analysis = analyze(dataset, parts[2], { asOf: bodyAsOf, feedback: loadFeedback().bySignal });
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
    console.log(aiConfigured() ? `Couche IA générative active : ${aiModel()}.` : 'Couche IA générative inactive (installer Claude Code ou définir ANTHROPIC_API_KEY). Le moteur d’analyse fonctionne sans.');
  });
