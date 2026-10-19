// 03 — THINK
// Relie les signaux entre eux et produit des insights lisibles :
// « Ce Sprint présente trois signaux nécessitant une attention particulière. »
// La pondération tient compte du feedback humain (brique LEARN) : un type de signal
// jugé peu utile par l'équipe pèse moins lourd, un signal jugé utile pèse davantage.

import { THEMES } from './understand.js';
import { round, clamp01, pct } from '../lib/stats.js';

const LEVELS = [
  { min: 0.7, id: 'critical', label: 'Critique' },
  { min: 0.5, id: 'attention', label: 'Attention' },
  { min: 0.3, id: 'watch', label: 'À surveiller' },
  { min: 0, id: 'info', label: 'Info' },
];
export const levelOf = (s) => LEVELS.find((l) => s >= l.min);

/** Poids appris à partir des retours 👍/👎 sur chaque type de signal. */
export function feedbackWeight(feedback, type) {
  const f = feedback?.[type];
  if (!f) return 1;
  const ratio = (f.useful + 1) / (f.useful + f.notUseful + 2); // lissage de Laplace
  return round(0.5 + ratio, 2); // 0.5 … 1.5
}

/** Lecture transverse : quand plusieurs thèmes se combinent, le sens change. */
function crossReadings(byTheme, signals) {
  const has = (t) => signals.some((s) => s.type === t);
  const out = [];
  if (has('recurring_dependency') && (has('goal_at_risk') || has('velocity_drop') || has('forecast_risk'))) {
    out.push('La dépendance externe n’est plus un incident : elle pilote désormais la capacité de l’équipe à tenir ses objectifs.');
  }
  if (has('wip_overload') && (has('stuck_issues') || has('end_loaded'))) {
    out.push('Beaucoup de travail commencé, peu de travail fini : l’équipe semble compenser les blocages en ouvrant de nouveaux sujets, ce qui allonge tous les délais.');
  }
  if (has('scope_change') && has('retro_follow_through')) {
    out.push('Les interruptions reviennent alors qu’une protection (buffer) avait été décidée en rétro sans être appliquée.');
  }
  if (has('requirement_churn') && has('carryover')) {
    out.push('Les tickets qui glissent sont aussi ceux dont le besoin change : le problème se situe probablement en amont du sprint (affinage), pas dans l’exécution.');
  }
  if (has('quality') && (has('scope_change') || has('end_loaded'))) {
    out.push('Les régressions apparaissent dans un contexte de pression (urgences, fin de sprint) : la qualité sert de variable d’ajustement.');
  }
  if (has('concentration') && has('absence_risk')) {
    out.push('La charge est concentrée alors qu’une absence approche : le risque porte sur les personnes autant que sur le planning.');
  }
  return out;
}

// Santé = 60 % avancement + 40 % signaux, sans double comptage :
//  - les signaux dérivés de l'avancement (prévision, retard sur la trajectoire) ne comptent que dans l'avancement ;
//  - un seul retrait par thème (le signal le plus grave du thème), pas un par signal.
export const HEALTH_WEIGHTS = { progress: 0.6, signals: 0.4 };
const PROGRESS_SIGNALS = new Set(['forecast_risk', 'burndown_gap']);

function computeHealth(snap, signals) {
  const m = snap.metrics;
  // Avancement en tickets ; les points s'y ajoutent quand au moins 75 % des tickets sont estimés.
  const estimated = snap.issues.filter((i) => i.points != null).length / Math.max(1, snap.issues.length);
  const ticketRatio = m.doneCount / Math.max(1, m.scopeCount);
  const completion = estimated >= 0.75 && m.scopePoints ? (ticketRatio + m.donePoints / m.scopePoints) / 2 : ticketRatio;
  const expected = snap.closed ? 1 : snap.dayIndex / snap.totalDays;
  // Chaque point de pourcentage de retard sur l'attendu coûte 2 points (en avance = 100).
  const progress = Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, expected - completion) * 200)));

  const byTheme = new Map();
  for (const s of signals) {
    if (PROGRESS_SIGNALS.has(s.type)) continue;
    if (!byTheme.has(s.theme) || byTheme.get(s.theme).severity < s.severity) byTheme.set(s.theme, s);
  }
  let level = 100;
  const themes = [...byTheme.values()].sort((a, b) => b.severity - a.severity).map((s) => {
    const before = level;
    level *= 1 - 0.25 * s.severity;
    return { theme: s.theme, label: THEMES[s.theme].label, signal: s.title, severity: s.severity, cost: round(before - level, 1) };
  });
  const signalScore = Math.round(level);
  return {
    score: Math.round(HEALTH_WEIGHTS.progress * progress + HEALTH_WEIGHTS.signals * signalScore),
    weights: HEALTH_WEIGHTS,
    progress: { score: progress, completion: round(completion, 3), expected: round(expected, 3), unit: estimated >= 0.75 ? 'tickets et points' : 'tickets' },
    signals: { score: signalScore, themes, excluded: signals.filter((s) => PROGRESS_SIGNALS.has(s.type)).map((s) => s.title) },
  };
}

