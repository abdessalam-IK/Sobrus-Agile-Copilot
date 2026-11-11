// Indicateurs de flux (phase 2) : travail imprévu et son origine, précision du Planning,
// cycle time par étape, durée et causes des blocages, âge du travail en cours.

import { workingDaysBetween } from '../lib/calendar.js';
import { sum, median, quantile, round } from '../lib/stats.js';
import { isBlockedAt } from './observe.js';

const pts = (i) => i.points || 0;

// ---------------------------------------------------------------------------
// Travail imprévu : d'où vient ce qui entre en cours de sprint ?
// ---------------------------------------------------------------------------
export function originOf(issue) {
  const labels = (issue.labels || []).map((l) => l.toLowerCase());
  if (labels.some((l) => l.includes('customer care'))) return 'Support client';
  if (labels.some((l) => l.includes('business developer'))) return 'Commercial';
  if (labels.some((l) => l.includes('tools & benchmark'))) return 'Outils & benchmark';
  if (labels.some((l) => l === 'retour du client' || l === 'retour')) return 'Retour client';
  if (issue.type === 'bug') return 'Bug (source non précisée)';
  return 'Source non précisée';
}

export function unplanned(snap) {
  const added = snap.issues.filter((i) => i.addedMidSprint);
  const groups = new Map();
  for (const i of added) {
    const o = originOf(i);
    const g = groups.get(o) || { origin: o, count: 0, points: 0, unestimated: 0, issues: [] };
    g.count++;
    g.points += pts(i);
    if (i.points == null) g.unestimated++;
    g.issues.push({ key: i.key, title: i.title, points: i.points, addedDate: i.addedDate, done: i.done });
    groups.set(o, g);
  }
  return {
    count: added.length,
    points: sum(added, pts),
    ratio: snap.metrics.unplannedRatio,
    byOrigin: [...groups.values()].sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Précision du Planning
// ---------------------------------------------------------------------------
export function planning(snap) {
  const m = snap.metrics;
  return {
    planned: m.plannedCount,
    plannedDone: m.plannedDoneCount,
    accuracy: m.planningAccuracy,
    shareOfDone: m.plannedShareOfDone,
    done: m.doneCount,
  };
}

// ---------------------------------------------------------------------------
// Blocages : combien de temps, et pourquoi ?
// ---------------------------------------------------------------------------
const causeOf = (reason) => reason.replace(/^Label « (.*) »$/, '$1').replace(/^Statut « (.*) »$/, 'Statut $1');

export function blockages(snap) {
  const elapsed = snap.days.filter((d) => d <= snap.asOf);
  const causes = new Map();
  for (const i of snap.issues) {
    for (const b of i.blocks) {
      const days = elapsed.filter((d) => b.from <= d && (b.to == null || d < b.to)).length;
      if (!days && b.to) continue;
      const cause = causeOf(b.reason);
      const c = causes.get(cause) || { cause, ticketDays: 0, tickets: new Set(), open: 0 };
      c.ticketDays += days;
      c.tickets.add(i.key);
      if (b.to == null && !i.done) c.open++;
      causes.set(cause, c);
    }
  }
  const byCause = [...causes.values()].map((c) => ({ ...c, tickets: [...c.tickets] })).sort((a, b) => b.ticketDays - a.ticketDays);
  const blockedNow = snap.issues.filter((i) => !i.done && isBlockedAt(i, snap.asOf));
  return {
    ticketDays: sum(byCause, (c) => c.ticketDays),
    blockedNow: blockedNow.map((i) => ({ key: i.key, title: i.title, since: i.currentBlock?.from, cause: i.currentBlock ? causeOf(i.currentBlock.reason) : null })),
    byCause,
  };
}

// ---------------------------------------------------------------------------
// Cycle time par étape (workflow Sobrus)
// ---------------------------------------------------------------------------
export const STAGES = [
  { key: 'queue', label: 'Attente avant développement', from: ['Todo for Dev', 'Ready for Dev'], to: ['In Progress'] },
  { key: 'dev', label: 'Développement', from: ['In Progress'], to: ['Done à tester'] },
  { key: 'qa', label: 'Test QA', from: ['Done à tester'], to: ['Vérifié par QA'] },
  { key: 'ovh', label: 'Attente déploiement OVH', from: ['Vérifié par QA'], to: ['Vérifié en OVH'] },
  { key: 'prod', label: 'Attente mise en PROD', from: ['Vérifié en OVH'], to: ['Vérifié en PROD'] },
];
const firstAt = (stages, names) => stages.find((s) => names.includes(s.state));
export const MIN_SAMPLE = 8;

/** Durées (jours ouvrés) de chaque étape pour un ticket, à partir de son historique complet de statuts. */
export function stageDurations(issue, holidays = []) {
  const st = issue.stages || [];
  const out = {};
  for (const s of STAGES) {
    const a = firstAt(st, s.from);
    const b = a && st.find((x) => s.to.includes(x.state) && x.at > a.at);
    if (a && b) out[s.key] = workingDaysBetween(a.date, b.date, holidays);
  }
  const start = firstAt(st, ['In Progress']);
  const prod = start && st.find((x) => x.state === 'Vérifié en PROD' && x.at > start.at);
  if (start && prod) out.leadToProd = workingDaysBetween(start.date, prod.date, holidays);
  return out;
}

/** Médiane de chaque étape sur les tickets terminés des derniers sprints (et du sprint analysé). */
export function cycleByStage(snaps, holidays = []) {
  const issues = snaps.flatMap((s) => s.issues.filter((i) => i.done && i.stages?.length));
  const seen = new Set();
  const unique = issues.filter((i) => !seen.has(i.key) && seen.add(i.key));
  const per = unique.map((i) => stageDurations(i, holidays));
  // En dessous de MIN_SAMPLE tickets, une médiane n'est pas représentative (statut peu utilisé par l'équipe)
  const stats = STAGES.map((s) => {
    const values = per.map((p) => p[s.key]).filter((v) => v != null);
    const reliable = values.length >= MIN_SAMPLE;
    return { ...s, tickets: values.length, reliable, median: reliable ? median(values) : null, p85: reliable ? round(quantile(values, 0.85), 1) : null };
  });
  const lead = per.map((p) => p.leadToProd).filter((v) => v != null);
  const withStages = stats.filter((s) => s.median != null);
  // Un goulot n'a de sens que si au moins deux étapes sont mesurables
  const bottleneck = withStages.length >= 2 ? withStages.reduce((a, b) => (b.median > a.median ? b : a)) : null;
  return {
    tickets: unique.length,
    minSample: MIN_SAMPLE,
    stages: stats,
    leadToProd: lead.length >= MIN_SAMPLE ? { median: median(lead), p85: round(quantile(lead, 0.85), 1), tickets: lead.length, share: lead.length / Math.max(1, unique.length) } : null,
    bottleneck: bottleneck && bottleneck.median > 0 ? bottleneck : null,
  };
}

// ---------------------------------------------------------------------------
// Âge du travail en cours, comparé au cycle time habituel de l'équipe
// ---------------------------------------------------------------------------
export function agingThresholds(previous) {
  const times = previous.flatMap((p) => p.issues.map((i) => i.cycleTime).filter((x) => x != null));
  if (times.length < 8) return { p50: 3, p85: 5, basedOn: times.length, fallback: true };
  return { p50: Math.max(1, round(quantile(times, 0.5), 0)), p85: Math.max(2, round(quantile(times, 0.85), 0)), basedOn: times.length, fallback: false };
}

export function agingWip(snap, previous, holidays = []) {
  const th = agingThresholds(previous);
  const items = snap.issues
    .filter((i) => i.status === 'in_progress' && i.firstStart)
    .map((i) => {
      const age = workingDaysBetween(i.firstStart, snap.asOf, holidays) + 1;
      return { key: i.key, title: i.title, assignee: i.assignee, age, blocked: i.blockedNow, level: age > th.p85 ? 'risk' : age > th.p50 ? 'watch' : 'ok' };
    })
    .sort((a, b) => b.age - a.age);
  return { thresholds: th, items };
}

/** Tous les indicateurs de flux d'un sprint. `previous` = sprints terminés avant lui. */
export function flowMetrics(snap, previous, holidays = []) {
  return {
    unplanned: unplanned(snap),
    planning: planning(snap),
    blockages: blockages(snap),
    cycle: cycleByStage([...previous.slice(-3), snap], holidays),
    aging: snap.closed ? null : agingWip(snap, previous, holidays),
  };
}
