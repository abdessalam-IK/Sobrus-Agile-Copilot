// 01 — OBSERVE
// Transforme les données brutes d'un sprint en un « instantané » à une date donnée (asOf).
// Toute l'information postérieure à asOf est ignorée : on peut rejouer un sprint jour par jour.

import { workingDays, workingDaysBetween, clampDate } from '../lib/calendar.js';
import { sum, mean } from '../lib/stats.js';

export const ACTIVE_STATUSES = ['in_progress', 'review'];
export const STATUS_LABELS = { todo: 'À faire', in_progress: 'En cours', review: 'En revue', done: 'Terminé' };

export function statusAt(issue, date) {
  let status = 'todo';
  for (const h of issue.history) {
    if (h.date <= date) status = h.to;
    else break;
  }
  return status;
}

export const isBlockedAt = (issue, date) =>
  issue.blocks.some((b) => b.from <= date && (b.to == null || date < b.to));

export function resolveAsOf(dataset, sprint, asOf) {
  if (asOf) return clampDate(asOf, sprint.start, sprint.end);
  if (sprint.status === 'active') {
    const ref = dataset.meta?.referenceDate || new Date().toISOString().slice(0, 10);
    return clampDate(ref, sprint.start, sprint.end);
  }
  return sprint.end;
}

/** Ne garde que ce qui était connu à la date `at`. */
function cutAt(raw, at) {
  return {
    ...raw,
    history: (raw.history || []).filter((h) => h.date <= at),
    blocks: (raw.blocks || []).filter((b) => b.from <= at).map((b) => ({ ...b, to: b.to && b.to <= at ? b.to : null })),
    changes: (raw.changes || []).filter((c) => c.date <= at),
    comments: (raw.comments || []).filter((c) => c.date <= at),
  };
}

function enrich(issue, firstDay, at, elapsedDays, holidays) {
  const status = statusAt(issue, at);
  const firstStart = issue.history.find((h) => ACTIVE_STATUSES.includes(h.to))?.date ?? null;
  const doneDate = status === 'done' ? [...issue.history].reverse().find((h) => h.to === 'done').date : null;
  const lastMove = issue.history.at(-1)?.date ?? issue.addedDate;
  let reopenCount = 0;
  for (let k = 1; k < issue.history.length; k++) {
    if (issue.history[k - 1].to === 'done' && issue.history[k].to !== 'done') reopenCount++;
  }
  const done = status === 'done';
  return {
    ...issue,
    status,
    done,
    removed: !!(issue.removedDate && issue.removedDate <= at),
    committed: issue.addedDate <= firstDay,
    addedMidSprint: issue.addedDate > firstDay,
    blockedNow: !done && isBlockedAt(issue, at),
    currentBlock: done ? null : issue.blocks.find((b) => b.to == null) || null,
    blockedDays: elapsedDays.filter((d) => isBlockedAt(issue, d)).length,
    firstStart,
    doneDate,
    cycleTime: doneDate && firstStart ? workingDays(firstStart, doneDate, holidays).length : null,
    ageInStatus: workingDaysBetween(lastMove, at, holidays),
    reopenCount,
    churn: issue.changes.length,
  };
}

function capacityOf(team, days, absences = {}) {
  return team
    .filter((m) => m.delivery !== false)
    .map((m) => {
      const off = (absences[m.id] || []).filter((d) => days.includes(d));
      return { member: m.id, days: days.length - off.length, absences: off };
    });
}

