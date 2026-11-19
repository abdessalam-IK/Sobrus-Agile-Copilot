// 04 — PREPARE
// Prépare les cérémonies et le reporting à partir des insights.
// Tout ce qui est produit ici est un brouillon pour le Scrum Master, le PO et l'équipe :
// des points d'attention et des questions, jamais des décisions.

import { STATUS_LABELS, deliveryMembers } from './observe.js';
import { agingWip } from './flow.js';
import { workingDays } from '../lib/calendar.js';
import { mean, sum, round, pct, quantile } from '../lib/stats.js';

const pts = (i) => i.points || 0;

// ---------------------------------------------------------------------------
// Daily : qui fait quoi, ce qui a bougé, ce qui coince
// ---------------------------------------------------------------------------
const dm = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');

function daily(snap, thought, history, holidays, names) {
  const idx = snap.days.filter((d) => d <= snap.asOf).length - 1;
  const since = snap.days[Math.max(0, idx - 1)];
  const previous = history.filter((h) => h.snap.closed && h.snap.sprint.id !== snap.sprint.id).map((h) => h.snap);

  // Ce qui a bougé depuis le dernier jour ouvré : le dernier statut atteint par ticket
  const moved = [];
  for (const i of snap.issues) {
    const steps = i.history.filter((h) => h.date >= since && h.date <= snap.asOf);
    if (steps.length) moved.push({ key: i.key, note: `→ ${STATUS_LABELS[steps.at(-1).to].toLowerCase()} le ${dm(steps.at(-1).date)}` });
  }
  const added = snap.issues.filter((i) => i.addedMidSprint && i.addedDate >= since && i.addedDate <= snap.asOf);

  // Ce qui coince : tickets bloqués, et tickets en cours depuis plus longtemps que d'habitude
  const blocked = snap.issues.filter((i) => i.blockedNow);
  const aging = snap.closed ? null : agingWip(snap, previous, holidays);
  const late = (aging?.items || []).filter((x) => x.level !== 'ok' && !blocked.some((i) => i.key === x.key));

  // Qui fait quoi : chaque membre de l'équipe, puis les intervenants extérieurs qui ont un ticket en cours
  const members = snap.capacity.map((c) => c.member);
  const guests = [...new Set(snap.issues.filter((i) => !i.done && !members.includes(i.assignee) && i.assignee !== 'non-assigne').map((i) => i.assignee))];
  const team = [...members, ...guests].map((m) => {
    const mine = snap.issues.filter((i) => i.assignee === m);
    return {
      member: names(m),
      guest: !members.includes(m),
      inProgress: mine.filter((i) => !i.done && i.status !== 'todo').map((i) => i.key),
      todo: mine.filter((i) => i.status === 'todo').length,
      done: mine.filter((i) => i.done).length,
      absentToday: (snap.capacity.find((c) => c.member === m)?.absences || []).includes(snap.asOf),
    };
  });
  const unassigned = snap.issues.filter((i) => !i.done && i.assignee === 'non-assigne').map((i) => i.key);

  const questions = [
    ...blocked.map((i) => `${i.key} est bloqué depuis ${i.blockedDays} j. Quelle action aujourd’hui pour le débloquer, et qui la porte ?`),
    ...late.filter((x) => x.level === 'risk').map((x) => `${x.key} est en cours depuis ${x.age} j. De quoi ${names(x.assignee)} a-t-il besoin pour le terminer ?`),
    unassigned.length ? `${unassigned.length} ticket${unassigned.length > 1 ? 's ne sont' : ' n’est'} assigné${unassigned.length > 1 ? 's' : ''} à personne : qui les prend ?` : null,
    'Quel ticket allons-nous terminer aujourd’hui ?',
  ].filter(Boolean).slice(0, 4);

  return {
    date: snap.asOf,
    day: `${snap.dayIndex}/${snap.totalDays}`,
    since,
    totals: { done: snap.metrics.doneCount, scope: snap.metrics.scopeCount, inProgress: snap.issues.filter((i) => !i.done && i.status !== 'todo').length, todo: snap.issues.filter((i) => i.status === 'todo').length },
    moved: { issues: moved.map((x) => x.key), notes: Object.fromEntries(moved.map((x) => [x.key, x.note])) },
    added: { issues: added.map((i) => i.key), notes: Object.fromEntries(added.map((i) => [i.key, `ajouté le ${dm(i.addedDate)}`])) },
    stuck: {
      issues: [...blocked.map((i) => i.key), ...late.map((x) => x.key)],
      notes: Object.fromEntries([
        ...blocked.map((i) => [i.key, `bloqué depuis ${i.blockedDays} j${i.currentBlock?.reason ? ` : ${i.currentBlock.reason.replace(/^Label « (.*) »$/, '$1')}` : ''}`]),
        ...late.map((x) => [x.key, `en cours depuis ${x.age} j (d’habitude ${aging.thresholds.p50} j)`]),
      ]),
    },
    team,
    unassigned,
    forecast: snap.forecast || null,
    questions,
  };
}

