// 02 — UNDERSTAND
// Détecteurs de patterns. Chaque détecteur lit l'instantané du sprint (et l'historique)
// et renvoie des « signaux » : un fait observé + des preuves + une question à poser.
// Un signal n'est jamais un verdict : c'est une invitation à regarder.

import { sum, mean, median, quantile, clamp01, round, pct, seededRandom } from '../lib/stats.js';
import { ACTIVE_STATUSES, STATUS_LABELS } from './observe.js';

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

/** Tickets en cours ou en revue qui n'ont pas bougé depuis plusieurs jours. */
function stuckIssues(snap, ctx) {
  const typicalCycle = median(ctx.previous.flatMap((p) => p.issues.map((i) => i.cycleTime).filter(Boolean))) || 4;
  const threshold = Math.max(3, Math.round(typicalCycle * 0.75));
  const stuck = snap.issues.filter((i) => ACTIVE_STATUSES.includes(i.status) && i.ageInStatus >= threshold && !i.blockedNow);
  const reviewStuck = snap.issues.filter((i) => i.status === 'review' && i.ageInStatus >= 2 && !i.blockedNow && !stuck.includes(i));
  const all = [...stuck, ...reviewStuck];
  if (!all.length) return [];
  const maxAge = Math.max(...all.map((i) => i.ageInStatus));
  return [signal({
    type: 'stuck_issues', theme: 'flow',
    severity: (0.3 + 0.1 * all.length + 0.04 * maxAge) * (snap.closed ? 0.7 : 1),
    title: `${plural(all.length, 'ticket immobile', 'tickets immobiles')} (jusqu’à ${maxAge} jours sans mouvement)`,
    narrative: `${plural(all.length, 'ticket n’a', 'tickets n’ont')} pas changé de statut depuis plusieurs jours sans être déclaré bloqué : c’est souvent un blocage non dit.`,
    evidence: all.map((i) => `${i.key} — ${STATUS_LABELS[i.status]} depuis ${i.ageInStatus} j (${i.assignee})`),
    issues: keys(all),
    question: 'Qu’est-ce qui empêche réellement ces tickets d’avancer ? Qui peut aider aujourd’hui ?',
    recommendation: { text: 'Traiter les tickets immobiles en début de Daily (« walk the board » de droite à gauche).', owner: 'Équipe' },
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
  const teamSize = snap.load.length;
  const wipNow = snap.issues.filter((i) => ACTIVE_STATUSES.includes(i.status)).length;
  const wipRef = snap.closed ? snap.metrics.avgWip : wipNow;
  if (overloaded.length || wipRef > teamSize * 1.4) {
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
  const urgent = added.filter((i) => i.type === 'bug' || i.comments.some((c) => /urgent/i.test(c.text)));
  return [signal({
    type: 'scope_change', theme: 'scope',
    severity: 0.2 + m.scopeChangeRatio * 2,
    title: `+${m.addedPoints} points ajoutés en cours de sprint (${pct(m.scopeChangeRatio)} de l’engagement)`,
    narrative: `${plural(added.length, 'élément a été ajouté', 'éléments ont été ajoutés')} après le Planning${urgent.length ? `, dont ${urgent.length} présenté(s) comme urgent(s)` : ''}.`,
    evidence: added.map((i) => `${i.key} (+${i.points} pts, ajouté le ${i.addedDate}) — ${i.title}`),
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
    evidence: churned.map((i) => `${i.key} — ${i.churn} modification(s) : ${i.changes.map((c) => `${c.field} ${c.from}→${c.to}`).join(', ')}`),
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

/** Sur-engagement : l'équipe s'engage au-delà de ce qu'elle livre habituellement. */
function overcommitment(snap, ctx) {
  const ref = ctx.previous.slice(-3).filter((p) => p.metrics.velocityPerPersonDay);
  if (ref.length < 2) return [];
  const expected = mean(ref.map((p) => p.metrics.velocityPerPersonDay)) * snap.metrics.personDays;
  const ratio = snap.metrics.committedPoints / expected;
  if (ratio < 1.2) return [];
  return [signal({
    type: 'overcommitment', theme: 'predictability',
    severity: 0.2 + (ratio - 1) * 0.8,
    title: `Engagement ${pct(ratio - 1)} au-dessus de la capacité observée`,
    narrative: `${snap.metrics.committedPoints} points engagés pour une capacité estimée à ~${Math.round(expected)} points (vélocité récente × jours disponibles).`,
    evidence: [`Capacité : ${snap.metrics.personDays} jours-personne`, `Vélocité récente : ${round(mean(ref.map((p) => p.metrics.velocityPerPersonDay)), 2)} pt/j-p`],
    question: 'Qu’est-ce qui nous a poussés à nous engager au-delà de notre capacité ?',
    recommendation: { text: 'Au Planning, afficher la capacité calculée avant de sélectionner les tickets.', owner: 'Scrum Master' },
  })];
}

/** Prévision de fin de sprint par simulation Monte Carlo (sprint en cours). */
function forecast(snap, ctx) {
  if (snap.closed || !snap.remainingDays.length) return [];
  const samples = ctx.previous.flatMap((p) => p.throughputDaily.map((t) => t.points / Math.max(1, p.metrics.personDays / p.totalDays)));
  const current = snap.throughputDaily.map((t) => t.points / Math.max(1, snap.metrics.personDays / snap.totalDays));
  const pool = [...samples, ...current, ...current]; // le sprint courant pèse double
  if (pool.length < 5) return [];
  const remainingCapacity = snap.remainingDays.map((d) => snap.capacity.filter((c) => !c.absences.includes(d)).length);
  const rand = seededRandom(7);
  const runs = 3000;
  const target = snap.metrics.remainingPoints;
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
  snap.forecast = { probability: p, expectedPoints: round(p50), remainingPoints: target, p15: round(quantile(totals, 0.15)), p85: round(quantile(totals, 0.85)) };
  const goalOpen = snap.issues.filter((i) => i.goal && !i.done);
  const out = [];
  if (p < 0.75) {
    out.push(signal({
      type: 'forecast_risk', theme: 'predictability',
      severity: 0.9 - p,
      title: `Probabilité de terminer le périmètre : ${pct(p)}`,
      narrative: `Il reste ${target} points pour ${plural(snap.remainingDays.length, 'jour ouvré', 'jours ouvrés')}. Au rythme observé, l’équipe devrait livrer ~${Math.round(p50)} points (fourchette ${Math.round(quantile(totals, 0.15))}–${Math.round(quantile(totals, 0.85))}).`,
      evidence: [`Simulation Monte Carlo (${runs} tirages) sur le débit quotidien historique, corrigé de la capacité restante`],
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
    title: zombies.length ? `${plural(zombies.length, 'ticket « zombie »', 'tickets « zombies »')} reporté(s) depuis 2 sprints ou plus` : `${plural(carried.length, 'ticket reporté', 'tickets reportés')} du sprint précédent`,
    narrative: `${snap.metrics.carryoverPoints} points viennent de sprints précédents. Un report répété signale souvent un ticket trop gros, mal compris ou bloqué.`,
    evidence: carried.map((i) => `${i.key} — reporté ${i.carriedOver} fois — ${STATUS_LABELS[i.status]} — ${i.title}`),
    issues: keys(carried),
    question: zombies.length ? 'Ce ticket a-t-il encore de la valeur sous sa forme actuelle ? Faut-il le découper ou le reformuler ?' : 'Pourquoi ces tickets n’ont-ils pas été terminés au sprint précédent ?',
    recommendation: { text: 'Re-découper les tickets reportés plus d’une fois avant de les replanifier.', owner: 'Product Owner + Équipe' },
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
  const today = snap.burndown.filter((b) => b.remaining != null).at(-1);
  if (!today || elapsed < 0.3) return [];
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
    title: reopened.length ? `${plural(reopened.length, 'ticket rouvert', 'tickets rouverts')} après avoir été terminé(s)` : `Part des bugs en hausse (${pct(snap.metrics.bugRatio)})`,
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
  const remaining = sum(snap.load, (l) => l.remainingPoints);
  if (!remaining) return [];
  const out = [];
  const top = [...snap.load].sort((a, b) => b.remainingPoints - a.remainingPoints)[0];
  const share = top.remainingPoints / remaining;
  if (share >= 0.4 && top.remainingPoints >= 8) {
    out.push(signal({
      type: 'concentration', theme: 'team',
      severity: 0.2 + share * 0.8,
      title: `${pct(share)} du travail restant repose sur une seule personne (${names(top.member)})`,
      narrative: `${names(top.member)} porte ${top.remainingPoints} des ${remaining} points restants : risque de goulot et de surcharge, et faible partage de connaissance.`,
      evidence: snap.load.map((l) => `${names(l.member)} : ${l.remainingPoints} pts restants, ${l.wip} en cours`),
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

const FRICTION = [
  { cat: 'attente', label: 'attente', re: /(on attend|en attente|toujours pas|relanc|pas de date)/i },
  { cat: 'flou', label: 'manque de clarté', re: /(pas clair|à clarifier|re-?sp[ée]cifier|ambigu|on ne sait pas|a encore chang)/i },
  { cat: 'pression', label: 'urgence / pression', re: /(urgent|asap|en urgence|la direction|grand compte)/i },
  { cat: 'qualite', label: 'qualité', re: /(r[ée]gression|encore cass|rouvert|bloqu[ée] par un bug)/i },
  { cat: 'fatigue', label: 'surcharge', re: /(débordé|pas le temps|surcharg|épuis|je suis bloqu)/i },
];

/** Signaux faibles dans le langage des commentaires. */
function commentSignals(snap) {
  const hits = FRICTION.map((f) => ({ ...f, comments: snap.comments.filter((c) => f.re.test(c.text)) })).filter((f) => f.comments.length >= 2);
  if (!hits.length) return [];
  const total = sum(hits, (h) => h.comments.length);
  return [signal({
    type: 'comment_signals', theme: 'team',
    severity: 0.2 + 0.05 * total,
    title: `Signaux faibles dans les commentaires : ${hits.map((h) => h.label).join(', ')}`,
    narrative: `${total} commentaires expriment ${hits.map((h) => `${h.label} (${h.comments.length})`).join(', ')}. Ce ton n’apparaît pas forcément dans les statuts.`,
    evidence: hits.flatMap((h) => h.comments.slice(0, 3).map((c) => `${c.key} · ${c.date} · « ${c.text} »`)),
    issues: [...new Set(hits.flatMap((h) => h.comments.map((c) => c.key)))],
    question: 'Ce que disent les commentaires correspond-il à ce que nous disons en Daily ?',
    recommendation: { text: 'Faire émerger ces irritants en rétrospective plutôt que de les laisser dans les tickets.', owner: 'Scrum Master' },
  })];
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
      : `${plural(open.length, 'action', 'actions')} de la dernière rétro non réalisée(s)`,
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

export const DETECTORS = [
  stuckIssues, blockers, dependencyBottleneck, recurringDependency, wipOverload, scopeChange, requirementChurn,
  velocityTrend, overcommitment, forecast, carryover, endLoading, quality, concentration, commentSignals,
  retroFollowThrough, stakeholderFeedback,
];

export function understand(snap, ctx) {
  const names = (id) => ctx.dataset.team.find((m) => m.id === id)?.name || id;
  return DETECTORS.flatMap((d) => d(snap, ctx, names)).sort((a, b) => b.severity - a.severity);
}
