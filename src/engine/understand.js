// 02 — UNDERSTAND
// Détecteurs de patterns. Chaque détecteur lit l'instantané du sprint (et l'historique)
// et renvoie des « signaux » : un fait observé + des preuves + une question à poser.
// Un signal n'est jamais un verdict : c'est une invitation à regarder.

import { sum, mean, median, quantile, clamp01, round, pct, seededRandom } from '../lib/stats.js';
import { ACTIVE_STATUSES, STATUS_LABELS } from './observe.js';
import { agingWip, unplanned, originOf } from './flow.js';

export const THEMES = {
  flow: { label: 'Flux de travail', icon: '⇄' },
  dependencies: { label: 'Dépendances & blocages', icon: '⛓' },
  scope: { label: 'Périmètre & besoin', icon: '◎' },
  predictability: { label: 'Prévisibilité', icon: '◷' },
  quality: { label: 'Qualité', icon: '✓' },
  team: { label: 'Équipe & charge', icon: '☺' },
  improvement: { label: 'Amélioration continue', icon: '↻' },
  stakeholders: { label: 'Parties prenantes', icon: '☊' },
};

const pts = (i) => i.points || 0;
const keys = (issues) => issues.map((i) => i.key);
const plural = (n, word, pluralWord = `${word}s`) => `${n} ${n > 1 ? pluralWord : word}`;

function signal(s) {
  return {
    evidence: [],
    issues: [],
    hypotheses: [],
    ...s,
    severity: round(clamp01(s.severity), 2),
  };
}

// ---------------------------------------------------------------------------
// Détecteurs
// ---------------------------------------------------------------------------

/**
 * Âge du travail en cours : un ticket en cours depuis plus longtemps que 85 % des tickets habituels
 * de l'équipe a de fortes chances de déborder. Alerte plus fiable qu'un seuil fixe de jours.
 */
function agingWipSignal(snap, ctx, names) {
  if (snap.closed) return [];
  const { thresholds: th, items } = agingWip(snap, ctx.previous, ctx.dataset.meta?.holidays || []);
  const risky = items.filter((i) => i.level === 'risk');
  if (!risky.length) return [];
  return [signal({
    type: 'aging_wip', theme: 'flow',
    severity: 0.3 + 0.12 * risky.length + 0.03 * Math.max(...risky.map((i) => i.age - th.p85)),
    title: `${plural(risky.length, 'ticket en cours depuis', 'tickets en cours depuis')} plus de ${th.p85} jours, plus longtemps que 85 % des tickets habituels`,
    narrative: `D’habitude, la moitié des tickets se terminent en ${th.p50} jour${th.p50 > 1 ? 's' : ''} ouvré${th.p50 > 1 ? 's' : ''} et 85 % en ${th.p85} jours${th.fallback ? ' (seuils par défaut : pas encore assez d’historique)' : ` (calculé sur ${th.basedOn} tickets terminés)`}. Au-delà, un ticket risque fort de déborder du sprint.`,
    evidence: risky.map((i) => `${i.key} — en cours depuis ${i.age} j${i.blocked ? ' (bloqué)' : ''} (${names(i.assignee)}) — ${i.title}`),
    issues: risky.map((i) => i.key),
    question: 'Qu’est-ce qui empêche ces tickets de se terminer ? Faut-il les découper, aider la personne, ou lever un blocage non dit ?',
    recommendation: { text: 'Traiter les tickets les plus âgés en début de Daily, avant d’en démarrer de nouveaux.', owner: 'Équipe' },
  })];
}

/** Blocages en cours et temps perdu en blocage. */
function blockers(snap) {
  const out = [];
  const now = snap.issues.filter((i) => i.blockedNow);
  if (now.length && !snap.closed) {
    const ext = now.filter((i) => i.currentBlock?.dependency);
    out.push(signal({
      type: 'active_blockers', theme: 'dependencies',
      severity: 0.35 + 0.15 * now.length + 0.04 * Math.max(...now.map((i) => i.blockedDays)) + (now.some((i) => i.goal) ? 0.15 : 0),
      title: `${plural(now.length, 'ticket bloqué', 'tickets bloqués')} en ce moment${ext.length ? ` (dont ${ext.length} par une dépendance externe)` : ''}`,
      narrative: `Des tickets${now.some((i) => i.goal) ? ' liés à l’objectif du sprint' : ''} sont bloqués depuis ${Math.max(...now.map((i) => i.blockedDays))} jours au plus.`,
      evidence: now.map((i) => `${i.key} — bloqué depuis ${i.blockedDays} j : ${i.currentBlock?.reason || 'raison non précisée'}${i.currentBlock?.dependency ? ` [${i.currentBlock.dependency}]` : ''}`),
      issues: keys(now),
      question: 'Quelle est la prochaine action concrète pour lever chaque blocage, et qui la porte ?',
      recommendation: { text: 'Nommer un responsable et une échéance pour chaque blocage ; escalader au-delà de 48h.', owner: 'Scrum Master' },
    }));
  }
  if (snap.closed && snap.metrics.blockedIssueDays >= 5) {
    const blocked = snap.issues.filter((i) => i.blockedDays > 0);
    out.push(signal({
      type: 'blocked_time', theme: 'dependencies',
      severity: 0.25 + 0.04 * snap.metrics.blockedIssueDays,
      title: `${snap.metrics.blockedIssueDays} jours-ticket perdus en blocage`,
      narrative: `Les blocages ont immobilisé ${plural(blocked.length, 'ticket')} pendant ${snap.metrics.blockedIssueDays} jours-ticket au total.`,
      evidence: blocked.map((i) => `${i.key} — ${i.blockedDays} j : ${i.blocks.map((b) => b.reason).join(' ; ')}`),
      issues: keys(blocked),
      question: 'Quels blocages auraient pu être anticipés dès le Planning ?',
      recommendation: { text: 'Ajouter une vérification des dépendances externes dans la Definition of Ready.', owner: 'Product Owner' },
    }));
  }
  return out;
}

