// Connecteur Linear → modèle de données Sobrus AI Copilot.
//
// Règles Sobrus (validées avec l'équipe) :
//  - les statuts suivent les types Linear : completed = terminé (« Done à tester » inclus),
//    started = en cours, backlog / unstarted / triage = à faire ;
//  - « Stuck » (typé canceled dans Linear) = BLOQUÉ, pas annulé ;
//  - « Todo for Dev » (typé started dans Linear) = À FAIRE pour les indicateurs de flux ;
//  - « Design validé » est un statut terminé ;
//  - les points sont l'estimation Linear (0–7) ; les parents ne sont pas estimés :
//    une issue parent dont les sous-issues sont dans le cycle est suivie à travers elles ;
//  - les labels d'attente (« Besoin du Backend », « En Standby »…) sont lus comme des blocages ;
//  - le label « commitment prod » marque l'objectif du sprint ;
//  - les dates sont converties en heure du Maroc (Linear stocke en UTC).

import { linear, paginate } from './linear-client.js';
import { addDays } from '../lib/calendar.js';

const TZ = 'Africa/Casablanca';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const localDate = (ts) => (ts ? dayFmt.format(new Date(ts)) : null);
const HOUR = 3600e3;
const PAGE = Number(process.env.LINEAR_PAGE_SIZE || 8); // limite de complexité GraphQL Linear
const ms = (ts) => new Date(ts).getTime();

// Conventions de labels, communes aux équipes Sobrus (comparaison insensible à la casse :
// Supply écrit « En Standby », Central « En standby »).
export const LABELS = {
  blocking: ['En Standby'],
  // Tout label commençant par « Besoin » (« Besoin du Backend », « Besoin de yahya »…) est une attente.
  waiting: ['à discuter', 'Testing/Manque de détails'],
  quality: ['regression', 'Testing/Bug', 'Retour code review', 'Bug'],
  goal: ['commitment prod'],
  notReady: ['Testing/Manque de détails', 'à discuter', 'Update the description'],
};
const norm = (l) => l.trim().toLowerCase();
const inList = (list, l) => list.some((x) => norm(x) === norm(l));
const isWaiting = (l) => /^besoin\b/i.test(l.trim()) || inList(LABELS.waiting, l);
const isBlocking = (l) => inList(LABELS.blocking, l) || isWaiting(l);
const isGoal = (l) => inList(LABELS.goal, l);
const isNotReady = (l) => /^besoin\b/i.test(l.trim()) || inList(LABELS.notReady, l);
const labelName = (l) => (l.parent ? `${l.parent.name}/${l.name}` : l.name);

const STUCK = 'Stuck';
// Statuts typés « started » dans Linear mais qui signifient « pas encore commencé » (validé avec l'équipe).
// Ne change rien dans Linear : sert uniquement aux indicateurs de flux (WIP, tickets immobiles, cycle time).
const NOT_STARTED = (process.env.LINEAR_TODO_STATES || 'Todo for Dev').split(',').map((x) => x.trim());
function mapState(state) {
  if (!state) return null;
  if (state.name === STUCK) return 'blocked';
  if (NOT_STARTED.includes(state.name)) return 'todo';
  switch (state.type) {
    case 'completed': return 'done';
    case 'started': return 'in_progress';
    case 'canceled':
    case 'duplicate': return 'canceled';
    default: return 'todo';
  }
}

const ISSUE_FIELDS = `
  id identifier title description estimate priority createdAt completedAt canceledAt
  state { name type }
  assignee { id name email }
  parent { identifier title labels { nodes { name parent { name } } } }
  children(first: 30) { nodes { identifier title estimate state { name type } cycle { id } } }
  project { name }
  labels { nodes { name parent { name } } }
  history(first: 50) { nodes {
    createdAt fromCycleId toCycleId fromEstimate toEstimate
    fromState { name type } toState { name type }
    addedLabels { name parent { name } } removedLabels { name parent { name } }
  } }
  comments(first: 10) { nodes { body createdAt user { id } } }`;

const cycleIssues = (connection) => `query($id: String!, $first: Int, $after: String) {
  cycle(id: $id) { ${connection}(first: $first, after: $after) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } } }
}`;

