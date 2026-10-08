// 04 — PREPARE
// Prépare les cérémonies et le reporting à partir des insights.
// Tout ce qui est produit ici est un brouillon pour le Scrum Master, le PO et l'équipe :
// des points d'attention et des questions, jamais des décisions.

import { STATUS_LABELS, ACTIVE_STATUSES } from './observe.js';
import { workingDays } from '../lib/calendar.js';
import { mean, sum, round, pct, quantile } from '../lib/stats.js';

const pts = (i) => i.points || 0;

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------
function daily(snap, thought, names) {
  const idx = snap.days.filter((d) => d <= snap.asOf).length - 1;
  const yesterday = snap.days[Math.max(0, idx - 1)];
  const moved = snap.issues
    .flatMap((i) => i.history.filter((h) => h.date >= yesterday && h.date <= snap.asOf).map((h) => ({ key: i.key, title: i.title, to: h.to, date: h.date, assignee: i.assignee })));
  const blocked = snap.issues.filter((i) => i.blockedNow);
  const stuck = snap.issues.filter((i) => ACTIVE_STATUSES.includes(i.status) && i.ageInStatus >= 3 && !i.blockedNow);
  const goalOpen = snap.issues.filter((i) => i.goal && !i.done);
  const questions = [
    ...blocked.map((i) => `${i.key} est bloqué depuis ${i.blockedDays} j (${i.currentBlock?.reason}). Quelle action aujourd’hui, et qui la porte ?`),
    ...stuck.map((i) => `${i.key} est ${STATUS_LABELS[i.status].toLowerCase()} depuis ${i.ageInStatus} j. ${names(i.assignee)}, de quoi as-tu besoin pour le terminer ?`),
    goalOpen.length ? `Qu’est-ce qui nous rapproche le plus de l’objectif aujourd’hui : « ${snap.sprint.goal} » ?` : null,
  ].filter(Boolean);
  return {
    date: snap.asOf,
    day: `${snap.dayIndex}/${snap.totalDays}`,
    sprintGoal: snap.sprint.goal,
    moved,
    blocked: blocked.map((i) => ({ key: i.key, title: i.title, assignee: names(i.assignee), days: i.blockedDays, reason: i.currentBlock?.reason, dependency: i.currentBlock?.dependency })),
    stuck: stuck.map((i) => ({ key: i.key, title: i.title, assignee: names(i.assignee), status: STATUS_LABELS[i.status], days: i.ageInStatus })),
    goalProgress: { done: snap.metrics.goalDone, total: snap.metrics.goalTotal, open: goalOpen.map((i) => ({ key: i.key, title: i.title, status: STATUS_LABELS[i.status], blocked: i.blockedNow })) },
    forecast: snap.forecast || null,
    questions,
    tip: 'Le Daily sert à piloter l’objectif du sprint, pas à faire un tour de table de statut : commencez par les tickets les plus proches du « Terminé ».',
  };
}