/** Une même dépendance externe concentre les blocages : goulot d'étranglement. */
function dependencyBottleneck(snap) {
  const byDep = new Map();
  for (const i of snap.issues) {
    for (const b of i.blocks) {
      if (!b.dependency) continue;
      const e = byDep.get(b.dependency) || { issues: new Set(), days: 0 };
      e.issues.add(i.key);
      byDep.set(b.dependency, e);
    }
  }
  for (const i of snap.issues) {
    for (const [dep, e] of byDep) if (e.issues.has(i.key)) e.days += i.blockedDays;
  }
  return [...byDep]
    .filter(([, e]) => e.issues.size >= 2 || e.days >= 3)
    .map(([dep, e]) => signal({
      type: 'dependency_bottleneck', theme: 'dependencies',
      severity: 0.3 + 0.1 * e.issues.size + 0.03 * e.days,
      title: `Goulot externe : « ${dep} »`,
      narrative: `« ${dep} » bloque ${plural(e.issues.size, 'ticket')} (${e.days} jours-ticket) : l’avancement dépend d’un acteur hors de l’équipe.`,
      evidence: [...e.issues].map((k) => `${k}`),
      issues: [...e.issues],
      question: `Avons-nous un interlocuteur, un engagement de date et un plan B pour « ${dep} » ?`,
      recommendation: { text: `Contractualiser un SLA / point de synchronisation avec « ${dep} » et préparer un mock pour découpler le développement.`, owner: 'Product Owner' },
      meta: { dependency: dep },
    }));
}

/** La même dépendance revient sprint après sprint : le problème devient structurel. */
function recurringDependency(snap, ctx) {
  const current = new Set(snap.issues.flatMap((i) => i.blocks.map((b) => b.dependency)).filter(Boolean));
  const out = [];
  for (const dep of current) {
    const past = ctx.previous.filter((p) => p.issues.some((i) => i.blocks.some((b) => b.dependency === dep)));
    if (!past.length) continue;
    out.push(signal({
      type: 'recurring_dependency', theme: 'dependencies',
      severity: 0.5 + 0.15 * past.length,
      title: `« ${dep} » bloque l’équipe pour le ${past.length + 1}e sprint`,
      narrative: `Ce n’est plus un incident ponctuel : « ${dep} » a déjà bloqué l’équipe en ${past.map((p) => p.sprint.name).join(', ')}.`,
      evidence: past.map((p) => `${p.sprint.name} : ${p.issues.filter((i) => i.blocks.some((b) => b.dependency === dep)).map((i) => i.key).join(', ')}`),
      issues: snap.issues.filter((i) => i.blocks.some((b) => b.dependency === dep)).map((i) => i.key),
      question: 'Que ferions-nous différemment si nous considérions cette dépendance comme un risque permanent ?',
      hypotheses: ['Le partenaire n’a pas la même priorité que nous', 'Aucun canal d’escalade formel n’existe', 'Nous planifions des tickets dépendants sans confirmation préalable'],
      recommendation: { text: `Traiter « ${dep} » comme un risque produit : le porter au niveau management et ne plus planifier de ticket dépendant sans confirmation écrite.`, owner: 'Product Owner + Management' },
      meta: { dependency: dep, sprints: past.length + 1 },
    }));
  }
  return out;
}

