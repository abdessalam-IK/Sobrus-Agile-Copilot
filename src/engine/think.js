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
  const others = insights.length - attention.length;
  const n = attention.length;
  const numbers = ['aucun', 'un', 'deux', 'trois'];
  const headline = n
    ? `${snap.sprint.name} présente ${numbers[n]} signa${n > 1 ? 'ux' : 'l'} nécessitant une attention particulière : ${attention.map((i) => i.headline.charAt(0).toLowerCase() + i.headline.slice(1)).join(' ; ')}.${others ? ` ${others} autre${others > 1 ? 's' : ''} point${others > 1 ? 's' : ''} à surveiller.` : ''}`
    : insights.length
      ? `${snap.sprint.name} ne présente pas de signal majeur ; ${insights.length} point(s) à surveiller.`
      : `${snap.sprint.name} ne présente aucun signal particulier.`;

  // Chaque signal « consomme » une part de la santé restante (rendements décroissants).
  const health = Math.round(100 * signals.reduce((h, s) => h * (1 - 0.15 * s.severity), 1));

  const recommendations = [];
  for (const s of signals) {
    if (!s.recommendation || recommendations.some((r) => r.text === s.recommendation.text)) continue;
    recommendations.push({ ...s.recommendation, because: s.title, severity: s.severity, signalType: s.type });
  }

  const m = snap.metrics;
  const facts = snap.closed
    ? [
        `${m.donePoints}/${m.scopePoints} points livrés (${pct(m.completionRatio)})`,
        `Fiabilité de l’engagement : ${pct(m.sayDo)}`,
        `Objectif : ${m.goalDone}/${m.goalTotal} éléments clés terminés`,
      ]
    : [
        `Jour ${snap.dayIndex}/${snap.totalDays}`,
        `${m.donePoints}/${m.scopePoints} points terminés`,
        snap.forecast ? `Probabilité de tout terminer : ${pct(snap.forecast.probability)}` : null,
      ].filter(Boolean);

  return {
    headline,
    priorities: attention.map((i) => i.theme),
    health,
    healthLabel: health >= 75 ? 'Sain' : health >= 50 ? 'Sous tension' : 'En difficulté',
    facts,
    insights,
    signals,
    crossReadings: crossReadings(byTheme, signals),
    recommendations: recommendations.slice(0, 6),
  };
}
