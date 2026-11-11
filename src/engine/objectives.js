// Phase 3 — lien avec les objectifs : répartition de l'effort, projets Linear, objectif de sprint.

import { addDays } from '../lib/calendar.js';
import { sum, mean, round } from '../lib/stats.js';

const pts = (i) => i.points || 0;

// ---------------------------------------------------------------------------
// Répartition de l'effort : à quoi sert le travail livré ?
// ---------------------------------------------------------------------------
export const CATEGORIES = ['Projets', 'Bugs & support', 'Technique', 'Hors projet (non classé)'];

export function categoryOf(issue) {
  if (issue.project) return 'Projets';
  const labels = (issue.labels || []).map((l) => l.toLowerCase());
  if (issue.type === 'bug' || labels.some((l) => /(bug|regression|customer care|retour du client)/.test(l))) return 'Bugs & support';
  if (labels.some((l) => /(technical|improv|infra|performance|documentation|data-quality|refactor)/.test(l))) return 'Technique';
  return 'Hors projet (non classé)';
}

export function allocation(snap) {
  const done = snap.issues.filter((i) => i.done);
  const byCategory = CATEGORIES.map((category) => {
    const items = done.filter((i) => categoryOf(i) === category);
    return { category, count: items.length, points: sum(items, pts), share: done.length ? items.length / done.length : 0 };
  });
  const projects = new Map();
  for (const i of done.filter((x) => x.project)) {
    const p = projects.get(i.project) || { project: i.project, count: 0, points: 0 };
    p.count++;
    p.points += pts(i);
    projects.set(i.project, p);
  }
  return {
    sprint: snap.sprint.name,
    done: done.length,
    linkedShare: done.length ? done.filter((i) => i.project).length / done.length : 0,
    byCategory,
    byProject: [...projects.values()].sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Projets Linear : avancement, fin prévisible au rythme de l'équipe, hygiène
// ---------------------------------------------------------------------------
const SPRINT_DAYS = 14;

export function projectsStatus(dataset, snaps, today) {
  const closed = snaps.filter((s) => s.closed).slice(-3);
  const current = snaps.at(-1);
  const list = (dataset.projects || []).map((p) => {
    // Rythme : tickets du projet terminés par l'équipe, par sprint, sur les 3 derniers sprints terminés
    const perSprint = closed.map((s) => s.issues.filter((i) => i.done && i.project === p.name).length);
    const rate = closed.length ? mean(perSprint) : null;
    const remaining = p.issues ? p.issues.total - p.issues.done : null;
    let eta = null;
    if (remaining === 0) eta = { done: true };
    else if (remaining && rate != null && rate < 1) eta = { slow: true }; // moins d'un ticket par sprint : pas de projection fiable
    else if (remaining && rate > 0) {
      const sprints = Math.ceil(remaining / rate);
      eta = { sprints, date: addDays(current.sprint.end, (sprints - (current.closed ? 0 : 1)) * SPRINT_DAYS) };
    }
    const open = !['completed', 'canceled'].includes(p.statusType);
    const alerts = [];
    if (open && p.targetDate && p.targetDate < today) alerts.push('Date cible dépassée');
    if (open && !p.targetDate && p.worked) alerts.push('Pas de date cible');
    if (p.worked && ['backlog', 'planned'].includes(p.statusType) && perSprint.some((n) => n > 0)) alerts.push(`Statut Linear « ${p.status} » alors que l’équipe y travaille`);
    if (p.targetDate && eta?.date && eta.date > p.targetDate) alerts.push('Fin prévisible après la date cible');
    if (eta?.slow && open) alerts.push('Moins d’un ticket terminé par sprint : le projet n’avance presque plus');
    if (remaining === 0 && open) alerts.push('Tous les tickets sont terminés mais le projet n’est pas clos');
    return {
      ...p,
      remaining,
      rate: round(rate, 1),
      eta,
      alerts,
      workedThisSprint: current.issues.filter((i) => i.project === p.name).length,
    };
  });
  const worked = list.filter((p) => p.worked).sort((a, b) => b.workedThisSprint - a.workedThisSprint || (b.rate || 0) - (a.rate || 0));
  const stale = list.filter((p) => !p.worked && !['completed', 'canceled'].includes(p.statusType) && p.targetDate && p.targetDate < today);
  return { worked, stale, total: list.length };
}

// ---------------------------------------------------------------------------
// Objectif de sprint
// ---------------------------------------------------------------------------
export function sprintGoals(snaps, dataset) {
  return snaps.map((s) => {
    const raw = dataset.sprints.find((x) => x.id === s.sprint.id);
    const goalSet = raw?.goalSet ?? !/non renseigné/i.test(s.sprint.goal || '');
    return {
      sprint: s.sprint.name,
      closed: s.closed,
      goalSet,
      goal: goalSet ? s.sprint.goal : null,
      keyItems: s.metrics.goalTotal,
      keyDone: s.metrics.goalDone,
      achievement: s.metrics.goalTotal ? s.metrics.goalDone / s.metrics.goalTotal : null,
    };
  });
}

/** Tous les indicateurs « objectifs » : `snaps` = sprints jusqu'au sprint analysé inclus. */
export function objectives(dataset, snaps) {
  const today = dataset.meta?.referenceDate || new Date().toISOString().slice(0, 10);
  return {
    allocation: snaps.slice(-6).map(allocation),
    projects: projectsStatus(dataset, snaps, today),
    goals: sprintGoals(snaps.slice(-6), dataset),
  };
}