/** Trop de travail commencé en parallèle. */
function wipOverload(snap, ctx, names) {
  const out = [];
  const overloaded = snap.load.filter((l) => l.wip > 2);
  const histWip = mean(ctx.previous.map((p) => p.metrics.avgWip).filter((x) => x != null));
  const teamSize = snap.load.filter((l) => !l.outside).length;
  const wipNow = snap.issues.filter((i) => ACTIVE_STATUSES.includes(i.status)).length;
  const wipRef = snap.closed ? snap.metrics.avgWip : wipNow;
  if (overloaded.length && wipRef <= teamSize * 1.4) {
    // WIP d'équipe normal, mais certaines personnes mènent trop de sujets de front
    const maxWip = Math.max(...overloaded.map((l) => l.wip));
    out.push(signal({
      type: 'wip_individual', theme: 'flow',
      severity: 0.2 + 0.1 * (maxWip - 2) + 0.05 * overloaded.length,
      title: `${plural(overloaded.length, 'personne mène', 'personnes mènent')} plus de 2 tickets de front`,
      narrative: `Le travail en cours de l’équipe reste raisonnable (${round(wipRef)} tickets), mais il est concentré : jusqu’à ${maxWip} tickets ouverts en parallèle pour une même personne.`,
      evidence: overloaded.map((l) => `${names(l.member)} : ${l.wip} tickets en cours`),
      question: 'Ces tickets avancent-ils vraiment en parallèle, ou certains attendent-ils quelque chose ?',
      recommendation: { text: 'Finir ou rendre un ticket avant d’en commencer un nouveau ; proposer du pairing sur l’un d’eux.', owner: 'Équipe' },
    }));
  } else if (wipRef > teamSize * 1.4) {
    out.push(signal({
      type: 'wip_overload', theme: 'flow',
      severity: 0.25 + 0.12 * overloaded.length + (histWip && wipRef > histWip * 1.3 ? 0.2 : 0),
      title: `Travail en cours élevé : ${round(wipRef)} tickets en parallèle pour ${teamSize} personnes`,
      narrative: `L’équipe commence plus qu’elle ne finit${histWip ? ` (WIP moyen historique : ${round(histWip)})` : ''}. Le multitâche allonge le cycle time et retarde la valeur.`,
      evidence: overloaded.map((l) => `${names(l.member)} : ${l.wip} tickets en cours`),
      question: 'Que faudrait-il arrêter de commencer pour commencer à finir ?',
      recommendation: { text: 'Expérimenter une limite de WIP explicite (ex. 2 par personne) visible sur le board.', owner: 'Équipe' },
    }));
  }
  return out;
}

/** Le périmètre a bougé après le Planning. */
function scopeChange(snap) {
  const m = snap.metrics;
  if (m.scopeChangeRatio < 0.08 && !m.removedPoints) return [];
  const added = snap.issues.filter((i) => i.addedMidSprint);
  const origins = unplanned(snap).byOrigin;
  return [signal({
    type: 'scope_change', theme: 'scope',
    severity: 0.2 + m.scopeChangeRatio * 2,
    title: `${m.addedPoints} points ajoutés après le Planning, en plus des ${m.committedPoints} engagés (+${pct(m.scopeChangeRatio)})`,
    narrative: `${plural(added.length, 'ticket est entré', 'tickets sont entrés')} dans le sprint après le Planning, soit ${pct(m.unplannedRatio)} des tickets du sprint. Origine : ${origins.map((o) => `${o.origin.toLowerCase()} (${o.count})`).join(', ')}.`,
    evidence: added.map((i) => `${i.key} (${i.points != null ? `+${i.points} pts` : 'non estimé'}, ajouté le ${i.addedDate}, ${originOf(i).toLowerCase()}) — ${i.title}`),
    issues: keys(added),
    question: 'Ces ajouts étaient-ils réellement urgents ? Qu’avons-nous retiré en échange ?',
    recommendation: { text: 'Prévoir un buffer explicite pour les urgences et rendre visible le « troc » (un ajout = un retrait).', owner: 'Product Owner' },
  })];
}

/** Le besoin change pendant la réalisation. */
function requirementChurn(snap) {
  const churned = snap.issues.filter((i) => i.churn >= 2 || (i.churn >= 1 && i.comments.some((c) => /(pas clair|re-?sp[ée]cifier|a encore chang|à clarifier)/i.test(c.text))));
  if (!churned.length) return [];
  return [signal({
    type: 'requirement_churn', theme: 'scope',
    severity: 0.3 + 0.15 * churned.length + 0.03 * sum(churned, (i) => i.churn),
    title: `Besoin instable sur ${plural(churned.length, 'ticket')}`,
    narrative: 'Estimations ou critères d’acceptation modifiés pendant le sprint : le besoin n’était pas mûr au moment de l’engagement.',
    evidence: churned.map((i) => `${i.key} — ${i.churn} modification${i.churn > 1 ? 's' : ''} : ${i.changes.map((c) => `${c.field} ${c.from}→${c.to}`).join(', ')}`),
    issues: keys(churned),
    question: 'Qu’aurait-il fallu savoir avant le Planning pour éviter ces changements ?',
    recommendation: { text: 'Organiser un affinage dédié (PO + dev + QA) sur les règles métier avant de planifier ces sujets.', owner: 'Product Owner' },
  })];
}

