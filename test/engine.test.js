import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observeSprint, statusAt } from '../src/engine/observe.js';
import { analyze } from '../src/engine/index.js';
import { workingDays } from '../src/lib/calendar.js';

const dataset = JSON.parse(readFileSync(new URL('./fixtures/sobrus-demo.json', import.meta.url)));

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

test('UNDERSTAND : détecte un blocage actif et un ticket en cours depuis trop longtemps', () => {
  const ds = tiny([
    issue({ key: 'X-1', history: [{ date: '2026-01-05', to: 'in_progress' }], blocks: [{ from: '2026-01-06', to: null, reason: 'API', dependency: 'Partenaire' }] }),
    issue({ key: 'X-2', assignee: 'b', history: [{ date: '2026-01-05', to: 'in_progress' }] }),
  ]);
  // Sans historique, seuils par défaut : 85 % des tickets en 5 jours ; au 13/01, X-2 est en cours depuis 7 jours ouvrés
  const signals = analyze(ds, 'T1', { asOf: '2026-01-13' }).think.signals;
  assert.ok(signals.some((s) => s.type === 'active_blockers'));
  const aging = signals.find((s) => s.type === 'aging_wip');
  assert.ok(aging && aging.issues.includes('X-2'));
});

test('FLOW : origine du travail imprévu et précision du Planning', async () => {
  const { unplanned, planning } = await import('../src/engine/flow.js');
  const ds = tiny([
    issue({ key: 'P-1', history: [{ date: '2026-01-06', to: 'done' }] }),
    issue({ key: 'P-2' }),
    issue({ key: 'U-1', addedDate: '2026-01-07', labels: ['Source/Customer care'], history: [{ date: '2026-01-08', to: 'done' }] }),
    issue({ key: 'U-2', addedDate: '2026-01-07', type: 'bug' }),
  ]);
  const snap = analyze(ds, 'T1').observe;
  const u = unplanned(snap);
  assert.equal(u.count, 2);
  assert.deepEqual(u.byOrigin.map((o) => o.origin).sort(), ['Bug (source non précisée)', 'Support client']);
  const p = planning(snap);
  assert.equal(p.planned, 2);
  assert.equal(p.plannedDone, 1);
  assert.equal(p.accuracy, 0.5);
  assert.equal(p.shareOfDone, 0.5);
});

test('FLOW : cycle time par étape à partir de l’historique des statuts', async () => {
  const { stageDurations } = await import('../src/engine/flow.js');
  const d = stageDurations({ stages: [
    { at: '2026-01-05T09:00:00Z', date: '2026-01-05', state: 'Todo for Dev' },
    { at: '2026-01-07T09:00:00Z', date: '2026-01-07', state: 'In Progress' },
    { at: '2026-01-09T09:00:00Z', date: '2026-01-09', state: 'Done à tester' },
    { at: '2026-01-13T09:00:00Z', date: '2026-01-13', state: 'Vérifié par QA' },
    { at: '2026-01-14T09:00:00Z', date: '2026-01-14', state: 'Vérifié en OVH' },
    { at: '2026-01-20T09:00:00Z', date: '2026-01-20', state: 'Vérifié en PROD' },
  ] });
  assert.deepEqual({ queue: d.queue, dev: d.dev, qa: d.qa, ovh: d.ovh, prod: d.prod }, { queue: 2, dev: 2, qa: 2, ovh: 1, prod: 4 });
  assert.equal(d.leadToProd, 9);
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

test('LEARN : la tendance détecte la dégradation de la précision du Planning', () => {
  const { learn } = analyze(dataset, 'S6');
  assert.equal(learn.trend.planningAccuracy.quality, 'worse');
  assert.ok(learn.patterns.some((p) => p.type === 'retro'));
});

test('THINK : santé = 60 % avancement + 40 % signaux, sans double comptage', () => {
  const { think: t } = analyze(dataset, 'S6');
  const b = t.healthBreakdown;
  assert.equal(t.health, Math.round(0.6 * b.progress.score + 0.4 * b.signals.score));
  const themes = b.signals.themes.map((x) => x.theme);
  assert.equal(new Set(themes).size, themes.length, 'un seul retrait par thème');
  assert.ok(!b.signals.themes.some((x) => /Probabilité de terminer/.test(x.signal)), 'la prévision ne compte que dans l’avancement');
});

test('PREPARE : le Planning signale les éléments non prêts', () => {
  const { prepare } = analyze(dataset, 'S6');
  const p701 = prepare.planning.candidates.find((c) => c.key === 'PHA-701');
  assert.equal(p701.ready, false);
  assert.ok(prepare.planning.range.recommended > 0);
  assert.ok(prepare.planning.candidates.some((c) => c.key === 'PHA-401' && c.flags.some((f) => /reporté/.test(f.text))));
});
