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

export const LABELS = {
  blocking: ['En Standby'],
  waiting: ['Besoin du Backend', 'Besoin du design', 'Besoin d’un meeting', "Besoin d'un meeting", "Besoin d'une réunion de conception", 'besoin du fichier', 'Besoin de reflexion', 'à discuter', 'Testing/Manque de détails'],
  quality: ['regression', 'Testing/Bug', 'Retour code review', 'Bug'],
  goal: ['commitment prod'],
  notReady: ['Besoin du design', 'Testing/Manque de détails', 'Besoin de reflexion', 'à discuter', 'Update the description', "Besoin d'une réunion de conception", "Besoin d'un meeting", 'besoin du fichier', 'Besoin du Backend'],
};
const BLOCK_LABELS = new Set([...LABELS.blocking, ...LABELS.waiting]);
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
  children { nodes { identifier } }
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
    for (const l of presentAtEntry) if (BLOCK_LABELS.has(l)) openBlock(addedDate, `Label « ${l} »`, LABELS.waiting.includes(l) ? l : null);
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
      if (BLOCK_LABELS.has(n) && history.at(-1)?.to !== 'done') openBlock(date, `Label « ${n} »`, LABELS.waiting.includes(n) ? n : null);
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
    isParent: raw.children.nodes.length > 0,
    assignee: raw.assignee?.id || 'non-assigne',
    goal: [...labels, ...parentLabels].some((l) => LABELS.goal.includes(l)),
    labels,
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

/** Retire les parents suivis à travers leurs sous-issues présentes dans le même cycle. */
function dropTrackedParents(issues) {
  const parentsWithChildren = new Set(issues.map((i) => i.parentKey).filter(Boolean));
  return issues.filter((i) => !(i.isParent && parentsWithChildren.has(i.key)));
}

export async function importFromLinear({ teamKey = 'SUPP', closedCycles = 6, sheets = null, onProgress = () => {} } = {}) {
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
      linearCycleId: c.id,
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
      const waiting = i.labels.find((l) => LABELS.waiting.includes(l));
      return {
        key: i.key,
        title: i.title,
        epic: i.epic,
        points: i.points,
        priority: k + 1,
        acceptanceCriteria: !i.labels.some((l) => LABELS.notReady.includes(l)) && i._descriptionLength >= 40,
        dependency: waiting || null,
        dependencyConfirmed: waiting ? false : undefined,
        notes: i._descriptionLength < 40 ? 'Description vide ou très courte' : undefined,
      };
    });
  }

  // Équipe : toutes les personnes assignées sur la période, enrichies par les Sheets
  const team_ = [...members.values()].map((m) => ({ id: m.id, name: m.name, email: m.email?.toLowerCase(), role: 'Équipe' }));
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
  };

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
  };
}
