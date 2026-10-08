// Découverte (lecture seule) de l'usage Linear d'une équipe : statuts, labels,
// estimation, cycles, structure parent / sous-issues. Sert à valider la correspondance
// avec le modèle du Copilot avant d'écrire le connecteur.
// Usage : node scripts/linear-discover.js "Sobrus Supply"

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv, linear, paginate } from '../src/adapters/linear-client.js';

loadEnv();
const teamName = process.argv[2] || 'Sobrus Supply';

const { viewer, teams } = await linear(`{
  viewer { name organization { name urlKey } }
  teams(first: 100) { nodes { id key name } }
}`);
console.log(`Connecté : ${viewer.name} — organisation « ${viewer.organization.name} »`);
console.log(`Équipes visibles : ${teams.nodes.map((t) => `${t.name} (${t.key})`).join(', ')}\n`);

const team = teams.nodes.find((t) => t.name.toLowerCase() === teamName.toLowerCase()) || teams.nodes.find((t) => t.name.toLowerCase().includes(teamName.toLowerCase()));
if (!team) throw new Error(`Équipe « ${teamName} » introuvable`);

const { team: t } = await linear(`query($id: String!) {
  team(id: $id) {
    id key name cyclesEnabled cycleDuration cycleStartDay cycleCooldownTime
    issueEstimationType issueEstimationAllowZero issueEstimationExtended
    states { nodes { id name type position } }
    members { nodes { id name displayName active } }
  }
}`, { id: team.id });

const labels = await paginate(`query($id: String!, $first: Int, $after: String) {
  team(id: $id) { labels(first: $first, after: $after) { nodes { name parent { name } } pageInfo { hasNextPage endCursor } } }
}`, { id: team.id }, (d) => d.team.labels);

const cycles = await paginate(`query($id: String!, $first: Int, $after: String) {
  team(id: $id) { cycles(first: $first, after: $after) { nodes { id number name description startsAt endsAt completedAt progress } pageInfo { hasNextPage endCursor } } }
}`, { id: team.id }, (d) => d.team.cycles, 50);
cycles.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

const now = new Date().toISOString();
const current = cycles.find((c) => c.startsAt <= now && now < c.endsAt) || cycles.filter((c) => c.startsAt <= now).at(-1);
const sampleCycles = cycles.filter((c) => c.startsAt <= now).slice(-3);

const issueQuery = `query($id: String!, $first: Int, $after: String) {
  cycle(id: $id) { issues(first: $first, after: $after) { nodes {
    identifier estimate priority
    state { name type }
    parent { identifier }
    children { nodes { identifier } }
    assignee { id }
    labels { nodes { name } }
    project { name }
  } pageInfo { hasNextPage endCursor } } }
}`;
const stats = [];
for (const c of sampleCycles) {
  const issues = await paginate(issueQuery, { id: c.id }, (d) => d.cycle.issues);
  const parents = issues.filter((i) => i.children.nodes.length);
  const subs = issues.filter((i) => i.parent);
  const standalone = issues.filter((i) => !i.parent && !i.children.nodes.length);
  const est = (arr) => ({ n: arr.length, estimated: arr.filter((i) => i.estimate != null).length, points: arr.reduce((a, i) => a + (i.estimate || 0), 0) });
  const byState = {};
  for (const i of issues) byState[`${i.state.name} [${i.state.type}]`] = (byState[`${i.state.name} [${i.state.type}]`] || 0) + 1;
  const byLabel = {};
  for (const i of issues) for (const l of i.labels.nodes) byLabel[l.name] = (byLabel[l.name] || 0) + 1;
  const estimateValues = {};
  for (const i of issues) estimateValues[i.estimate ?? 'aucune'] = (estimateValues[i.estimate ?? 'aucune'] || 0) + 1;
  stats.push({
    cycle: c.name || `Cycle ${c.number}`,
    total: issues.length,
    parents: est(parents),
    subIssues: est(subs),
    standalone: est(standalone),
    subsWhoseParentOutsideCycle: subs.filter((s) => !issues.some((i) => i.identifier === s.parent.identifier)).length,
    byState,
    estimateValues,
    topLabels: Object.entries(byLabel).sort((a, b) => b[1] - a[1]).slice(0, 15),
    projects: [...new Set(issues.map((i) => i.project?.name).filter(Boolean))],
  });
}

const day = (s) => s?.slice(0, 10);
console.log(`=== Équipe ${t.name} (${t.key}) ===`);
console.log(`Cycles : ${t.cyclesEnabled ? 'activés' : 'désactivés'} · durée ${t.cycleDuration} sem. · jour de départ ${t.cycleStartDay} · cooldown ${t.cycleCooldownTime} sem.`);
console.log(`Estimation : ${t.issueEstimationType} · zéro autorisé ${t.issueEstimationAllowZero} · étendue ${t.issueEstimationExtended}`);
console.log(`Membres : ${t.members.nodes.filter((m) => m.active).length} actifs`);
console.log('\nStatuts (ordre du workflow) :');
for (const s of [...t.states.nodes].sort((a, b) => a.position - b.position)) console.log(`  - ${s.name}  [${s.type}]`);
console.log(`\nLabels (${labels.length}) : ${labels.map((l) => (l.parent ? `${l.parent.name}/${l.name}` : l.name)).join(', ')}`);
console.log(`\nCycles (${cycles.length}, 8 derniers) :`);
for (const c of cycles.slice(-8)) console.log(`  - ${(c.name || `Cycle ${c.number}`).padEnd(16)} ${day(c.startsAt)} → ${day(c.endsAt)}${c.completedAt ? ' (terminé)' : ''}${c === current ? '  ← en cours' : ''}${c.description ? ' · objectif renseigné' : ''}`);
for (const s of stats) {
  console.log(`\n--- ${s.cycle} : ${s.total} issues ---`);
  console.log(`  Parents : ${s.parents.n} (${s.parents.estimated} estimés, ${s.parents.points} pts) · Sous-issues : ${s.subIssues.n} (${s.subIssues.estimated} estimées, ${s.subIssues.points} pts) · Autonomes : ${s.standalone.n} (${s.standalone.estimated} estimées, ${s.standalone.points} pts)`);
  console.log(`  Sous-issues dont le parent est hors cycle : ${s.subsWhoseParentOutsideCycle}`);
  console.log(`  Statuts : ${Object.entries(s.byState).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  Valeurs d'estimation : ${Object.entries(s.estimateValues).map(([k, v]) => `${k}:${v}`).join(', ')}`);
  console.log(`  Labels fréquents : ${s.topLabels.map(([k, v]) => `${k}(${v})`).join(', ') || '—'}`);
  console.log(`  Projets : ${s.projects.join(', ') || '—'}`);
}

mkdirSync('data/private', { recursive: true });
writeFileSync('data/private/linear-discovery.json', JSON.stringify({ team: t, labels, cycles, stats }, null, 2));
console.log('\nDétail complet : data/private/linear-discovery.json (non versionné)');