/** Transforme une issue Linear en issue du modèle Copilot, vue depuis un cycle donné. */
export function buildIssue(raw, cycle, nowTs = Date.now()) {
  const startTs = ms(cycle.startsAt);
  const endTs = Math.min(ms(cycle.endsAt), nowTs);
  const start = localDate(cycle.startsAt);
  const hist = [...raw.history.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Entrée dans le cycle : un ajout dans les 2 premières heures compte comme engagement initial
  const entries = hist.filter((h) => h.toCycleId === cycle.id);
  const enteredTs = entries.length ? ms(entries[0].createdAt) : ms(raw.createdAt);
  const addedTs = enteredTs > startTs + 2 * HOUR ? enteredTs : startTs;
  const exit = hist.find((h) => h.fromCycleId === cycle.id && h.toCycleId !== cycle.id && ms(h.createdAt) > addedTs && ms(h.createdAt) < ms(cycle.endsAt) - HOUR);

  // Reports : déplacements de cycle en cycle avant l'entrée dans celui-ci
  const carriedOver = hist.filter((h) => h.fromCycleId && h.toCycleId && ms(h.createdAt) <= addedTs + 24 * HOUR).length;

  // Statut à l'entrée dans le cycle, puis transitions pendant le cycle
  const stateChanges = hist.filter((h) => h.toState);
  let initial = null;
  for (const h of stateChanges) if (ms(h.createdAt) <= addedTs) initial = h.toState;
  if (!initial) initial = stateChanges.find((h) => ms(h.createdAt) > addedTs)?.fromState ?? raw.state;

  const history = [];
  const blocks = [];
  let removedDate = exit ? localDate(exit.createdAt) : null;
  const openBlock = (date, reason, dependency) => {
    if (!blocks.some((b) => b.to == null && b.reason === reason)) blocks.push({ from: date, to: null, reason, dependency });
  };
  const closeBlocks = (date, reason) => blocks.filter((b) => b.to == null && (!reason || b.reason === reason)).forEach((b) => { b.to = date; });
  const applyState = (state, date) => {
    const s = mapState(state);
    if (s === 'blocked') {
      if (!history.length || history.at(-1).to === 'todo') history.push({ date, to: 'in_progress' });
      openBlock(date, 'Statut « Stuck »', null);
    } else if (s === 'canceled') {
      removedDate ||= date;
    } else {
      closeBlocks(date, 'Statut « Stuck »');
      if (s === 'done') closeBlocks(date);
      if (s !== 'todo' || history.length) history.push({ date, to: s });
    }
  };

  const addedDate = localDate(new Date(addedTs).toISOString());
  applyState(initial, addedDate);

  // Labels d'attente déjà présents à l'entrée
  const labelEvents = hist.filter((h) => (h.addedLabels?.length || h.removedLabels?.length) && ms(h.createdAt) > addedTs);
  const presentAtEntry = new Set(raw.labels.nodes.map(labelName));
  for (const h of labelEvents) {
    for (const l of h.addedLabels || []) presentAtEntry.delete(labelName(l));
    for (const l of h.removedLabels || []) presentAtEntry.add(labelName(l));
  }
  if (mapState(initial) !== 'done') {
    for (const l of presentAtEntry) if (isBlocking(l)) openBlock(addedDate, `Label « ${l} »`, isWaiting(l) ? l : null);
  }

  // Événements pendant le cycle, dans l'ordre chronologique
  const changes = [];
  for (const h of hist) {
    const t = ms(h.createdAt);
    if (t <= addedTs || t > endTs) continue;
    const date = localDate(h.createdAt);
    if (h.toState) applyState(h.toState, date);
    for (const l of h.addedLabels || []) {
      const n = labelName(l);
      if (isBlocking(n) && history.at(-1)?.to !== 'done') openBlock(date, `Label « ${n} »`, isWaiting(n) ? n : null);
    }
    for (const l of h.removedLabels || []) closeBlocks(date, `Label « ${labelName(l)} »`);
    if (h.fromEstimate != null && h.toEstimate != null && h.fromEstimate !== h.toEstimate) changes.push({ date, field: 'points', from: h.fromEstimate, to: h.toEstimate });
  }

  const labels = raw.labels.nodes.map(labelName);
  const parentLabels = raw.parent?.labels?.nodes.map(labelName) || [];
  const end = localDate(new Date(endTs).toISOString());
  return {
    key: raw.identifier,
    title: raw.title,
    type: labels.some((l) => /(^|\/)(bug|regression)$/i.test(l)) ? 'bug' : 'story',
    points: raw.estimate ?? null,
    epic: raw.parent?.title || raw.project?.name || labels.find((l) => /^Module /.test(l)) || 'Sans epic',
    parentKey: raw.parent?.identifier || null,
    project: raw.project?.name || null,
    isParent: raw.children.nodes.length > 0,
    assignee: raw.assignee?.id || 'non-assigne',
    goal: [...labels, ...parentLabels].some(isGoal),
    labels,
    // Historique complet des statuts Linear (y compris après la fin du cycle) : sert au cycle time
    // par étape (Todo for Dev → In Progress → Done à tester → Vérifié QA → OVH → PROD).
    stages: hist.filter((h) => h.toState).map((h) => ({ at: h.createdAt, date: localDate(h.createdAt), state: h.toState.name })),
    addedDate,
    removedDate,
    carriedOver,
    history,
    blocks,
    changes,
    comments: raw.comments.nodes
      .filter((c) => ms(c.createdAt) > startTs && ms(c.createdAt) <= endTs)
      .map((c) => ({ date: localDate(c.createdAt), author: c.user?.id || 'inconnu', text: c.body.replace(/\s+/g, ' ').slice(0, 400) })),
    _assignee: raw.assignee,
    _descriptionLength: (raw.description || '').trim().length,
    _end: end,
  };
}

async function fetchCycleIssues(cycle) {
  const pick = (conn) => (d) => d.cycle[conn];
  const inCycle = await paginate(cycleIssues('issues'), { id: cycle.id }, pick('issues'), PAGE);
  const moved = cycle.completedAt ? await paginate(cycleIssues('uncompletedIssuesUponClose'), { id: cycle.id }, pick('uncompletedIssuesUponClose'), PAGE) : [];
  const byId = new Map([...inCycle, ...moved].map((i) => [i.id, i]));
  return [...byId.values()];
}

/**
 * Fonctionnalités = issues parents du cycle, suivies par leurs sous-issues (règle Sobrus : un parent est
 * terminé quand toutes ses sous-issues le sont). État actuel de Linear : calculé pour le sprint en cours.
 * Les sous-issues planifiées dans aucun cycle (ou un autre) empêchent le parent de se terminer dans ce sprint.
 */
function featuresOf(raws, cycle) {
  const closedType = (k) => k.state.type === 'completed';
  return raws
    .filter((r) => r.children.nodes.length)
    .map((r) => {
      const kids = r.children.nodes.filter((k) => !['canceled', 'duplicate'].includes(k.state.type) || k.state.name === STUCK);
      const done = kids.filter(closedType);
      const labels = r.labels.nodes.map(labelName);
      return {
        key: r.identifier,
        title: r.title,
        state: r.state.name,
        goal: labels.some(isGoal),
        total: kids.length,
        done: done.length,
        points: kids.reduce((a, k) => a + (k.estimate || 0), 0),
        pointsDone: done.reduce((a, k) => a + (k.estimate || 0), 0),
        unestimated: kids.filter((k) => !closedType(k) && k.estimate == null).length,
        outside: kids.filter((k) => !closedType(k) && k.cycle?.id !== cycle.id).map((k) => ({ key: k.identifier, title: k.title, state: k.state.name })),
        complete: kids.length > 0 && done.length === kids.length,
      };
    })
    .sort((a, b) => a.done / a.total - b.done / b.total);
}

/** Retire les parents suivis à travers leurs sous-issues présentes dans le même cycle. */
function dropTrackedParents(issues) {
  const parentsWithChildren = new Set(issues.map((i) => i.parentKey).filter(Boolean));
  return issues.filter((i) => !(i.isParent && parentsWithChildren.has(i.key)));
}

export async function importFromLinear({ teamKey = 'SUPP', closedCycles = 6, sheets = null, teamConfig = {}, onProgress = () => {} } = {}) {
  const { teams } = await linear('{ teams(first: 100) { nodes { id key name } } }');
  const team = teams.nodes.find((t) => t.key === teamKey);
  if (!team) throw new Error(`Équipe Linear « ${teamKey} » introuvable`);

  const cycles = (await paginate(`query($id: String!, $first: Int, $after: String) {
    team(id: $id) { cycles(first: $first, after: $after) { nodes { id number name description startsAt endsAt completedAt isActive isFuture } pageInfo { hasNextPage endCursor } } }
  }`, { id: team.id }, (d) => d.team.cycles, 50)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const active = cycles.find((c) => c.isActive);
  const past = cycles.filter((c) => !c.isActive && !c.isFuture).slice(-closedCycles);
  const selected = [...past, ...(active ? [active] : [])];
  const next = cycles.find((c) => c.isFuture);

  const members = new Map();
  const sprints = [];
  for (const c of selected) {
    onProgress(`Cycle ${c.name || c.number}…`);
    const raws = await fetchCycleIssues(c);
    const issues = dropTrackedParents(raws.map((r) => buildIssue(r, c)));
    for (const i of issues) {
      if (i._assignee) members.set(i._assignee.id, i._assignee);
      delete i._assignee; delete i._descriptionLength; delete i._end;
    }
    sprints.push({
      id: `C${c.number}`,
      name: c.name || `Cycle ${c.number}`,
      status: c.isActive ? 'active' : 'closed',
      start: localDate(c.startsAt),
      end: addDays(localDate(c.endsAt), -1), // le dernier jour est la veille du cycle suivant
      goal: c.description?.trim() || 'Objectif non renseigné dans Linear (issues « commitment prod »)',
      goalSet: Boolean(c.description?.trim()),
      linearCycleId: c.id,
      features: c.isActive ? featuresOf(raws, c) : [],
      absences: {},
      issues,
      review: null,
      retro: null,
    });
  }

  // Backlog du prochain cycle : candidats pour le Planning
  let backlog = [];
  if (next) {
    onProgress(`Prochain cycle ${next.name || next.number}…`);
    const raws = await fetchCycleIssues(next);
    backlog = dropTrackedParents(raws.map((r) => buildIssue(r, next))).map((i, k) => {
      const waiting = i.labels.find(isWaiting);
      return {
        key: i.key,
        title: i.title,
        epic: i.epic,
        points: i.points,
        priority: k + 1,
        acceptanceCriteria: !i.labels.some(isNotReady) && i._descriptionLength >= 40,
        dependency: waiting || null,
        dependencyConfirmed: waiting ? false : undefined,
        notes: i._descriptionLength < 40 ? 'Description vide ou très courte' : undefined,
      };
    });
  }

  // Équipe du projet : les membres déclarés dans data/private/equipe.json (« equipes » → clé Linear).
  // Toute autre personne assignée à un ticket du projet reste visible :
  //  - « intervention » = développeur d'une autre équipe qui aide ponctuellement (ses tickets sont suivis, il ne
  //    compte pas dans la capacité de ce projet) ;
  //  - « hors équipe » = PM, PO, design… (ni capacité ni charge).
  // Sans composition déclarée pour l'équipe : repli sur la liste « Développeurs » de la Sheet Config.
  const roster = teamConfig.equipes?.[team.key];
  const allMembers = new Set(Object.values(teamConfig.equipes || {}).flatMap((e) => (e.membres || []).map((m) => m.email.toLowerCase())));
  const devEmails = sheets ? new Set(sheets.developers.map((d) => d.email)) : null;
  if (roster) {
    // Les membres déclarés font partie de l'équipe même s'ils n'ont aucun ticket sur la période
    const wanted = roster.membres.map((m) => m.email.toLowerCase()).filter((e) => ![...members.values()].some((u) => u.email?.toLowerCase() === e));
    if (wanted.length) {
      const { users } = await linear('query($emails: [String!]) { users(filter: { email: { in: $emails } }, first: 50) { nodes { id name email } } }', { emails: wanted });
      for (const u of users.nodes) members.set(u.id, u);
    }
  }
  const team_ = [...members.values()].map((m) => {
    const email = m.email?.toLowerCase();
    if (roster) {
      const member = roster.membres.find((x) => x.email.toLowerCase() === email);
      if (member) return { id: m.id, name: m.name, email, role: member.role, kind: 'member', delivery: true };
      const outsideRole = roster.hors_equipe?.[email];
      const isDev = !outsideRole && (allMembers.has(email) || devEmails?.has(email));
      return { id: m.id, name: m.name, email, role: outsideRole || (isDev ? 'Développeur d’une autre équipe' : 'Hors équipe (PM, PO, design…)'), kind: isDev ? 'guest' : 'other', delivery: false };
    }
    const isDev = !devEmails || devEmails.has(email);
    return { id: m.id, name: m.name, email, role: isDev ? 'Développeur' : 'Hors équipe (PM, PO, design…)', kind: isDev ? 'member' : 'other', delivery: isDev };
  });
  // Capacité d'un sprint : les membres de l'équipe (composition déclarée), ou à défaut les développeurs
  // de la Sheet qui ont au moins un ticket dans ce sprint.
  const devIds = new Set(team_.filter((m) => m.delivery).map((m) => m.id));
  for (const s of sprints) {
    s.capacityMembers = roster ? [...devIds] : [...new Set(s.issues.map((i) => i.assignee))].filter((id) => devIds.has(id));
  }
  const holidays = sheets?.holidays || [];
  if (sheets) {
    const byEmail = new Map(team_.map((m) => [m.email, m]));
    for (const s of sprints) {
      for (const [email, dates] of Object.entries(sheets.absences)) {
        const m = byEmail.get(email);
        const inSprint = dates.filter((d) => d >= s.start && d <= s.end);
        if (m && inSprint.length) s.absences[m.id] = inSprint;
      }
      const sheetSprint = sheets.sprints.find((x) => x.start === s.start);
      const meetings = sheetSprint && sheets.meetings[sheetSprint.name];
      if (meetings) s.meetingHours = Object.fromEntries(Object.entries(meetings).map(([e, h]) => [byEmail.get(e)?.id || e, h]).filter(([id]) => !id.includes('@')));
    }
  }

  const nextSprint = next && {
    id: `C${next.number}`,
    name: next.name || `Cycle ${next.number}`,
    start: localDate(next.startsAt),
    end: addDays(localDate(next.endsAt), -1),
    absences: Object.fromEntries(team_.map((m) => [m.id, (sheets?.absences[m.email] || []).filter((d) => d >= localDate(next.startsAt) && d < localDate(next.endsAt))]).filter(([, d]) => d.length)),
    // Hypothèse pour le Planning : les développeurs du sprint en cours (ou du dernier sprint)
    capacityMembers: sprints.at(-1)?.capacityMembers || [],
  };

  onProgress('Projets Linear…');
  // Projets réellement travaillés pendant les 4 derniers sprints : on compte leurs tickets restants
  const worked = new Set(sprints.slice(-4).flatMap((s) => s.issues.map((i) => i.project)).filter(Boolean));
  const projects = await fetchProjects(team.id, worked);

  return {
    meta: {
      product: team.name,
      team: `${team.name} (${team.key})`,
      demo: false,
      source: 'linear',
      syncedAt: new Date().toISOString(),
      teamKey: team.key,
      referenceDate: localDate(new Date().toISOString()),
      holidays,
      labelConventions: LABELS,
    },
    team: team_.map(({ email, ...m }) => m),
    sprints,
    nextSprint,
    backlog,
    projects,
  };
}

/**
 * Projets Linear de l'équipe : en cours, planifiés, en pause, ou terminés depuis moins de 90 jours.
 * Pour les projets travaillés récemment (`worked`), on compte aussi les tickets restants (toutes équipes),
 * ce qui permet de projeter une date de fin au rythme de l'équipe.
 */
async function fetchProjects(teamId, worked = new Set()) {
  const nodes = await paginate(`query($id: String!, $first: Int, $after: String) {
    team(id: $id) { projects(first: $first, after: $after) { nodes {
      id name url health targetDate startDate startedAt completedAt progress
      status { name type }
      lead { name }
      initiatives { nodes { name } }
      projectMilestones { nodes { name targetDate } }
    } pageInfo { hasNextPage endCursor } } }
  }`, { id: teamId }, (d) => d.team.projects, 10);
  const recent = Date.now() - 90 * 24 * HOUR;
  const kept = nodes.filter((p) => ['planned', 'started', 'paused'].includes(p.status?.type) || (p.completedAt && ms(p.completedAt) > recent) || worked.has(p.name));
  const counts = new Map();
  for (const p of kept.filter((x) => worked.has(x.name))) {
    const issues = await paginate(`query($id: String!, $first: Int, $after: String) {
      project(id: $id) { issues(first: $first, after: $after) { nodes { state { type } } pageInfo { hasNextPage endCursor } } }
    }`, { id: p.id }, (d) => d.project.issues, 100);
    const live = issues.filter((i) => !['canceled', 'duplicate'].includes(i.state.type));
    counts.set(p.id, { total: live.length, done: live.filter((i) => i.state.type === 'completed').length });
  }
  return kept
    .map((p) => ({
      id: p.id,
      name: p.name,
      url: p.url,
      status: p.status?.name,
      statusType: p.status?.type,
      health: p.health || null,
      lead: p.lead?.name || null,
      startDate: p.startDate || localDate(p.startedAt),
      targetDate: p.targetDate || null,
      completedAt: localDate(p.completedAt),
      progress: p.progress,
      initiatives: p.initiatives.nodes.map((i) => i.name),
      milestones: p.projectMilestones.nodes.map((m) => ({ name: m.name, targetDate: m.targetDate })),
      worked: worked.has(p.name),
      issues: counts.get(p.id) || null,
    }));
}