// ---------------------------------------------------------------------------
// Sprint Review
// ---------------------------------------------------------------------------
function review(snap, thought, names) {
  const done = snap.issues.filter((i) => i.done);
  const notDone = snap.issues.filter((i) => !i.done);
  const byEpic = {};
  for (const i of done) (byEpic[i.epic] ||= []).push({ key: i.key, title: i.title, points: i.points, goal: i.goal });
  const reason = (i) => (i.blockedNow || i.currentBlock ? `bloqué (${i.currentBlock?.reason || 'blocage'})` : i.status === 'todo' ? 'non démarré' : i.churn >= 2 ? `besoin modifié en cours de sprint (${STATUS_LABELS[i.status].toLowerCase()})` : STATUS_LABELS[i.status].toLowerCase());
  const goalReached = snap.metrics.goalTotal > 0 && snap.metrics.goalDone === snap.metrics.goalTotal;
  const demo = [...done].sort((a, b) => Number(b.goal) - Number(a.goal) || pts(b) - pts(a)).filter((i) => i.type !== 'task').slice(0, 5)
    .map((i) => ({ key: i.key, title: i.title, presenter: names(i.assignee) }));
  const negative = (snap.review?.feedback || []).filter((f) => f.sentiment === 'negative');
  return {
    anticipated: !snap.closed,
    goal: snap.sprint.goal,
    goalStatus: goalReached ? 'atteint' : snap.metrics.goalDone > 0 ? 'partiellement atteint' : 'non atteint',
    goalDetail: `${snap.metrics.goalDone}/${snap.metrics.goalTotal} éléments clés terminés`,
    delivered: Object.entries(byEpic).map(([epic, items]) => ({ epic, items, points: sum(items, pts) })),
    notDelivered: notDone.map((i) => ({ key: i.key, title: i.title, points: i.points, reason: reason(i) })),
    scopeAdded: snap.issues.filter((i) => i.addedMidSprint).map((i) => ({ key: i.key, title: i.title, points: i.points })),
    feedback: snap.review?.feedback || [],
    demo,
    keyMessages: [
      `${snap.metrics.donePoints} points livrés sur ${snap.metrics.scopePoints} (${pct(snap.metrics.completionRatio)}).`,
      goalReached ? 'L’objectif du sprint est atteint.' : `L’objectif du sprint n’est pas entièrement atteint (${snap.metrics.goalDone}/${snap.metrics.goalTotal}).`,
      ...thought.insights.filter((i) => i.severity >= 0.5 && ['dependencies', 'scope', 'predictability'].includes(i.theme)).map((i) => `Point d’attention à partager : ${i.headline}.`),
    ],
    questionsForStakeholders: [
      'Ce qui a été livré correspond-il à ce dont les pharmacies ont besoin en priorité ?',
      notDone.some((i) => i.goal) ? 'Faut-il maintenir la priorité des éléments non terminés de l’objectif pour le prochain sprint ?' : null,
      snap.issues.some((i) => i.addedMidSprint) ? 'Comment mieux canaliser les demandes urgentes pour protéger le sprint ?' : null,
      thought.signals.some((s) => s.theme === 'dependencies') ? 'Qui, côté management, peut aider à débloquer la dépendance partenaire ?' : null,
      negative.length ? 'Quelle information vous permettrait d’avoir confiance dans la prévision de livraison ?' : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Rétrospective
// ---------------------------------------------------------------------------
const FORMATS = {
  dependencies: { name: 'Sailboat (voilier)', why: 'les ancres (blocages, dépendances) dominent ce sprint : le format aide à distinguer ce qui freine de ce qui fait avancer et des risques à venir (rochers).' },
  flow: { name: 'Timeline du flux + Mad / Sad / Glad', why: 'le sujet principal est le flux : reconstituer la chronologie du sprint rend visibles les temps d’attente.' },
  scope: { name: 'Start / Stop / Continue (focalisé sur l’arrivée des demandes)', why: 'le périmètre a bougé : il s’agit de redéfinir les règles d’entrée dans le sprint.' },
  predictability: { name: 'Speedboat avec la prévision vs le réel', why: 'l’écart entre l’engagement et la livraison est le fil rouge du sprint.' },
  quality: { name: '4L (Liked, Learned, Lacked, Longed for)', why: 'la qualité est en jeu : le format ouvre la discussion sur ce qui a manqué.' },
  team: { name: 'Team Radar + check-in émotionnel', why: 'des signaux portent sur la charge et le ressenti : commencer par l’humain.' },
  improvement: { name: 'Retro of retros', why: 'les actions passées ne sont pas appliquées : il faut d’abord comprendre pourquoi.' },
  stakeholders: { name: 'Mad / Sad / Glad', why: 'le feedback des parties prenantes est le point saillant.' },
};

function retrospective(snap, thought, history, names) {
  const top = thought.insights[0];
  const format = FORMATS[top?.theme] || { name: 'Mad / Sad / Glad', why: 'sprint sans tension dominante : un format ouvert suffit.' };
  const timeline = [];
  for (const i of snap.issues) {
    for (const b of i.blocks) {
      timeline.push({ date: b.from, kind: 'block', text: `${i.key} bloqué : ${b.reason}` });
      if (b.to) timeline.push({ date: b.to, kind: 'unblock', text: `${i.key} débloqué` });
    }
    if (i.addedMidSprint) timeline.push({ date: i.addedDate, kind: 'scope', text: `Ajout de ${i.key} (+${i.points} pts)` });
    for (let k = 1; k < i.history.length; k++) if (i.history[k - 1].to === 'done' && i.history[k].to !== 'done') timeline.push({ date: i.history[k].date, kind: 'reopen', text: `${i.key} rouvert` });
    for (const c of i.changes) timeline.push({ date: c.date, kind: 'change', text: `${i.key} : ${c.field} ${c.from} → ${c.to}` });
    if (i.goal && i.done) timeline.push({ date: i.doneDate, kind: 'goal', text: `${i.key} terminé (objectif)` });
  }
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  const prev = history.filter((h) => h.snap.closed && h.snap.sprint.id !== snap.sprint.id).at(-1);
  const previousActions = (prev?.snap.retro?.actions || []).map((a) => ({ ...a, owner: names(a.owner) }));
  const m = snap.metrics;
  return {
    anticipated: !snap.closed,
    format,
    dataCards: [
      { label: 'Points livrés', value: `${m.donePoints}/${m.scopePoints}` },
      { label: 'Fiabilité de l’engagement', value: pct(m.sayDo) },
      { label: 'Cycle time moyen', value: m.avgCycleTime ? `${round(m.avgCycleTime)} j` : '—' },
      { label: 'Jours-ticket bloqués', value: m.blockedIssueDays },
      { label: 'Ajouts en cours de sprint', value: `+${m.addedPoints} pts` },
      { label: 'Tickets rouverts', value: m.reopenCount },
    ],
    timeline,
    previousActions,
    themes: thought.insights.slice(0, 4).map((i) => ({ label: i.label, headline: i.headline, level: i.level.label })),
    questions: [...new Set([...thought.insights.flatMap((i) => i.questions), 'Qu’est-ce qui a bien fonctionné et que nous voulons protéger ?'])].slice(0, 7),
    experiments: thought.recommendations.slice(0, 2).map((r) => ({
      hypothesis: `Si nous appliquons « ${r.text} », alors « ${r.because} » devrait diminuer au prochain sprint.`,
      owner: r.owner,
      measure: 'À vérifier automatiquement par le Copilot lors de la prochaine analyse.',
    })),
    facilitationNotes: [
      'Présenter les données comme un point de départ, pas comme un jugement.',
      'Laisser l’équipe formuler ses propres causes avant de montrer les hypothèses du Copilot.',
      'Repartir avec 1 ou 2 actions maximum, avec un responsable et une date.',
    ],
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
    const members = dataset.team.filter((m) => m.delivery !== false).map((m) => {
      const off = (next.absences?.[m.id] || []).filter((d) => days.includes(d));
      return { member: names(m.id), days: days.length - off.length, absences: off.length };
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
  const carry = snap.issues.filter((i) => !i.done).map((i) => challenge({ ...i, carriedOver: i.carriedOver + 1, dependency: i.blocks.find((b) => b.to == null)?.dependency, dependencyConfirmed: false }, 'Report du sprint'));
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
      'Quelle action de la dernière rétrospective intégrons-nous dans ce sprint ?',
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Registre des risques
// ---------------------------------------------------------------------------
function risks(thought) {
  return thought.signals
    .filter((s) => ['dependencies', 'predictability', 'team', 'quality', 'scope'].includes(s.theme) && s.severity >= 0.3)
    .map((s) => ({
      title: s.title,
      theme: s.theme,
      probability: s.severity >= 0.7 ? 'Élevée' : s.severity >= 0.5 ? 'Moyenne' : 'Faible',
      impact: s.issues.length >= 3 || /objectif/i.test(s.title) ? 'Fort' : 'Modéré',
      mitigation: s.recommendation?.text,
      owner: s.recommendation?.owner,
      severity: s.severity,
    }));
}

// ---------------------------------------------------------------------------
// Rapport (Markdown) — pour le management ou la Review
// ---------------------------------------------------------------------------
export function reportMarkdown({ snap, thought, prepared, learned }) {
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
  L.push(`- Points terminés : ${m.donePoints}/${m.scopePoints} (${pct(m.completionRatio)})`);
  if (m.sayDo != null) L.push(`- Fiabilité de l’engagement : ${pct(m.sayDo)}`);
  L.push(`- Objectif : ${m.goalDone}/${m.goalTotal} éléments clés terminés`);
  L.push(`- Ajouts en cours de sprint : +${m.addedPoints} pts · Jours-ticket bloqués : ${m.blockedIssueDays} · Tickets rouverts : ${m.reopenCount}`);
  if (snap.forecast) L.push(`- Probabilité de terminer le périmètre : ${pct(snap.forecast.probability)} (~${Math.round(snap.forecast.expectedPoints)} pts attendus sur ${snap.forecast.remainingPoints} restants)`);
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
  L.push('## Risques');
  for (const r of prepared.risks.slice(0, 6)) L.push(`- ${r.title} — probabilité ${r.probability}, impact ${r.impact}. Mitigation : ${r.mitigation}`);
  L.push('');
  L.push('## Ce qui change dans notre manière de travailler');
  L.push(learned.headline);
  for (const s of learned.shifts) L.push(`- **${s.title}** : ${s.text}`);
  for (const p of learned.patterns) L.push(`- ${p.title} — ${p.detail}`);
  L.push('');
  if (prepared.planning.range) {
    L.push('## Prochain Sprint Planning');
    L.push(`- Capacité ${prepared.planning.capacity.sprint} : ${prepared.planning.capacity.personDays} jours-personne`);
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
    daily: daily(snap, thought, names),
    review: review(snap, thought, names),
    retro: retrospective(snap, thought, history, names),
    planning: planning(snap, thought, history, dataset, names),
    risks: risks(thought),
  };
}