// ---------------------------------------------------------------------------
// Sprint Review : ce qui est livré, ce qui ne l'est pas et pourquoi, les messages à porter
// ---------------------------------------------------------------------------
function review(snap, thought, names) {
  const m = snap.metrics;
  const done = snap.issues.filter((i) => i.done);
  const notDone = snap.issues.filter((i) => !i.done);
  // Livré, regroupé par fonctionnalité (ticket parent) ou projet ; le reste dans « Autres tickets »
  const groups = new Map();
  for (const i of done) {
    const g = i.epic && i.epic !== 'Sans epic' ? i.epic : 'Autres tickets';
    groups.set(g, [...(groups.get(g) || []), i.key]);
  }
  const delivered = [...groups].map(([name, keys]) => ({ name, issues: keys }))
    .sort((x, y) => (x.name === 'Autres tickets') - (y.name === 'Autres tickets') || y.issues.length - x.issues.length);
  const reason = (i) => (i.blockedNow ? `bloqué${i.currentBlock?.reason ? ` : ${i.currentBlock.reason.replace(/^Label « (.*) »$/, '$1')}` : ''}` : i.status === 'todo' ? 'pas démarré' : 'en cours, pas terminé');
  const count = (pred) => notDone.filter(pred).length;
  const features = snap.features || [];
  const goalTotal = m.goalTotal;
  return {
    anticipated: !snap.closed,
    day: `${snap.dayIndex}/${snap.totalDays}`,
    goalSet: !/non renseigné/i.test(snap.sprint.goal || ''),
    goal: snap.sprint.goal,
    keyItems: goalTotal ? { done: m.goalDone, total: goalTotal } : null,
    keyMessages: [
      `${m.doneCount} ticket${m.doneCount > 1 ? 's' : ''} livré${m.doneCount > 1 ? 's' : ''} sur ${m.scopeCount}${m.scopePoints ? ` (${m.donePoints} point${m.donePoints > 1 ? 's' : ''} estimé${m.donePoints > 1 ? 's' : ''} sur ${m.scopePoints})` : ''}.`,
      features.length ? `${features.filter((x) => x.complete).length} fonctionnalité${features.filter((x) => x.complete).length > 1 ? 's' : ''} sur ${features.length} entièrement terminée${features.filter((x) => x.complete).length > 1 ? 's' : ''} (tous les sous-tickets livrés).` : null,
      goalTotal ? (m.goalDone === goalTotal ? `Les ${goalTotal} éléments clés (« commitment prod ») sont livrés.` : `${m.goalDone} élément${m.goalDone > 1 ? 's' : ''} clé${m.goalDone > 1 ? 's' : ''} sur ${goalTotal} livré${m.goalDone > 1 ? 's' : ''} (« commitment prod »).`) : null,
      m.unplannedCount ? `${m.unplannedCount} ticket${m.unplannedCount > 1 ? 's sont arrivés' : ' est arrivé'} en cours de sprint, en plus du Planning.` : null,
      notDone.length ? `${notDone.length} ticket${notDone.length > 1 ? 's ne sont pas terminés' : ' n’est pas terminé'} : ${[[count((i) => i.blockedNow), 'bloqué'], [count((i) => !i.blockedNow && i.status !== 'todo'), 'en cours'], [count((i) => !i.blockedNow && i.status === 'todo'), 'pas démarré']].filter(([n]) => n).map(([n, w]) => `${n} ${w}${n > 1 && w !== 'en cours' ? 's' : ''}`).join(', ')}.` : 'Tout ce qui était prévu est livré.',
    ].filter(Boolean),
    delivered,
    notDelivered: { issues: notDone.map((i) => i.key), notes: Object.fromEntries(notDone.map((i) => [i.key, reason(i)])) },
    feedback: snap.review?.feedback || [],
  };
}