export function think(snap, rawSignals, { feedback } = {}) {
  const signals = rawSignals
    .map((s) => {
      const weight = feedbackWeight(feedback, s.type);
      const severity = round(clamp01(s.severity * weight), 2);
      return { ...s, weight, severity, level: levelOf(severity) };
    })
    .sort((a, b) => b.severity - a.severity);

  const byTheme = new Map();
  for (const s of signals) {
    if (!byTheme.has(s.theme)) byTheme.set(s.theme, []);
    byTheme.get(s.theme).push(s);
  }

  const insights = [...byTheme]
    .map(([theme, list]) => {
      const severity = round(clamp01(list[0].severity + 0.08 * (list.length - 1)), 2);
      return {
        theme,
        label: THEMES[theme].label,
        icon: THEMES[theme].icon,
        severity,
        level: levelOf(severity),
        headline: list[0].title,
        narrative: list.map((s) => s.narrative).join(' '),
        signals: list,
        questions: [...new Set(list.map((s) => s.question))],
      };
    })
    .sort((a, b) => b.severity - a.severity);

  // On ne met en avant que l'essentiel (3 thèmes maximum) : un copilote qui alerte sur tout n'aide personne.
  const attention = insights.filter((i) => i.severity >= 0.6).slice(0, 3);
  const watch = insights.filter((i) => !attention.includes(i));
  const n = attention.length;
  const numbers = ['aucun', 'un', 'deux', 'trois'];
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  // Titre structuré : chaque point renvoie à ses précisions (tickets, preuves) ; les points
  // « à surveiller » sont nommés, jamais seulement comptés.
  const headlineParts = {
    intro: n
      ? `${snap.sprint.name} présente ${numbers[n]} signa${n > 1 ? 'ux' : 'l'} nécessitant une attention particulière`
      : insights.length
        ? `${snap.sprint.name} ne présente pas de signal majeur`
        : `${snap.sprint.name} ne présente aucun signal particulier`,
    items: attention.map((i) => ({ theme: i.theme, text: lower(i.headline) })),
    watch: watch.map((i) => ({ theme: i.theme, label: i.label, text: lower(i.headline) })),
  };
  const headline = `${headlineParts.intro}${n ? ` : ${headlineParts.items.map((x) => x.text).join(' ; ')}` : ''}.${watch.length ? ` À surveiller : ${watch.map((x) => x.label.toLowerCase()).join(', ')}.` : ''}`;

  const healthBreakdown = computeHealth(snap, signals);
  const health = healthBreakdown.score;

  const recommendations = [];
  for (const s of signals) {
    if (!s.recommendation || recommendations.some((r) => r.text === s.recommendation.text)) continue;
    recommendations.push({ ...s.recommendation, because: s.title, severity: s.severity, signalType: s.type });
  }

  const m = snap.metrics;
  const facts = snap.closed
    ? [
        `${m.doneCount}/${m.scopeCount} tickets livrés`,
        `${m.donePoints}/${m.scopePoints} points estimés livrés`,
        `Fiabilité de l’engagement : ${pct(m.sayDo)}`,
        `Objectif : ${m.goalDone}/${m.goalTotal} éléments clés terminés`,
      ]
    : [
        `Jour ${snap.dayIndex}/${snap.totalDays}`,
        `${m.doneCount}/${m.scopeCount} tickets terminés`,
        `${m.donePoints}/${m.scopePoints} points estimés terminés`,
        snap.features?.length ? `${snap.features.filter((f) => f.complete).length}/${snap.features.length} fonctionnalités terminées (tous sous-tickets)` : null,
        m.openUnestimated ? `${m.openUnestimated} ticket(s) restant(s) sans estimation` : null,
        snap.forecast ? `Probabilité de tout terminer : ${pct(snap.forecast.probability)} (calcul en ${snap.forecast.unit})` : null,
      ].filter(Boolean);

  return {
    headline,
    headlineParts,
    priorities: attention.map((i) => i.theme),
    health,
    healthBreakdown,
    healthLabel: health >= 75 ? 'Sain' : health >= 50 ? 'Sous tension' : 'En difficulté',
    facts,
    insights,
    signals,
    crossReadings: crossReadings(byTheme, signals),
    recommendations: recommendations.slice(0, 6),
  };
}