/** Baisse de vélocité (normalisée par la capacité pour ne pas confondre avec les congés). */
function velocityTrend(snap, ctx) {
  if (!snap.closed) return [];
  const ref = ctx.previous.slice(-3).filter((p) => p.metrics.velocityPerPersonDay);
  if (ref.length < 2) return [];
  const refRate = mean(ref.map((p) => p.metrics.velocityPerPersonDay));
  const rate = snap.metrics.velocityPerPersonDay;
  const drop = 1 - rate / refRate;
  if (drop < 0.15) return [];
  return [signal({
    type: 'velocity_drop', theme: 'predictability',
    severity: 0.2 + drop * 1.2,
    title: `Productivité en baisse de ${pct(drop)} par rapport aux 3 derniers sprints`,
    narrative: `${round(rate, 2)} point/jour-personne contre ${round(refRate, 2)} en moyenne (calcul corrigé des absences et jours fériés).`,
    evidence: [...ref.map((p) => `${p.sprint.name} : ${p.metrics.donePoints} pts / ${p.metrics.personDays} j-p`), `${snap.sprint.name} : ${snap.metrics.donePoints} pts / ${snap.metrics.personDays} j-p`],
    question: 'Qu’est-ce qui a consommé notre capacité ce sprint-ci, au-delà des tickets planifiés ?',
    hypotheses: ['Temps perdu en blocages', 'Interruptions non planifiées', 'Tickets plus complexes que prévu'],
    recommendation: { text: 'Ne pas « compenser » au prochain Planning : s’engager sur la vélocité observée, pas sur la vélocité espérée.', owner: 'Équipe' },
  })];
}


/** Prévision de fin de sprint par simulation Monte Carlo (sprint en cours). */
function forecast(snap, ctx) {
  if (snap.closed || !snap.remainingDays.length) return [];
  const m = snap.metrics;
  // Quand une part notable du travail restant n'est pas estimée, compter en points serait faux
  // (un ticket non estimé vaut 0 point) : on raisonne alors en nombre de tickets.
  const unit = m.openCount && (m.openUnestimated / m.openCount >= 0.25 || m.remainingPoints === 0) ? 'tickets' : 'points';
  const amount = (t) => (unit === 'tickets' ? t.count ?? 0 : t.points);
  const samples = ctx.previous.flatMap((p) => p.throughputDaily.map((t) => amount(t) / Math.max(1, p.metrics.personDays / p.totalDays)));
  const current = snap.throughputDaily.map((t) => amount(t) / Math.max(1, m.personDays / snap.totalDays));
  const pool = [...samples, ...current, ...current]; // le sprint courant pèse double
  if (pool.length < 5) return [];
  const remainingCapacity = snap.remainingDays.map((d) => snap.capacity.filter((c) => !c.absences.includes(d)).length);
  const rand = seededRandom(7);
  const runs = 3000;
  const target = unit === 'tickets' ? m.openCount : m.remainingPoints;
  let ok = 0;
  const totals = [];
  for (let r = 0; r < runs; r++) {
    let t = 0;
    for (const people of remainingCapacity) t += pool[Math.floor(rand() * pool.length)] * people;
    totals.push(t);
    if (t >= target) ok++;
  }
  const p = ok / runs;
  const p50 = quantile(totals, 0.5);
  snap.forecast = { unit, probability: p, expected: round(p50), remaining: target, p15: round(quantile(totals, 0.15)), p85: round(quantile(totals, 0.85)) };
  const goalOpen = snap.issues.filter((i) => i.goal && !i.done);
  const out = [];
  if (p < 0.75) {
    out.push(signal({
      type: 'forecast_risk', theme: 'predictability',
      severity: 0.9 - p,
      title: `Probabilité de terminer le périmètre : ${pct(p)}`,
      narrative: `Il reste ${target} ${unit} pour ${plural(snap.remainingDays.length, 'jour ouvré', 'jours ouvrés')}. Au rythme observé, l’équipe devrait en terminer ~${Math.round(p50)} (fourchette ${Math.round(quantile(totals, 0.15))}–${Math.round(quantile(totals, 0.85))}).`,
      evidence: [
        `Simulation Monte Carlo (${runs} tirages) sur le débit quotidien historique, corrigé de la capacité restante`,
        ...(unit === 'tickets' ? [`Calcul en nombre de tickets : ${m.openUnestimated} des ${m.openCount} tickets restants ne sont pas estimés`] : []),
      ],
      question: 'Si nous ne pouvons pas tout finir, que devons-nous absolument finir ?',
      recommendation: { text: 'Négocier dès maintenant avec le PO ce qui sort du sprint, plutôt que de le constater à la Review.', owner: 'Product Owner + Équipe' },
    }));
  }
  if (goalOpen.length && (p < 0.6 || goalOpen.some((i) => i.blockedNow))) {
    out.push(signal({
      type: 'goal_at_risk', theme: 'predictability',
      severity: 0.5 + (goalOpen.some((i) => i.blockedNow) ? 0.2 : 0) + (1 - p) * 0.3,
      title: `Objectif du sprint menacé : ${goalOpen.length}/${snap.metrics.goalTotal} éléments clés non terminés`,
      narrative: `« ${snap.sprint.goal} » dépend d’éléments encore ouverts${goalOpen.some((i) => i.blockedNow) ? ', dont certains bloqués' : ''}.`,
      evidence: goalOpen.map((i) => `${i.key} — ${STATUS_LABELS[i.status]}${i.blockedNow ? ' (bloqué)' : ''} — ${i.title}`),
      issues: keys(goalOpen),
      question: 'Pouvons-nous encore atteindre l’objectif, éventuellement sous une forme réduite ?',
      recommendation: { text: 'Re-focaliser toute l’équipe sur les éléments de l’objectif (swarming) avant tout nouveau démarrage.', owner: 'Équipe' },
    }));
  }
  return out;
}

