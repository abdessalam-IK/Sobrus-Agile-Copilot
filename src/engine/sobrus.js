// Vue Sobrus : tous les projets sur un seul écran, pour répondre en quelques secondes à trois questions :
//   1. Nos projets avancent-ils ?
//   2. Qu'est-ce qui demande une décision cette semaine, et de qui ?
//   3. Qu'est-ce qui est en train de changer ?
// Tout le détail reste dans les pages du projet ; ici, on ne garde que l'essentiel.

import { analyze } from './index.js';

const STATUS = [
  { min: 75, id: 'ok', label: 'Dans les temps' },
  { min: 50, id: 'tension', label: 'Sous tension' },
  { min: 0, id: 'risk', label: 'En difficulté' },
];
export const statusOf = (health) => STATUS.find((s) => health >= s.min);

/** Ce qu'un projet montre sur la Vue Sobrus. */
function projectCard(dataset, analysis) {
  const { observe: o, think: t, flow, objectives, learn } = analysis;
  const m = o.metrics;
  const top = t.insights[0];
  const lastAlloc = objectives?.allocation.at(-1);
  const goal = objectives?.goals.at(-1);
  return {
    team: dataset.meta.teamKey,
    product: dataset.meta.product,
    sprint: o.sprint.name,
    sprintId: o.sprint.id,
    closed: o.closed,
    day: o.dayIndex,
    totalDays: o.totalDays,
    health: t.health,
    status: statusOf(t.health),
    done: m.doneCount,
    scope: m.scopeCount,
    expected: o.closed ? 1 : o.dayIndex / o.totalDays,
    mainPoint: top ? top.headline : 'Aucun point d’attention particulier',
    unplannedShare: m.unplannedRatio,
    linkedShare: lastAlloc?.done ? lastAlloc.linkedShare : null,
    goalSet: goal?.goalSet ?? null,
    leadToProd: flow?.cycle?.leadToProd?.median ?? null,
    change: learn.shifts.filter((s) => !s.positive).map((s) => s.title),
    progress: learn.shifts.filter((s) => s.positive).map((s) => s.title),
    syncedAt: dataset.meta.syncedAt,
  };
}

/** Intitulé d'une décision, en langage courant, selon le type de problème. */
const TOPICS = {
  scope_change: 'Le sprint déborde à cause des ajouts après le Planning',
  quality: 'Des tickets terminés reviennent en développement',
  forecast_risk: 'Risque de ne pas tout terminer d’ici la fin du sprint',
  goal_at_risk: 'Des éléments clés du sprint ne sont pas terminés',
  overload: 'Des développeurs sont en surcharge',
  aging_wip: 'Des tickets traînent en cours de développement',
  active_blockers: 'Des tickets sont bloqués',
  carryover: 'Des tickets passent de sprint en sprint',
  unlinked_work: 'Le travail livré n’est pas relié aux objectifs',
  feature_gap: 'Des fonctionnalités ne peuvent pas se terminer ce sprint',
  concentration: 'Le travail restant repose sur une seule personne',
  planning_accuracy: 'Le Planning n’est pas tenu',
  planning_share: 'Le Planning ne reflète pas le travail réel',
  estimation_gap: 'Beaucoup de tickets ne sont pas estimés',
  retro_follow_through: 'Les actions de rétro ne sont pas appliquées',
};

/**
 * Décisions à prendre : les signaux les plus graves qui appellent une action, tous projets confondus.
 * Un même type de problème dans plusieurs projets devient UNE décision qui cite chaque projet.
 * La surcharge des développeurs est calculée une seule fois, au niveau Sobrus.
 */
function decisions(items, overloaded, limit = 5) {
  const groups = new Map();
  for (const { card, signal } of items) {
    if (signal.severity < 0.5 || !signal.recommendation || signal.type === 'cross_team_overload') continue;
    const g = groups.get(signal.type) || { type: signal.type, topic: TOPICS[signal.type] || signal.title, severity: 0, action: signal.recommendation.text, owner: signal.recommendation.owner, projects: [] };
    g.severity = Math.max(g.severity, signal.severity);
    g.projects.push({ team: card.team, product: card.product, problem: signal.title });
    groups.set(signal.type, g);
  }
  const out = [...groups.values()];
  if (overloaded.length) {
    out.push({
      type: 'overload',
      topic: TOPICS.overload,
      severity: Math.min(1, 0.5 + 0.1 * overloaded.length),
      action: 'Arbitrer la charge de ces personnes avec les PO concernés avant qu’elle ne se traduise en reports.',
      owner: 'Product Owners + Scrum Master',
      projects: [{ team: null, product: overloaded.flatMap((d) => d.projects).filter((p, i, a) => a.indexOf(p) === i).join(', '), problem: `${overloaded.length} développeur${overloaded.length > 1 ? 's' : ''} en surcharge : ${overloaded.map((d) => `${d.name} (${d.projects.join(' + ')}, ×${String(d.ratio).replace('.', ',')})`).join(', ')}` }],
    });
  }
  return out.sort((a, b) => b.severity - a.severity || b.projects.length - a.projects.length).slice(0, limit);
}

export function sobrusOverview(datasets, portfolio) {
  const cards = [];
  const pool = [];
  for (const dataset of datasets) {
    const sprint = dataset.sprints.find((s) => s.status === 'active') || dataset.sprints.at(-1);
    const analysis = analyze(dataset, sprint.id, { portfolio });
    const card = projectCard(dataset, analysis);
    cards.push(card);
    for (const signal of analysis.think.signals) pool.push({ card, signal });
  }
  const counts = { ok: 0, tension: 0, risk: 0 };
  for (const c of cards) counts[c.status.id]++;
  const overloaded = (portfolio?.devs || []).filter((d) => d.overloaded).map((d) => ({
    name: d.name,
    ratio: d.ratio,
    projects: d.projects.map((p) => p.product),
  }));
  return {
    sprint: cards[0]?.sprint || null,
    cards,
    counts,
    decisions: decisions(pool, overloaded),
    overloaded,
  };
}
