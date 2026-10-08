import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observeSprint, statusAt } from '../src/engine/observe.js';
import { analyze } from '../src/engine/index.js';
import { feedbackWeight } from '../src/engine/think.js';
import { workingDays } from '../src/lib/calendar.js';

const dataset = JSON.parse(readFileSync(new URL('../data/sobrus-demo.json', import.meta.url)));

// Mini jeu de données construit à la main pour tester les détecteurs de façon isolée.
function tiny(issues, extra = {}) {
  return {
    meta: { holidays: [], referenceDate: '2026-01-09' },
    team: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bilal' }],
    sprints: [{ id: 'T1', name: 'Test', status: 'active', start: '2026-01-05', end: '2026-01-16', goal: 'Tester', issues, ...extra }],
  };
}
const issue = (o) => ({ type: 'story', points: 3, epic: 'E', assignee: 'a', goal: false, addedDate: '2026-01-05', carriedOver: 0, history: [], blocks: [], changes: [], comments: [], ...o });

test('calendrier : jours ouvrés hors week-ends et jours fériés', () => {
  assert.deepEqual(workingDays('2026-07-29', '2026-08-03', ['2026-07-30']), ['2026-07-29', '2026-07-31', '2026-08-03']);
});

test('statusAt suit les transitions dans le temps', () => {
  const i = issue({ history: [{ date: '2026-01-05', to: 'in_progress' }, { date: '2026-01-07', to: 'done' }] });
  assert.equal(statusAt(i, '2026-01-04'), 'todo');
  assert.equal(statusAt(i, '2026-01-06'), 'in_progress');
  assert.equal(statusAt(i, '2026-01-07'), 'done');
});

test('OBSERVE : rejouer un sprint ignore les événements futurs', () => {
  const early = observeSprint(dataset, 'S5', '2026-09-18');
  const end = observeSprint(dataset, 'S5');
  assert.ok(early.metrics.donePoints < end.metrics.donePoints);
  assert.equal(early.closed, false);
  assert.equal(end.closed, true);
  assert.ok(early.issues.every((i) => i.history.every((h) => h.date <= '2026-09-18')));
});

test('OBSERVE : un sprint qui démarre un jour férié garde son engagement', () => {
  const s3 = observeSprint(dataset, 'S3');
  assert.ok(s3.metrics.committedPoints > 0);
  assert.equal(s3.metrics.addedPoints, 0);
});

test('UNDERSTAND : détecte un blocage actif et un ticket immobile', () => {
  const ds = tiny([
    issue({ key: 'X-1', history: [{ date: '2026-01-05', to: 'in_progress' }], blocks: [{ from: '2026-01-06', to: null, reason: 'API', dependency: 'Partenaire' }] }),
    issue({ key: 'X-2', assignee: 'b', history: [{ date: '2026-01-05', to: 'in_progress' }] }),
  ]);
  const types = analyze(ds, 'T1').think.signals.map((s) => s.type);
  assert.ok(types.includes('active_blockers'));
  assert.ok(types.includes('stuck_issues'));
});

test('UNDERSTAND : détecte les ajouts en cours de sprint', () => {
  const ds = tiny([
    issue({ key: 'X-1', points: 5 }),
    issue({ key: 'X-2', points: 3, addedDate: '2026-01-07', type: 'bug', comments: [{ date: '2026-01-07', author: 'a', text: 'Urgent client' }] }),
  ]);
  const scope = analyze(ds, 'T1').think.signals.find((s) => s.type === 'scope_change');
  assert.ok(scope);
  assert.deepEqual(scope.issues, ['X-2']);
});

test('UNDERSTAND : sprint sain → aucun signal', () => {
  const s1 = analyze(dataset, 'S1');
  assert.equal(s1.think.signals.length, 0);
  assert.equal(s1.think.health, 100);
});

test('THINK : le titre met en avant 3 thèmes au maximum', () => {
  const s6 = analyze(dataset, 'S6');
  assert.match(s6.think.headline, /trois signaux nécessitant une attention particulière/);
  assert.ok(s6.think.priorities.length <= 3);
});

test('UNDERSTAND : dépendance récurrente reconnue sur plusieurs sprints', () => {
  const s6 = analyze(dataset, 'S6');
  const rec = s6.think.signals.find((s) => s.type === 'recurring_dependency');
  assert.ok(rec);
  assert.equal(rec.meta.sprints, 3);
});

test('LEARN : la tendance détecte la dégradation de la fiabilité', () => {
  const { learn } = analyze(dataset, 'S6');
  assert.equal(learn.trend.sayDo.quality, 'worse');
  assert.ok(learn.patterns.some((p) => p.type === 'retro'));
});

test('LEARN : le feedback humain ajuste le poids des signaux', () => {
  assert.equal(feedbackWeight({}, 'x'), 1);
  assert.ok(feedbackWeight({ x: { useful: 0, notUseful: 6 } }, 'x') < 0.7);
  assert.ok(feedbackWeight({ x: { useful: 6, notUseful: 0 } }, 'x') > 1.3);
  const base = analyze(dataset, 'S6').think.signals.find((s) => s.type === 'concentration').severity;
  const tuned = analyze(dataset, 'S6', { feedback: { concentration: { useful: 0, notUseful: 8 } } }).think.signals.find((s) => s.type === 'concentration').severity;
  assert.ok(tuned < base);
});

test('PREPARE : le Planning signale les éléments non prêts', () => {
  const { prepare } = analyze(dataset, 'S6');
  const p701 = prepare.planning.candidates.find((c) => c.key === 'PHA-701');
  assert.equal(p701.ready, false);
  assert.ok(prepare.planning.range.recommended > 0);
  assert.ok(prepare.planning.candidates.some((c) => c.key === 'PHA-401' && c.flags.some((f) => /reporté/.test(f.text))));
});