/** Tickets reportés sprint après sprint. */
function carryover(snap) {
  const carried = snap.issues.filter((i) => i.carriedOver > 0);
  if (!carried.length) return [];
  const zombies = carried.filter((i) => i.carriedOver >= 2);
  return [signal({
    type: 'carryover', theme: 'predictability',
    severity: 0.2 + 0.08 * carried.length + 0.25 * zombies.length,
    title: zombies.length ? `${plural(zombies.length, 'ticket « zombie »', 'tickets « zombies »')} reporté${zombies.length > 1 ? 's' : ''} depuis 2 sprints ou plus` : `${plural(carried.length, 'ticket reporté', 'tickets reportés')} du sprint précédent`,
    narrative: `${snap.metrics.carryoverPoints} points viennent de sprints précédents. Un report répété signale souvent un ticket trop gros, mal compris ou bloqué.`,
    evidence: carried.map((i) => `${i.key} — reporté ${i.carriedOver} fois — ${STATUS_LABELS[i.status]} — ${i.title}`),
    issues: keys(carried),
    question: zombies.length ? 'Ce ticket a-t-il encore de la valeur sous sa forme actuelle ? Faut-il le découper ou le reformuler ?' : 'Pourquoi ces tickets n’ont-ils pas été terminés au sprint précédent ?',
    recommendation: { text: 'Re-découper les tickets reportés plus d’une fois avant de les replanifier.', owner: 'Product Owner + Équipe' },
  })];
}

/** Développeurs en surcharge quand on additionne leurs estimations sur tous les projets Sobrus. */
function crossTeamOverload(snap, ctx) {
  const p = ctx.portfolio;
  if (!p || snap.closed) return [];
  const inTeam = new Set(snap.capacity.map((c) => c.member));
  const over = p.devs.filter((d) => d.overloaded && inTeam.has(d.id));
  if (!over.length) return [];
  const worst = Math.max(...over.map((d) => d.ratio));
  return [signal({
    type: 'cross_team_overload', theme: 'team',
    severity: 0.35 + 0.15 * over.length + 0.3 * (worst - p.overloadRatio),
    title: `${plural(over.length, 'développeur en surcharge', 'développeurs en surcharge')}, tous projets confondus`,
    narrative: `En additionnant leurs estimations sur tous les projets du sprint, certains développeurs portent plus de ${pct(p.overloadRatio)} de ce qu’ils peuvent absorber (rythme de référence : ${p.rate} point/jour).`,
    evidence: over.map((d) => `${d.name} : ${d.total} pts estimés (${d.projects.map((x) => `${x.product} ${x.points}`).join(' + ')}) pour ~${Math.round(d.capacityPoints)} absorbables en ${d.days} j${d.unestimated ? ` · ${d.unestimated} ticket${d.unestimated > 1 ? 's' : ''} non estimé${d.unestimated > 1 ? 's' : ''} en plus` : ''}`),
    question: 'Quelle priorité donner entre les projets pour ces personnes, et qui peut reprendre une partie de leurs tickets ?',
    recommendation: { text: 'Arbitrer entre projets avec les PO concernés avant que la surcharge ne se traduise en reports.', owner: 'Product Owners + Scrum Master' },
  })];
}

/** Fonctionnalités qui ne peuvent pas se terminer : des sous-tickets ne sont pas dans le sprint. */
function featureGaps(snap) {
  const blocked = (snap.features || []).filter((f) => f.outside.length);
  if (!blocked.length) return [];
  const missing = sum(blocked, (f) => f.outside.length);
  return [signal({
    type: 'feature_gap', theme: 'scope',
    severity: 0.3 + 0.1 * blocked.length + 0.03 * missing + (blocked.some((f) => f.goal) ? 0.2 : 0),
    title: `${plural(blocked.length, 'fonctionnalité ne peut', 'fonctionnalités ne peuvent')} pas se terminer ce sprint : ${missing} sous-ticket${missing > 1 ? 's' : ''} hors du cycle`,
    narrative: 'Un ticket parent n’est terminé que lorsque tous ses sous-tickets le sont. Or certains sous-tickets ne sont planifiés dans aucun cycle (ou dans un autre) : la fonctionnalité restera ouverte quoi que fasse l’équipe.',
    evidence: blocked.map((f) => `${f.key} « ${f.title} » — ${f.done}/${f.total} sous-tickets terminés, hors cycle : ${f.outside.map((o) => `${o.key} (${o.state})`).join(', ')}`),
    issues: blocked.map((f) => f.key),
    question: 'Ces sous-tickets doivent-ils entrer dans ce sprint, être découpés dans une autre fonctionnalité, ou la fonctionnalité doit-elle être replanifiée ?',
    recommendation: { text: 'Au Planning, vérifier que chaque ticket parent engagé a tous ses sous-tickets dans le cycle.', owner: 'Product Owner' },
  })];
}

