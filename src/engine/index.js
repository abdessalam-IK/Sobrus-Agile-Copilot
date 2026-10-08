// Pipeline Sobrus AI Copilot : OBSERVE → UNDERSTAND → THINK → PREPARE → LEARN

import { observeSprint } from './observe.js';
import { understand } from './understand.js';
import { think } from './think.js';
import { prepare, reportMarkdown } from './prepare.js';
import { learn } from './learn.js';

/**
 * Analyse un sprint à une date donnée.
 * Les sprints précédents sont analysés à leur date de fin pour constituer l'historique.
 */
export function analyze(dataset, sprintId, { asOf, feedback = {} } = {}) {
  const idx = dataset.sprints.findIndex((s) => s.id === sprintId);
  if (idx < 0) throw new Error(`Sprint inconnu : ${sprintId}`);

  const history = [];
  for (let k = 0; k <= idx; k++) {
    const s = dataset.sprints[k];
    const snap = observeSprint(dataset, s.id, k === idx ? asOf : undefined);
    const previous = history.filter((h) => h.snap.closed).map((h) => h.snap);
    const signals = understand(snap, { previous, dataset });
    const thought = think(snap, signals, { feedback });
    history.push({ snap, signals, thought });
  }

  const { snap, thought } = history.at(-1);
  const learned = learn(history, { feedback, dataset });
  const prepared = prepare(snap, thought, history, dataset);
  const report = reportMarkdown({ snap, thought, prepared, learned });

  return { observe: snap, think: thought, prepare: prepared, learn: learned, report };
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
