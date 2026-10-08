// 05 — LEARN
// Compare les sprints entre eux. La question n'est plus « qu'avons-nous livré ? »
// mais « qu'est-ce qui est en train de changer dans notre manière de travailler ? »

import { THEMES, similar } from './understand.js';
import { mean, median, slope, round, pct } from '../lib/stats.js';

export const LEARN_METRICS = [
  { key: 'donePoints', label: 'Points livrés', better: 'up', format: 'num' },
  { key: 'velocityPerPersonDay', label: 'Points par jour-personne', better: 'up', format: 'dec' },
  { key: 'sayDo', label: 'Fiabilité de l’engagement', better: 'up', format: 'pct' },
  { key: 'scopeChangeRatio', label: 'Ajouts en cours de sprint', better: 'down', format: 'pct' },
  { key: 'avgCycleTime', label: 'Cycle time moyen (jours)', better: 'down', format: 'dec' },
  { key: 'blockedIssueDays', label: 'Jours-ticket bloqués', better: 'down', format: 'num' },
  { key: 'avgWip', label: 'Travail en cours moyen', better: 'down', format: 'dec' },
  { key: 'reopenCount', label: 'Tickets rouverts', better: 'down', format: 'num' },
  { key: 'endLoading', label: 'Livraison en fin de sprint', better: 'down', format: 'pct' },
  { key: 'carryoverPoints', label: 'Points reportés', better: 'down', format: 'num' },
  { key: 'retroActionRate', label: 'Actions de rétro réalisées', better: 'up', format: 'pct' },
];

const fmt = (v, f) => (v == null ? '—' : f === 'pct' ? pct(v) : f === 'dec' ? String(round(v, 2)) : String(round(v, 0)));

function trendOf(metric, values) {
  const vals = values.filter((v) => v != null);
  if (vals.length < 3) return null;
  const window = vals.slice(-4);
  const base = mean(window.map(Math.abs)) || 1;
  const rel = (slope(window) * (window.length - 1)) / base;
  const absolute = metric.format === 'num' && base < 2; // petits nombres : on regarde l'écart absolu
  const significant = absolute ? Math.abs(window.at(-1) - window[0]) >= 2 : Math.abs(rel) >= 0.15;
  if (!significant) return { direction: 'stable', rel, quality: 'neutral' };
  const direction = rel > 0 ? 'up' : 'down';
  return { direction, rel, quality: direction === metric.better ? 'better' : 'worse', from: window[0], to: window.at(-1) };
}

function shifts(trend) {
  const worse = (k) => trend[k]?.quality === 'worse';
  const better = (k) => trend[k]?.quality === 'better';
  const out = [];
  if ((worse('velocityPerPersonDay') || worse('sayDo')) && worse('blockedIssueDays')) {
    out.push({ title: 'D’une équipe autonome à une équipe dépendante', text: 'La baisse de livraison suit la hausse du temps bloqué : la capacité de l’équipe est de plus en plus pilotée par des acteurs externes.' });
  }
  if (worse('avgWip') && worse('avgCycleTime')) {
    out.push({ title: 'De « finir » à « commencer »', text: 'Le travail en parallèle augmente et chaque ticket met plus de temps à aboutir : l’équipe absorbe la pression en multipliant les sujets ouverts.' });
  }
  if (worse('scopeChangeRatio')) {
    out.push({ title: 'Un sprint de moins en moins protégé', text: 'Les ajouts en cours de sprint progressent : le Sprint Backlog devient une liste de départ plutôt qu’un engagement.' });
  }
  if (worse('endLoading')) {
    out.push({ title: 'Vers une mini-cascade', text: 'La livraison se concentre de plus en plus en fin de sprint : le feedback arrive tard et la qualité sert de tampon.' });
  }
  if (worse('reopenCount')) {
    out.push({ title: 'La qualité commence à céder', text: 'Les tickets rouverts augmentent : signe que la pression de délai se reporte sur les tests.' });
  }
  if (worse('retroActionRate')) {
    out.push({ title: 'Une boucle d’amélioration qui s’essouffle', text: 'De moins en moins d’actions de rétro sont réalisées : l’équipe identifie les problèmes mais ne parvient plus à les traiter.' });
  }
  for (const m of LEARN_METRICS) {
    if (better(m.key)) out.push({ title: `Progrès : ${m.label.toLowerCase()}`, text: `${m.label} évolue favorablement (${fmt(trend[m.key].from, m.format)} → ${fmt(trend[m.key].to, m.format)}).`, positive: true });
  }
  return out;
}

/**
 * @param history tableau chronologique de { snap, thought } jusqu'au sprint analysé inclus
 * @param feedback compteurs 👍/👎 par type de signal
 */