/** Tickets non estimés : la vélocité en points sous-estime le travail réel. */
function estimationGap(snap) {
  const missing = snap.issues.filter((i) => i.points == null);
  const ratio = missing.length / Math.max(1, snap.issues.length);
  if (ratio < 0.25 || missing.length < 3) return [];
  return [signal({
    type: 'estimation_gap', theme: 'predictability',
    severity: 0.15 + ratio * 0.6,
    title: `${pct(ratio)} des tickets ne sont pas estimés (${missing.length}/${snap.issues.length})`,
    narrative: 'Les tickets sans estimation comptent pour zéro point : la vélocité, la capacité et les prévisions sous-estiment le travail réellement fait.',
    evidence: missing.slice(0, 8).map((i) => `${i.key} — ${i.title}`),
    issues: keys(missing),
    question: 'Ces tickets sont-ils trop petits pour être estimés, ou ont-ils été ajoutés sans passer par l’affinage ?',
    recommendation: { text: 'Estimer chaque ticket qui entre dans le cycle, même en cours de route (0 pour un ticket trivial).', owner: 'Équipe' },
  })];
}

/** Livraison concentrée en fin de sprint (« mini-cascade »). */
function endLoading(snap) {
  if (snap.closed) {
    const e = snap.metrics.endLoading;
    if (e == null || e < 0.5) return [];
    return [signal({
      type: 'end_loaded', theme: 'flow',
      severity: 0.1 + e * 0.6,
      title: `${pct(e)} des points terminés dans les derniers jours du sprint`,
      narrative: 'La valeur arrive en bloc à la fin : moins de temps pour tester, peu de feedback en cours de sprint, risque de « mini-cascade ».',
      evidence: snap.burndown.filter((b) => b.remaining != null).map((b) => `${b.date} : reste ${b.remaining} pts (idéal ${b.ideal})`).slice(-4),
      question: 'Qu’est-ce qui nous empêche de terminer des tickets plus tôt dans le sprint ?',
      recommendation: { text: 'Découper en tickets plus petits et viser un premier ticket terminé dès le 2e jour.', owner: 'Équipe' },
    })];
  }
  const elapsed = snap.dayIndex / snap.totalDays;
  if (elapsed < 0.3) return [];
  // Même unité que l'avancement de la santé : en tickets quand moins de 75 % des tickets sont estimés
  // (sinon un ticket non estimé vaut 0 point et la trajectoire en points est faussée).
  const estimated = snap.issues.filter((i) => i.points != null).length / Math.max(1, snap.issues.length);
  if (estimated < 0.75) {
    const m = snap.metrics;
    const ideal = Math.round(m.scopeCount * (1 - elapsed) * 10) / 10;
    const gap = (m.openCount - ideal) / Math.max(1, m.scopeCount);
    if (gap < 0.15) return [];
    return [signal({
      type: 'burndown_gap', theme: 'flow',
      severity: 0.2 + gap * 1.5,
      title: `Retard sur la trajectoire : ${m.openCount} tickets restants contre ${ideal} attendus`,
      narrative: `À ${pct(elapsed)} du sprint, l’écart avec la trajectoire idéale représente ${pct(gap)} des tickets du sprint (calcul en tickets : ${pct(1 - estimated)} des tickets ne sont pas estimés).`,
      evidence: [`${m.doneCount}/${m.scopeCount} tickets terminés au jour ${snap.dayIndex}/${snap.totalDays}`],
      question: 'Le retard vient-il de tickets bloqués, de tickets plus gros que prévu, ou d’ajouts ?',
      recommendation: { text: 'Faire un point de mi-sprint court avec le PO pour ajuster le périmètre.', owner: 'Scrum Master' },
    })];
  }
  const today = snap.burndown.filter((b) => b.remaining != null).at(-1);
  if (!today) return [];
  const gap = (today.remaining - today.ideal) / Math.max(1, snap.metrics.committedPoints);
  if (gap < 0.15) return [];
  return [signal({
    type: 'burndown_gap', theme: 'flow',
    severity: 0.2 + gap * 1.5,
    title: `Retard sur la trajectoire : ${today.remaining} pts restants contre ${today.ideal} attendus`,
    narrative: `À ${pct(elapsed)} du sprint, l’écart avec la trajectoire idéale représente ${pct(gap)} de l’engagement.`,
    evidence: snap.burndown.filter((b) => b.remaining != null).map((b) => `${b.date} : ${b.remaining} pts (idéal ${b.ideal})`),
    question: 'Le retard vient-il de tickets bloqués, de tickets plus gros que prévu, ou d’ajouts ?',
    recommendation: { text: 'Faire un point de mi-sprint court avec le PO pour ajuster le périmètre.', owner: 'Scrum Master' },
  })];
}