// ---------------------------------------------------------------------------
// Rétrospective : les faits du sprint, les sujets à discuter, les actions à tester
// ---------------------------------------------------------------------------
function retrospective(snap, thought, history, names) {
  // Chronologie regroupée par jour, sans doublons
  const days = new Map();
  const day = (d) => days.get(d) || (days.set(d, { date: d, added: new Set(), reopened: new Set(), blocked: new Set(), unblocked: new Set(), keyDone: new Set() }), days.get(d));
  for (const i of snap.issues) {
    for (const b of i.blocks) {
      day(b.from).blocked.add(i.key);
      if (b.to) day(b.to).unblocked.add(i.key);
    }
    if (i.addedMidSprint) day(i.addedDate).added.add(i.key);
    for (let k = 1; k < i.history.length; k++) if (i.history[k - 1].to === 'done' && i.history[k].to !== 'done') day(i.history[k].date).reopened.add(i.key);
    if (i.goal && i.done) day(i.doneDate).keyDone.add(i.key);
  }
  const phrase = (set, one, many) => (set.size ? `${set.size} ${set.size > 1 ? many : one} (${[...set].join(', ')})` : null);
  const timeline = [...days.values()].sort((x, y) => x.date.localeCompare(y.date)).map((d) => ({
    date: d.date,
    events: [
      phrase(d.added, 'ticket ajouté', 'tickets ajoutés'),
      phrase(d.reopened, 'ticket rouvert', 'tickets rouverts'),
      phrase(d.blocked, 'ticket bloqué', 'tickets bloqués'),
      phrase(d.unblocked, 'ticket débloqué', 'tickets débloqués'),
      phrase(d.keyDone, 'élément clé livré', 'éléments clés livrés'),
    ].filter(Boolean),
  })).filter((d) => d.events.length);

  const prev = history.filter((h) => h.snap.closed && h.snap.sprint.id !== snap.sprint.id).at(-1);
  const previousActions = (prev?.snap.retro?.actions || []).map((a) => ({ ...a, owner: names(a.owner) }));
  const m = snap.metrics;
  return {
    anticipated: !snap.closed,
    day: `${snap.dayIndex}/${snap.totalDays}`,
    dataCards: [
      { label: 'Tickets livrés', value: `${m.doneCount} / ${m.scopeCount}` },
      { label: 'Tickets planifiés livrés', value: m.planningAccuracy == null ? '—' : `${m.plannedDoneCount} / ${m.plannedCount}`, hint: pct(m.planningAccuracy) },
      { label: 'Tickets arrivés en cours de sprint', value: m.unplannedCount, hint: `${pct(m.unplannedRatio)} du sprint` },
      { label: 'Tickets rouverts', value: m.reopenCount, hint: 'revenus après « terminé »' },
      { label: 'Tickets bloqués à un moment', value: snap.issues.filter((i) => i.blockedDays > 0).length },
    ],
    timeline,
    previousActions,
    topics: thought.signals.slice(0, 3).map((sg) => ({ title: sg.title, narrative: sg.narrative, question: sg.question, issues: sg.issues, notes: sg.notes, rows: sg.rows })),
    questions: ['Qu’est-ce qui a bien fonctionné et que nous voulons garder ?', ...thought.signals.slice(0, 3).map((sg) => sg.question)].filter((q, i, a) => a.indexOf(q) === i).slice(0, 4),
    experiments: thought.recommendations.slice(0, 2).map((r) => ({ action: r.text, owner: r.owner, measure: `À vérifier au prochain sprint : « ${r.because} » doit s’améliorer.` })),
  };
}