export function observeSprint(dataset, sprintId, asOf) {
  const sprint = dataset.sprints.find((s) => s.id === sprintId);
  if (!sprint) throw new Error(`Sprint inconnu : ${sprintId}`);
  const holidays = dataset.meta?.holidays || [];
  const days = workingDays(sprint.start, sprint.end, holidays);
  const at = resolveAsOf(dataset, sprint, asOf);
  const elapsedDays = days.filter((d) => d <= at);
  const remainingDays = days.filter((d) => d > at);
  const closed = sprint.status === 'closed' && at >= sprint.end;

  const all = sprint.issues
    .filter((i) => i.addedDate <= at)
    .map((raw) => enrich(cutAt(raw, at), days[0], at, elapsedDays, holidays));
  const issues = all.filter((i) => !i.removed);
  const pts = (i) => i.points || 0;

  const done = issues.filter((i) => i.done);
  const committedPoints = sum(all.filter((i) => i.committed), pts);
  const addedPoints = sum(issues.filter((i) => i.addedMidSprint), pts);
  const donePoints = sum(done, pts);
  const doneCommittedPoints = sum(done.filter((i) => i.committed), pts);
  const scopePoints = sum(issues, pts);

  const capacity = capacityOf(dataset.team, days, sprint.absences);
  const personDays = sum(capacity, (c) => c.days);
  const elapsedPersonDays = sum(capacityOf(dataset.team, elapsedDays, sprint.absences), (c) => c.days);

  const wipByDay = elapsedDays.map((d) => issues.filter((i) => ACTIVE_STATUSES.includes(statusAt(i, d))).length);
  const lastStretch = days.slice(Math.floor(days.length * 0.7));
  const goalIssues = issues.filter((i) => i.goal);
  const retroActions = sprint.retro?.actions || [];

  const metrics = {
    committedPoints,
    addedPoints,
    removedPoints: sum(all.filter((i) => i.removed), pts),
    scopePoints,
    scopeChangeRatio: committedPoints ? addedPoints / committedPoints : 0,
    donePoints,
    doneCommittedPoints,
    remainingPoints: scopePoints - donePoints,
    sayDo: closed && committedPoints ? doneCommittedPoints / committedPoints : null,
    completionRatio: scopePoints ? donePoints / scopePoints : 0,
    carryoverPoints: sum(issues.filter((i) => i.carriedOver > 0), pts),
    carryoverCount: issues.filter((i) => i.carriedOver > 0).length,
    avgCycleTime: mean(done.map((i) => i.cycleTime).filter((x) => x != null)),
    blockedIssueDays: sum(issues, (i) => i.blockedDays),
    blockedNowCount: issues.filter((i) => i.blockedNow).length,
    avgWip: mean(wipByDay),
    reopenCount: sum(issues, (i) => i.reopenCount),
    bugRatio: issues.length ? issues.filter((i) => i.type === 'bug').length / issues.length : 0,
    endLoading: closed && donePoints ? sum(done.filter((i) => lastStretch.includes(i.doneDate)), pts) / donePoints : null,
    personDays,
    velocityPerPersonDay: closed && personDays ? donePoints / personDays : null,
    throughputPerPersonDay: elapsedPersonDays ? donePoints / elapsedPersonDays : 0,
    goalTotal: goalIssues.length,
    goalDone: goalIssues.filter((i) => i.done).length,
    retroActionRate: retroActions.length ? retroActions.filter((a) => a.status === 'done').length / retroActions.length : null,
  };

  const n = days.length;
  const burndown = days.map((d, idx) => {
    const ideal = Math.round(committedPoints * (1 - idx / Math.max(1, n - 1)) * 10) / 10;
    if (d > at) return { date: d, ideal, remaining: null, scope: null };
    const inScope = all.filter((i) => i.addedDate <= d && !(i.removedDate && i.removedDate <= d));
    const scope = sum(inScope, pts);
    return { date: d, ideal, scope, remaining: scope - sum(inScope.filter((i) => statusAt(i, d) === 'done'), pts) };
  });

  const throughputDaily = elapsedDays.map((d) => ({ date: d, points: sum(done.filter((i) => i.doneDate === d), pts) }));

  const load = capacity.map((c) => {
    const mine = issues.filter((i) => i.assignee === c.member);
    return {
      member: c.member,
      capacityDays: c.days,
      remainingPoints: sum(mine.filter((i) => !i.done), pts),
      donePoints: sum(mine.filter((i) => i.done), pts),
      wip: mine.filter((i) => ACTIVE_STATUSES.includes(i.status)).length,
      upcomingAbsences: c.absences.filter((d) => d > at),
    };
  });

  const comments = issues.flatMap((i) => i.comments.map((c) => ({ ...c, key: i.key })));

  return {
    sprint: { id: sprint.id, name: sprint.name, goal: sprint.goal, start: sprint.start, end: sprint.end, status: sprint.status },
    asOf: at,
    closed,
    days,
    dayIndex: elapsedDays.length,
    totalDays: n,
    remainingDays,
    issues,
    metrics,
    burndown,
    throughputDaily,
    wipByDay,
    load,
    capacity,
    comments,
    review: closed ? sprint.review : null,
    retro: closed ? sprint.retro : null,
  };
}