/** Qualité : tickets rouverts, part de bugs en hausse. */
function quality(snap, ctx) {
  const reopened = snap.issues.filter((i) => i.reopenCount > 0 || i.comments.some((c) => /r[ée]gression|rouvert/i.test(c.text)));
  const histBug = mean(ctx.previous.map((p) => p.metrics.bugRatio));
  const bugUp = histBug != null && snap.metrics.bugRatio > histBug * 1.4 && snap.metrics.bugRatio > 0.2;
  if (!reopened.length && !bugUp) return [];
  return [signal({
    type: 'quality', theme: 'quality',
    severity: 0.25 + 0.2 * reopened.length + (bugUp ? 0.15 : 0),
    title: reopened.length ? `${plural(reopened.length, 'ticket rouvert', 'tickets rouverts')} après avoir été terminé${reopened.length > 1 ? 's' : ''}` : `Part des bugs en hausse (${pct(snap.metrics.bugRatio)})`,
    narrative: `${reopened.length ? 'Des tickets « terminés » sont revenus : la Definition of Done ne protège pas complètement des régressions. ' : ''}${bugUp ? `Les bugs représentent ${pct(snap.metrics.bugRatio)} des tickets (moyenne historique ${pct(histBug)}).` : ''}`.trim(),
    evidence: reopened.map((i) => `${i.key} — ${i.title}${i.comments.filter((c) => /r[ée]gression|rouvert/i.test(c.text)).map((c) => ` « ${c.text} »`).join('')}`),
    issues: keys(reopened),
    question: 'Qu’est-ce qui a manqué dans nos tests pour détecter ces régressions avant le « Terminé » ?',
    recommendation: { text: 'Ajouter des tests de non-régression automatisés sur les zones rouvertes (tiers payant, synchronisation).', owner: 'Équipe + QA' },
  })];
}

/** Concentration de la charge restante sur une personne (+ absences à venir). */
function concentration(snap, ctx, names) {
  if (snap.closed) return [];
  const devLoad = snap.load.filter((l) => !l.outside); // la concentration ne concerne que les développeurs
  const remaining = sum(devLoad, (l) => l.remainingPoints);
  if (!remaining) return [];
  const out = [];
  const top = [...devLoad].sort((a, b) => b.remainingPoints - a.remainingPoints)[0];
  const share = top.remainingPoints / remaining;
  if (share >= 0.4 && top.remainingPoints >= 8) {
    out.push(signal({
      type: 'concentration', theme: 'team',
      severity: 0.2 + share * 0.8,
      title: `${pct(share)} du travail restant repose sur une seule personne (${names(top.member)})`,
      narrative: `${names(top.member)} porte ${top.remainingPoints} des ${remaining} points restants : risque de goulot et de surcharge, et faible partage de connaissance.`,
      evidence: devLoad.map((l) => `${names(l.member)} : ${l.remainingPoints} pts restants, ${l.wip} en cours`),
      question: `Qui pourrait reprendre ou faire en binôme une partie des tickets de ${names(top.member)} ?`,
      recommendation: { text: 'Organiser du pairing sur les sujets critiques pour répartir la charge et la connaissance.', owner: 'Équipe' },
    }));
  }
  const absentWithLoad = snap.load.filter((l) => l.upcomingAbsences.length && l.remainingPoints > 0);
  if (absentWithLoad.length) {
    out.push(signal({
      type: 'absence_risk', theme: 'team',
      severity: 0.25 + 0.04 * sum(absentWithLoad, (l) => l.remainingPoints),
      title: `Absence${absentWithLoad.length > 1 ? 's' : ''} à venir avec du travail non terminé`,
      narrative: absentWithLoad.map((l) => `${names(l.member)} sera absent(e) ${plural(l.upcomingAbsences.length, 'jour')} et porte encore ${l.remainingPoints} points.`).join(' '),
      evidence: absentWithLoad.flatMap((l) => snap.issues.filter((i) => i.assignee === l.member && !i.done).map((i) => `${i.key} (${names(l.member)}) — ${STATUS_LABELS[i.status]}`)),
      question: 'Comment organiser la passation avant l’absence ?',
      recommendation: { text: 'Planifier une passation explicite des tickets concernés avant le départ.', owner: 'Équipe' },
    }));
  }
  return out;
}

const words = (t) => new Set(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3));
export function similar(a, b) {
  const A = words(a);
  const B = words(b);
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.max(1, Math.min(A.size, B.size));
}