// ---------------------------------------------------------------------------
// Préparation du prochain Sprint Planning
// ---------------------------------------------------------------------------
function planning(snap, thought, history, dataset, names) {
  const closed = history.filter((h) => h.snap.closed).slice(-3);
  const rates = closed.map((h) => h.snap.metrics.velocityPerPersonDay).filter(Boolean);
  const idx = dataset.sprints.findIndex((s) => s.id === snap.sprint.id);
  const next = dataset.sprints[idx + 1] || dataset.nextSprint;
  const holidays = dataset.meta?.holidays || [];
  let capacity = null;
  if (next) {
    const days = workingDays(next.start, next.end, holidays);
    const members = deliveryMembers(dataset.team, next).map((m) => {
      const off = (next.absences?.[m.id] || []).filter((d) => days.includes(d));
      return { member: names(m.id), role: m.role, days: (days.length - off.length) * (m.allocation ?? 1), absences: off.length, allocation: m.allocation ?? 1 };
    });
    capacity = { sprint: next.name, start: next.start, end: next.end, workingDays: days.length, personDays: sum(members, (x) => x.days), members };
  }
  const buffer = Math.round(mean(closed.map((h) => h.snap.metrics.addedPoints)) || 0);
  let range = null;
  if (capacity && rates.length) {
    const low = Math.round(quantile(rates, 0.2) * capacity.personDays);
    const high = Math.round(mean(rates) * capacity.personDays);
    range = { low, high, buffer, recommended: Math.max(0, Math.round((low + high) / 2) - buffer) };
  }

  const recurringDeps = new Set(thought.signals.filter((s) => s.type === 'recurring_dependency' || s.type === 'dependency_bottleneck').map((s) => s.meta?.dependency));
  const challenge = (item, origin) => {
    const flags = [];
    if (item.points == null) flags.push({ level: 'high', text: 'Non estimé' });
    if (item.points >= 13) flags.push({ level: 'high', text: 'Trop gros pour un sprint : à découper' });
    else if (item.points >= 8) flags.push({ level: 'medium', text: 'Taille importante : envisager un découpage' });
    if (item.acceptanceCriteria === false) flags.push({ level: 'high', text: 'Critères d’acceptation absents (Definition of Ready)' });
    if (item.dependency && item.dependencyConfirmed !== true) flags.push({ level: recurringDeps.has(item.dependency) ? 'high' : 'medium', text: `Dépend de « ${item.dependency} » sans confirmation${recurringDeps.has(item.dependency) ? ' — dépendance déjà problématique' : ''}` });
    if (item.carriedOver >= 1) flags.push({ level: item.carriedOver >= 2 ? 'high' : 'medium', text: `Déjà reporté ${item.carriedOver} fois : la valeur et le découpage sont-ils toujours pertinents ?` });
    if (item.churn >= 2) flags.push({ level: 'medium', text: 'Besoin modifié plusieurs fois : affinage nécessaire' });
    if (item.notes) flags.push({ level: 'medium', text: item.notes });
    return { key: item.key, title: item.title, points: item.points, origin, flags, ready: !flags.some((f) => f.level === 'high') };
  };
  const carry = snap.issues.filter((i) => !i.done).map((i) => challenge({ ...i, carriedOver: i.carriedOver, dependency: i.blocks.find((b) => b.to == null)?.dependency, dependencyConfirmed: false }, 'Non terminé dans le sprint en cours'));
  const isLatest = idx === dataset.sprints.length - 1;
  const backlog = isLatest ? (dataset.backlog || []).sort((a, b) => a.priority - b.priority).map((b) => challenge(b, 'Backlog produit')) : [];
  const candidates = [...carry, ...backlog];

  return {
    capacity,
    range,
    velocityHistory: closed.map((h) => ({ sprint: h.snap.sprint.name, done: h.snap.metrics.donePoints, committed: h.snap.metrics.committedPoints, perPersonDay: round(h.snap.metrics.velocityPerPersonDay, 2) })),
    candidates,
    readyPoints: sum(candidates.filter((c) => c.ready), (c) => c.points || 0),
    toChallenge: candidates.filter((c) => !c.ready),
    preconditions: [
      ...[...recurringDeps].filter(Boolean).map((d) => `Obtenir une confirmation écrite de « ${d} » (date, interlocuteur) avant d’engager les tickets dépendants.`),
      buffer ? `Réserver ~${buffer} points pour les urgences (moyenne des ajouts des derniers sprints).` : null,
      capacity?.members.some((m) => m.absences) ? `Tenir compte des absences : ${capacity.members.filter((m) => m.absences).map((m) => `${m.member} (${m.absences} j)`).join(', ')}.` : null,
    ].filter(Boolean),
    questions: [
      'Quel objectif de sprint unique et vérifiable voulons-nous viser ?',
      'Quels éléments sont prêts (critères d’acceptation, dépendances confirmées) et lesquels ne le sont pas ?',
      range ? `Sommes-nous prêts à nous engager autour de ${range.recommended} points, en dessous de ce que nous voudrions ?` : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Rapport (Markdown) — pour le management ou la Review
// ---------------------------------------------------------------------------
export function reportMarkdown({ snap, thought, prepared, learned, flow, objectives }) {
  const m = snap.metrics;
  const L = [];
  L.push(`# Sobrus AI Copilot — ${snap.sprint.name}`);
  L.push(`*Objectif : ${snap.sprint.goal}* — ${snap.closed ? 'Sprint terminé' : `En cours (jour ${snap.dayIndex}/${snap.totalDays}, au ${snap.asOf})`}`);
  L.push('');
  L.push(`> ${thought.headline}`);
  L.push('');
  L.push(`**Santé du sprint : ${thought.health}/100 (${thought.healthLabel})**`);
  L.push('');
  L.push('## Chiffres clés');
  L.push(`- Tickets terminés : ${m.doneCount}/${m.scopeCount} · points estimés terminés : ${m.donePoints}/${m.scopePoints}${m.openUnestimated ? ` (${m.openUnestimated} ticket${m.openUnestimated > 1 ? 's' : ''} restant${m.openUnestimated > 1 ? 's' : ''} sans estimation)` : ''}`);
  if (m.planningAccuracy != null) L.push(`- Précision du Planning : ${pct(m.planningAccuracy)} des tickets planifiés livrés · le planifié représente ${pct(m.plannedShareOfDone)} du livré`);
  L.push(`- Objectif : ${m.goalDone}/${m.goalTotal} éléments clés terminés`);
  L.push(`- Ajouts en cours de sprint : +${m.addedPoints} pts · Jours-ticket bloqués : ${m.blockedIssueDays} · Tickets rouverts : ${m.reopenCount}`);
  if (snap.forecast) L.push(`- Probabilité de terminer le périmètre : ${pct(snap.forecast.probability)} (~${Math.round(snap.forecast.expected)} ${snap.forecast.unit} attendus sur ${snap.forecast.remaining} restants)`);
  L.push('');
  if (flow) {
    L.push('');
    L.push('## Flux');
    const u = flow.unplanned;
    if (u.count) L.push(`- Travail imprévu : ${u.count} tickets (${pct(u.ratio)}) — ${u.byOrigin.map((o) => `${o.origin.toLowerCase()} ${o.count}`).join(', ')}`);
    const stages = flow.cycle.stages.filter((s) => s.median != null);
    if (stages.length) L.push(`- Cycle time médian par étape (jours ouvrés) : ${stages.map((s) => `${s.label.toLowerCase()} ${s.median}`).join(' → ')}${flow.cycle.bottleneck ? ` · étape la plus longue : ${flow.cycle.bottleneck.label.toLowerCase()}` : ''}`);
    if (flow.cycle.leadToProd) L.push(`- Délai médian du début du développement à la PROD : ${flow.cycle.leadToProd.median} jours ouvrés (${pct(flow.cycle.leadToProd.share)} des tickets terminés sont en PROD)`);
    if (flow.blockages.ticketDays) L.push(`- Blocages : ${flow.blockages.ticketDays} jours-ticket — ${flow.blockages.byCause.slice(0, 3).map((c) => `${c.cause} ${c.ticketDays} j`).join(', ')}`);
  }
  if (objectives) {
    L.push('');
    L.push('## Objectifs');
    const a = objectives.allocation.at(-1);
    if (a?.done) L.push(`- Répartition du travail livré : ${a.byCategory.filter((c) => c.count).map((c) => `${c.category.toLowerCase()} ${pct(c.share)}`).join(', ')}`);
    const g = objectives.goals.at(-1);
    if (g) L.push(`- Objectif de sprint : ${g.goalSet ? `« ${g.goal} »` : 'non renseigné dans Linear'}${g.keyItems ? ` · éléments clés livrés ${g.keyDone}/${g.keyItems}` : ''}`);
    for (const p of objectives.projects.worked) {
      const eta = p.eta?.done ? 'terminé' : p.eta?.slow ? 'avance très lentement' : p.eta?.date ? `fin prévisible vers le ${p.eta.date}` : 'fin non prévisible';
      L.push(`- Projet « ${p.name} » : ${p.issues ? `${p.issues.done}/${p.issues.total} tickets terminés` : ''}, ${eta}${p.alerts.length ? ` (${p.alerts.join(' ; ')})` : ''}`);
    }
  }
  L.push('');
  L.push('## Insights');
  for (const i of thought.insights) {
    L.push(`### ${i.label} — ${i.level.label}`);
    L.push(i.narrative);
    for (const s of i.signals) L.push(`- **${s.title}**${s.evidence.length ? ` — ${s.evidence.slice(0, 3).join(' ; ')}` : ''}`);
    L.push(`- *Question à poser :* ${i.questions[0]}`);
    L.push('');
  }
  if (thought.crossReadings.length) {
    L.push('## Lecture transverse');
    for (const c of thought.crossReadings) L.push(`- ${c}`);
    L.push('');
  }
  L.push('## Recommandations (à valider par l’équipe)');
  for (const r of thought.recommendations) L.push(`- ${r.text} *(${r.owner} — parce que : ${r.because})*`);
  L.push('');
  L.push('## Ce qui change dans notre manière de travailler');
  L.push(learned.headline);
  for (const s of learned.shifts) L.push(`- **${s.title}** : ${s.text}`);
  for (const p of learned.patterns) L.push(`- ${p.title} — ${p.detail}`);
  L.push('');
  if (prepared.planning.range) {
    L.push('## Prochain Sprint Planning');
    L.push(`- Équipe ${prepared.planning.capacity.sprint} : ${prepared.planning.capacity.members.map((m) => `${m.member}${m.role ? ` (${m.role})` : ''}${m.absences ? `, absent ${m.absences} j` : ''}`).join(', ')}`);
    L.push(`- Fourchette réaliste : ${prepared.planning.range.low}–${prepared.planning.range.high} pts, engagement suggéré ≈ ${prepared.planning.range.recommended} pts (buffer urgences ${prepared.planning.range.buffer} pts)`);
    for (const c of prepared.planning.toChallenge) L.push(`- À challenger : ${c.key} ${c.title} — ${c.flags.map((f) => f.text).join(' ; ')}`);
    L.push('');
  }
  L.push('---');
  L.push('*Généré par Sobrus AI Copilot. Ces éléments sont des observations et des hypothèses destinées à nourrir la discussion de l’équipe ; ils ne remplacent ni le jugement du Scrum Master, ni celui du Product Owner, ni celui de l’équipe.*');
  return L.join('\n');
}

export function prepare(snap, thought, history, dataset) {
  const names = (id) => dataset.team.find((m) => m.id === id)?.name || id;
  return {
    daily: daily(snap, thought, history, dataset.meta?.holidays || [], names),
    review: review(snap, thought, names),
    retro: retrospective(snap, thought, history, names),
    planning: planning(snap, thought, history, dataset, names),
  };
}
