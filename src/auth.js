// Connexion Google réservée aux comptes Sobrus, pour la version en ligne.
// Active uniquement si GOOGLE_CLIENT_ID est défini (en local, pas de connexion).
//
// Flux OAuth 2.0 « authorization code » sans dépendance :
//   /auth/login    → Google (compte @sobrus.com)
//   /auth/callback → échange du code contre l'id_token (directement auprès de Google, en HTTPS),
//                    vérification du domaine, puis cookie de session signé (HMAC-SHA256).
//   /auth/logout   → suppression du cookie.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'copilot_session';
const STATE_COOKIE = 'copilot_oauth_state';
const SESSION_DAYS = 7;

export const authEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID);

/** Domaine Google Workspace autorisé, et liste blanche optionnelle d'adresses (séparées par des virgules). */
const allowedDomain = () => (process.env.ALLOWED_DOMAIN || 'sobrus.com').toLowerCase();
const allowedEmails = () => (process.env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw Object.assign(new Error('SESSION_SECRET manquant ou trop court (32 caractères minimum).'), { status: 500 });
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https';
const origin = (req) => process.env.PUBLIC_URL?.replace(/\/$/, '') || `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
const redirectUri = (req) => `${origin(req)}/auth/callback`;

function cookie(req, name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}

/** Utilisateur connecté (cookie valide et non expiré), sinon null. */
export function currentUser(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return user.exp > Date.now() && isAllowed(user.email) ? user : null;
  } catch {
    return null;
  }
}

function isAllowed(email = '') {
  const e = email.toLowerCase();
  const list = allowedEmails();
  if (list.length) return list.includes(e);
  return e.endsWith(`@${allowedDomain()}`);
}

const redirect = (res, location, cookies = []) => {
  res.writeHead(302, { Location: location, 'Set-Cookie': cookies, 'Cache-Control': 'no-store' });
  res.end();
};

const page = (res, status, message, cookies = []) => {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': cookies });
  res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sobrus AI Copilot</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#1d2433;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border:1px solid #e3e6eb;border-radius:12px;padding:28px;max-width:420px}a{color:#2563eb}</style>
</head><body><main><h1 style="font-size:18px;margin-top:0">Sobrus AI Copilot</h1><p>${message}</p><p><a href="/auth/login">Se connecter avec un compte Sobrus</a></p></main></body></html>`);
};

/** Gère /auth/*. Renvoie true si la requête a été traitée. */
export async function handleAuth(req, res, url) {
  if (url.pathname === '/auth/login') {
    const state = b64url(randomBytes(24));
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(req),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      hd: allowedDomain(),
    });
    redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, [cookie(req, STATE_COOKIE, state, 600)]);
    return true;
  }

  if (url.pathname === '/auth/callback') {
    const clearState = cookie(req, STATE_COOKIE, '', 0);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!code || !state || state !== parseCookies(req)[STATE_COOKIE]) {
      page(res, 400, 'La connexion a expiré ou n’a pas abouti. Réessayez.');
      return true;
    }
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.id_token) {
      page(res, 502, 'Google n’a pas confirmé la connexion. Réessayez dans un instant.');
      return true;
    }
    // id_token reçu directement de Google en HTTPS : on vérifie l'émetteur, le destinataire, l'expiration et le domaine
    const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
    const valid = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
      && claims.aud === process.env.GOOGLE_CLIENT_ID
      && claims.exp * 1000 > Date.now()
      && claims.email_verified === true
      && claims.hd === allowedDomain()
      && isAllowed(claims.email);
    if (!valid) {
      page(res, 403, `Accès réservé aux responsables Sobrus (compte @${allowedDomain()} autorisé).`);
      return true;
    }
    const user = { email: claims.email.toLowerCase(), name: claims.name || claims.email, exp: Date.now() + SESSION_DAYS * 864e5 };
    const payload = b64url(JSON.stringify(user));
    redirect(res, '/', [clearState, cookie(req, COOKIE, `${payload}.${sign(payload)}`, SESSION_DAYS * 86400)]);
    return true;
  }

  if (url.pathname === '/auth/logout') {
    page(res, 200, 'Vous êtes déconnecté.', [cookie(req, COOKIE, '', 0)]);
    return true;
  }
  return false;
}