/** Les actions de rétrospective sont-elles suivies d'effet ? */
function retroFollowThrough(snap, ctx) {
  const lastRetro = ctx.previous.at(-1)?.retro;
  if (!lastRetro?.actions?.length) return [];
  const open = lastRetro.actions.filter((a) => a.status !== 'done');
  if (!open.length) return [];
  const olderRetros = ctx.previous.slice(0, -1).map((p) => p.retro?.actions || []);
  const recurring = open.filter((a) => olderRetros.some((acts) => acts.some((b) => similar(a.text, b.text) >= 0.6)));
  return [signal({
    type: 'retro_follow_through', theme: 'improvement',
    severity: 0.25 + 0.1 * open.length + 0.25 * recurring.length,
    title: recurring.length
      ? `Action de rétro récurrente jamais réalisée : « ${recurring[0].text} »`
      : `${plural(open.length, 'action', 'actions')} de la dernière rétro non réalisée${open.length > 1 ? 's' : ''}`,
    narrative: recurring.length
      ? 'La même décision revient de rétro en rétro sans être appliquée : la rétrospective risque de perdre sa crédibilité.'
      : 'Les engagements d’amélioration ne sont pas tous tenus.',
    evidence: open.map((a) => `« ${a.text} » — ${a.status === 'in_progress' ? 'en cours' : 'non démarrée'}${recurring.includes(a) ? ' (récurrente)' : ''}`),
    question: 'Pourquoi cette action n’a-t-elle pas été mise en œuvre ? Est-elle trop vague, sans responsable, ou pas prioritaire ?',
    recommendation: { text: 'Limiter la rétro à 1–2 actions SMART, inscrites dans le Sprint Backlog avec un responsable.', owner: 'Scrum Master' },
  })];
}

/** Ce que disent les parties prenantes à la Review. */
function stakeholderFeedback(snap) {
  const fb = snap.review?.feedback || [];
  const neg = fb.filter((f) => f.sentiment === 'negative');
  if (!neg.length) return [];
  return [signal({
    type: 'stakeholder_concern', theme: 'stakeholders',
    severity: 0.35 + 0.15 * neg.length,
    title: `Inquiétude exprimée par les parties prenantes (${neg.map((f) => f.from).join(', ')})`,
    narrative: 'Le feedback de la Review montre une tension sur la confiance ou les délais.',
    evidence: fb.map((f) => `${f.from} (${f.sentiment}) : « ${f.text} »`),
    question: 'Quelle information les parties prenantes n’avaient-elles pas, et qui aurait changé leur perception ?',
    recommendation: { text: 'Partager une prévision probabiliste (fourchette) plutôt qu’une date unique.', owner: 'Product Owner' },
  })];
}

/**
 * Précision du Planning (sprint terminé) : les tickets planifiés ont-ils été livrés, et le Planning
 * représente-t-il vraiment le travail du sprint ? Remplace le « sur-engagement », qui n'a pas de sens
 * quand l'essentiel du travail entre en cours de sprint.
 */
function planningAccuracySignal(snap) {
  const m = snap.metrics;
  if (!snap.closed || m.planningAccuracy == null) return [];
  const out = [];
  if (m.planningAccuracy < 0.8) {
    const missed = snap.issues.filter((i) => i.committed && !i.done);
    out.push(signal({
      type: 'planning_accuracy', theme: 'predictability',
      severity: 0.2 + (0.8 - m.planningAccuracy) * 1.5,
      title: `${pct(m.planningAccuracy)} des tickets planifiés ont été livrés (${m.plannedDoneCount}/${m.plannedCount})`,
      narrative: 'Une partie de ce qui avait été choisi au Planning n’a pas été terminée pendant le sprint.',
      evidence: missed.map((i) => `${i.key} — ${STATUS_LABELS[i.status]} — ${i.title}`),
      issues: keys(missed),
      question: 'Qu’est-ce qui a pris la place des tickets planifiés : des ajouts, des blocages, ou des tickets plus gros que prévu ?',
      recommendation: { text: 'Au Planning, ne retenir que ce qui est prêt et laisser une marge visible pour l’imprévu.', owner: 'Product Owner + Équipe' },
    }));
  }
  if (m.plannedShareOfDone != null && m.plannedShareOfDone < 0.5 && m.doneCount >= 5) {
    out.push(signal({
      type: 'planning_share', theme: 'predictability',
      severity: 0.25 + (0.5 - m.plannedShareOfDone),
      title: `Le Planning ne représente que ${pct(m.plannedShareOfDone)} du travail livré`,
      narrative: `${m.doneCount - m.plannedDoneCount} des ${m.doneCount} tickets livrés sont entrés en cours de sprint : le Planning décrit mal ce que l’équipe fait réellement.`,
      question: 'Ce travail imprévu était-il prévisible au moment du Planning ? Faut-il réserver explicitement une part du sprint au support ?',
      recommendation: { text: 'Mesurer la part d’imprévu habituelle et la réserver dès le Planning, plutôt que de la subir.', owner: 'Product Owner' },
    }));
  }
  return out;
}

export const DETECTORS = [
  agingWipSignal, blockers, dependencyBottleneck, recurringDependency, wipOverload, scopeChange, requirementChurn,
  velocityTrend, planningAccuracySignal, forecast, carryover, crossTeamOverload, featureGaps, estimationGap, endLoading, quality, concentration,
  retroFollowThrough, stakeholderFeedback,
];

export function understand(snap, ctx) {
  const names = (id) => ctx.dataset.team.find((m) => m.id === id)?.name || id;
  return DETECTORS.flatMap((d) => d(snap, ctx, names)).sort((a, b) => b.severity - a.severity);
}
