// Pipeline Sobrus AI Copilot : OBSERVE → UNDERSTAND → THINK → PREPARE → LEARN

import { observeSprint } from './observe.js';
import { understand } from './understand.js';
import { think } from './think.js';
import { prepare, reportMarkdown } from './prepare.js';
import { learn } from './learn.js';
import { flowMetrics } from './flow.js';
import { objectives } from './objectives.js';

/**
 * Analyse un sprint à une date donnée.
 * Les sprints précédents sont analysés à leur date de fin pour constituer l'historique.
 * `portfolio` (facultatif) = la charge des développeurs tous projets confondus (voir portfolio.js) :
 * elle ne concerne que le sprint en cours, regardé à la date du jour.
 */
export function analyze(dataset, sprintId, { asOf, portfolio = null } = {}) {
  const idx = dataset.sprints.findIndex((s) => s.id === sprintId);
  if (idx < 0) throw new Error(`Sprint inconnu : ${sprintId}`);

  const history = [];
  for (let k = 0; k <= idx; k++) {
    const s = dataset.sprints[k];
    const snap = observeSprint(dataset, s.id, k === idx ? asOf : undefined);
    const previous = history.filter((h) => h.snap.closed).map((h) => h.snap);
    const current = k === idx && s.status === 'active' && !asOf;
    const signals = understand(snap, { previous, dataset, portfolio: current ? portfolio : null });
    const thought = think(snap, signals);
    history.push({ snap, signals, thought });
  }

  const { snap, thought } = history.at(-1);
  const flow = flowMetrics(snap, history.slice(0, -1).filter((h) => h.snap.closed).map((h) => h.snap), dataset.meta?.holidays || []);
  const learned = learn(history);
  const prepared = prepare(snap, thought, history, dataset);
  const goals = objectives(dataset, history.map((h) => h.snap));
  const report = reportMarkdown({ snap, thought, prepared, learned, flow, objectives: goals });

  const activeNow = dataset.sprints[idx].status === 'active' && !asOf;
  return { observe: snap, think: thought, prepare: prepared, learn: learned, flow, objectives: goals, report, portfolio: activeNow ? portfolio : null };
}

export function summary(dataset) {
  return {
    meta: dataset.meta,
    team: dataset.team,
    backlog: dataset.backlog || [],
    nextSprint: dataset.nextSprint || null,
    sprints: dataset.sprints.map(({ id, name, status, start, end, goal }) => ({ id, name, status, start, end, goal })),
  };
}
