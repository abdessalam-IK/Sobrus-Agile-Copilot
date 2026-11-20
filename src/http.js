// Application HTTP sans framework : API JSON + interface web statique.
// Utilisée par server.js (poste local) et par api/index.js (Vercel).
// Chaque route d'analyse prend ?team=SUPP (équipe Linear) ; par défaut, la première équipe synchronisée.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, summary } from './engine/index.js';
import { crossTeamLoad } from './engine/portfolio.js';
import { sobrusOverview } from './engine/sobrus.js';
import { TEAMS, availableTeams, loadDataset, loadAll } from './store.js';
import { generate, aiConfigured, aiModel, aiProvider, AI_KINDS } from './ai/claude.js';
import { timeZone, offsetMinutes } from './lib/tz.js';
import { syncAll, localPrivateConfig } from './sync.js';
import { authEnabled, currentUser, handleAuth } from './auth.js';
import { cloudEnabled, hydrate, privateConfig, uploadTeam, putJson, getJson, SHEETS_BLOB } from './cloud.js';
import { sheetsFromTabs } from './adapters/sheets.js';
import { timingSafeEqual } from 'node:crypto';

/** Code secret partagé avec l'Apps Script du Google Sheet. */
function sheetTokenOk(given) {
  const expected = process.env.GOOGLE_SHEET_TOKEN || '';
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return expected.length >= 16 && a.length === b.length && timingSafeEqual(a, b);
}

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/** Version en ligne (Vercel) : pas de serveur permanent, pas d'IA générative. */
export const ONLINE = Boolean(process.env.VERCEL);

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

/** Analyse d'un sprint d'une équipe, avec la charge des développeurs tous projets confondus. */
function runAnalysis(team, sprintId, asOf) {
  const dataset = loadDataset(team);
  return { dataset, analysis: analyze(dataset, sprintId, { asOf, portfolio: crossTeamLoad(loadAll()) }) };
}

// ---------------------------------------------------------------------------
// Synchronisation Linear : manuelle (bouton) ou automatique dès que les données ont plus de SYNC_EVERY_MIN minutes.
// Toutes les équipes à la fois : la charge multi-projets a besoin de données fraîches partout.
// ---------------------------------------------------------------------------
export const SYNC_EVERY_MIN = Number(process.env.SYNC_EVERY_MIN ?? 30);
let syncing = null;

export function runSync(reason) {
  if (syncing) return syncing; // une synchronisation à la fois
  syncing = (async () => {
    try {
      // En ligne : configuration privée et résultats dans le store Vercel Blob
      const config = cloudEnabled() ? await privateConfig(localPrivateConfig()) : null;
      const results = await syncAll(config ? { config } : {});
      if (cloudEnabled()) await Promise.all(results.map((r) => uploadTeam(r.team)));
      console.log(`Synchronisation ${reason} terminée (${new Date().toISOString()})`);
      return results;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** Âge des données les plus anciennes, en minutes (Infinity si une équipe n'a jamais été synchronisée). */
function dataAgeMin() {
  const teams = availableTeams();
  if (teams.length < TEAMS.length) return Infinity;
  const oldest = Math.min(...teams.map((t) => Date.parse(loadDataset(t).meta.syncedAt) || 0));
  return (Date.now() - oldest) / 60e3;
}

/** Lance une synchronisation si les données ont dépassé l'âge limite. Renvoie la promesse, ou null. */
export function syncIfStale(reason = 'automatique') {
  if (!SYNC_EVERY_MIN || syncing || dataAgeMin() <= SYNC_EVERY_MIN) return null;
  return runSync(reason).catch((e) => console.error(`Synchronisation ${reason} impossible : ${e.message}`));
}

/** En ligne : récupère les données du store, synchronise en arrière-plan si elles sont anciennes. */
async function prepareOnlineData() {
  if (cloudEnabled()) await hydrate();
  if (!availableTeams().length) {
    await runSync('initiale'); // tout premier lancement : rien à afficher sans données
    return;
  }
  const pending = syncIfStale();
  if (pending) {
    // La réponse part tout de suite ; Vercel garde la fonction en vie jusqu'à la fin de la synchronisation
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(pending);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Connexion Google, uniquement si GOOGLE_CLIENT_ID est défini (sinon le lien est ouvert)
  let user = null;
  if (authEnabled()) {
    if (url.pathname.startsWith('/auth/') && (await handleAuth(req, res, url))) return;
    user = currentUser(req);
    if (!user) {
      if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Connexion requise', login: '/auth/login' });
      res.writeHead(302, { Location: '/auth/login', 'Cache-Control': 'no-store' });
      return res.end();
    }
  }

  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api') {
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Interdit' });
    try {
      return send(res, 200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch {
      return send(res, 404, { error: 'Introuvable' });
    }
  }

  if (ONLINE) await prepareOnlineData();

  const asOf = url.searchParams.get('asOf') || undefined;
  const team = (url.searchParams.get('team') || availableTeams()[0] || TEAMS[0]).toUpperCase();

  if (req.method === 'GET' && parts[1] === 'config') {
    return send(res, 200, {
      online: ONLINE,
      user: user && { email: user.email, name: user.name },
      timeZone: timeZone(),
      tzOffsetMin: offsetMinutes(),
      syncEveryMin: SYNC_EVERY_MIN,
      ai: { configured: aiConfigured(), provider: aiProvider(), model: aiModel(), kinds: AI_KINDS },
    });
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
  if (req.method === 'POST' && parts[1] === 'sync') return send(res, 200, await runSync('manuelle'));
  // Google Sheet « Taux d'Occupation » : envoyé par son Apps Script (POST), relu par le Copilot local (GET)
  if (parts[1] === 'sheets') {
    if (!cloudEnabled()) return send(res, 404, { error: 'Stockage en ligne non configuré' });
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!sheetTokenOk(body.token)) return send(res, 403, { error: 'Accès refusé' });
      const sheets = { ...sheetsFromTabs(body.tabs || {}), receivedAt: new Date().toISOString() };
      if (!sheets.sprints.length) return send(res, 400, { error: 'Onglet Config vide ou illisible' });
      await putJson(SHEETS_BLOB, sheets);
      return send(res, 200, { ok: true, receivedAt: sheets.receivedAt, developers: sheets.developers.length, sprints: sheets.sprints.length, lastSprint: sheets.sprints.at(-1)?.name, meetingSprints: Object.keys(sheets.meetings).length });
    }
    if (req.method === 'GET') {
      if (!sheetTokenOk(url.searchParams.get('token'))) return send(res, 403, { error: 'Accès refusé' });
      const sheets = await getJson(SHEETS_BLOB).catch(() => null);
      return sheets ? send(res, 200, { sheets }) : send(res, 404, { error: 'Aucune donnée reçue du Google Sheet pour l’instant' });
    }
  }
  if (req.method === 'POST' && parts[1] === 'ai' && parts[2]) {
    const { kind, asOf: bodyAsOf, team: bodyTeam } = await readBody(req);
    const { dataset, analysis } = runAnalysis((bodyTeam || team).toUpperCase(), parts[2], bodyAsOf);
    return send(res, 200, await generate(kind, analysis, dataset));
  }
  return send(res, 404, { error: 'Route inconnue' });
}

/** Point d'entrée commun (serveur local et fonction Vercel). */
export function handler(req, res) {
  return route(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.message });
    else res.end();
  });
}