export function learn(history, { feedback = {}, dataset } = {}) {
  // Un sprint au périmètre anormalement faible (congés collectifs, sprint « vide ») fausserait les tendances
  const allClosed = history.filter((h) => h.snap.closed);
  const typicalScope = median(allClosed.map((h) => h.snap.metrics.scopePoints)) || 0;
  const atypical = allClosed.filter((h) => h.snap.metrics.scopePoints < typicalScope * 0.3);
  const closed = allClosed.filter((h) => !atypical.includes(h));
  const series = history.map(({ snap, thought }) => ({
    id: snap.sprint.id,
    name: snap.sprint.name,
    closed: snap.closed,
    atypical: atypical.some((h) => h.snap === snap),
    health: thought.health,
    metrics: Object.fromEntries(LEARN_METRICS.map((m) => [m.key, snap.metrics[m.key]])),
    committedPoints: snap.metrics.committedPoints,
    themes: Object.fromEntries(Object.keys(THEMES).map((t) => [t, thought.insights.find((i) => i.theme === t)?.severity || 0])),
  }));

  const trend = {};
  for (const m of LEARN_METRICS) {
    const t = trendOf(m, closed.map((h) => h.snap.metrics[m.key]));
    if (t) trend[m.key] = t;
  }

  // Patterns persistants
  const patterns = [];
  const depSprints = new Map();
  for (const { snap } of history) {
    for (const dep of new Set(snap.issues.flatMap((i) => i.blocks.map((b) => b.dependency)).filter(Boolean))) {
      depSprints.set(dep, [...(depSprints.get(dep) || []), snap.sprint.name]);
    }
  }
  for (const [dep, names] of depSprints) {
    if (names.length >= 2) patterns.push({ type: 'dependency', title: `« ${dep} » bloque l’équipe de façon récurrente`, detail: `Présent dans ${names.length} sprints : ${names.join(', ')}.` });
  }
  const actions = closed.flatMap((h) => (h.snap.retro?.actions || []).map((a) => ({ ...a, sprint: h.snap.sprint.name })));
  const clusters = [];
  for (const a of actions) {
    const c = clusters.find((cl) => similar(cl[0].text, a.text) >= 0.6);
    if (c) c.push(a);
    else clusters.push([a]);
  }
  for (const c of clusters) {
    if (c.length >= 2 && c.some((a) => a.status !== 'done')) {
      patterns.push({ type: 'retro', title: `Action de rétro récurrente : « ${c[0].text} »`, detail: `Décidée ${c.length} fois (${c.map((a) => a.sprint).join(', ')}), jamais réalisée.` });
    }
  }
  const scopeHits = closed.filter((h) => h.snap.metrics.scopeChangeRatio >= 0.1);
  if (scopeHits.length >= 2) patterns.push({ type: 'scope', title: 'Ajouts en cours de sprint récurrents', detail: `${scopeHits.length} sprints sur ${closed.length} ont reçu plus de 10 % d’ajouts (${scopeHits.map((h) => h.snap.sprint.name).join(', ')}).` });
  // Tickets reportés au moins 2 fois : on garde leur dernière apparition, et on ne retient que ceux toujours ouverts
  const lastSeen = new Map();
  for (const { snap } of history) for (const i of snap.issues) lastSeen.set(i.key, i);
  const zombies = [...lastSeen.values()].filter((i) => i.carriedOver >= 2 && !i.done);
  const finishedLate = [...lastSeen.values()].filter((i) => i.carriedOver >= 2 && i.done);
  if (zombies.length) {
    patterns.push({ type: 'carryover', title: `${zombies.length} ticket(s) traversent les sprints sans aboutir`, detail: zombies.map((i) => `${i.key} « ${i.title} » (reporté ${i.carriedOver} fois)`).join(' ; ') });
  }
  if (finishedLate.length >= 3) {
    patterns.push({ type: 'carryover', title: `${finishedLate.length} tickets n’ont abouti qu’après 2 reports ou plus`, detail: 'Signe de tickets trop gros ou démarrés trop tôt : à surveiller au découpage.' });
  }

  // Thème dominant : comment le centre de gravité des difficultés se déplace
  const dominant = series.map((s) => {
    const [theme, sev] = Object.entries(s.themes).sort((a, b) => b[1] - a[1])[0];
    return { sprint: s.name, theme: sev > 0 ? theme : null, label: sev > 0 ? THEMES[theme].label : 'Aucun signal' };
  });

  const shiftList = shifts(trend);
  const negatives = shiftList.filter((s) => !s.positive);
  const headline = closed.length < 3
    ? 'Pas encore assez de sprints terminés pour dégager des tendances fiables (minimum 3).'
    : negatives.length
      ? `Sur les ${Math.min(4, closed.length)} derniers sprints, la manière de travailler évolue : ${negatives.map((s) => s.title.toLowerCase()).join(' ; ')}.`
      : 'La manière de travailler est stable ou s’améliore sur les derniers sprints.';

  // Mémoire d'apprentissage : ce que l'équipe a jugé utile
  const learningMemory = Object.entries(feedback)
    .map(([type, f]) => ({ type, useful: f.useful, notUseful: f.notUseful, weight: round(0.5 + (f.useful + 1) / (f.useful + f.notUseful + 2), 2) }))
    .sort((a, b) => b.useful + b.notUseful - (a.useful + a.notUseful));

  return {
    headline,
    series,
    metrics: LEARN_METRICS,
    trend,
    shifts: shiftList,
    patterns,
    dominant,
    learningMemory,
    sprintsAnalysed: closed.length,
    excluded: atypical.map((h) => ({ name: h.snap.sprint.name, reason: `périmètre de ${h.snap.metrics.scopePoints} pts contre ~${Math.round(typicalScope)} habituellement` })),
  };
}
