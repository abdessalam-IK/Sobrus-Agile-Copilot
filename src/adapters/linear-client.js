// Client GraphQL Linear minimal (lecture seule).
// La clé est lue depuis LINEAR_API_KEY (fichier .env, jamais commité).

import { existsSync } from 'node:fs';

const ENDPOINT = 'https://api.linear.app/graphql';

export function loadEnv() {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export async function linear(query, variables = {}) {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error('LINEAR_API_KEY manquante (fichier .env)');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    const msg = body.errors?.map((e) => e.message).join(' ; ') || res.statusText;
    throw new Error(`Linear ${res.status} : ${msg}`);
  }
  return body.data;
}

/** Parcourt une connexion paginée Linear. `pick` extrait la connexion depuis `data`. */
export async function paginate(query, variables, pick, pageSize = 100) {
  const out = [];
  let after = null;
  for (;;) {
    const conn = pick(await linear(query, { ...variables, first: pageSize, after }));
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) return out;
    after = conn.pageInfo.endCursor;
  }
}
