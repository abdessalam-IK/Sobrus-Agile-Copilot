// Adaptateur Jira Cloud (expérimental) → modèle de données Sobrus AI Copilot.
// Variables d'environnement :
//   JIRA_BASE_URL         ex. https://sobrus.atlassian.net
//   JIRA_EMAIL            compte de service
//   JIRA_API_TOKEN        jeton API Atlassian
//   JIRA_POINTS_FIELD     champ des story points (défaut customfield_10016)
//   JIRA_SPRINT_FIELD     champ sprint (défaut customfield_10020)
//   JIRA_PROJECT_LABEL    nom affiché du produit (optionnel)
// Conventions :
//   - un blocage = le drapeau « Flagged / Impediment » de Jira (début → fin)
//   - une dépendance externe = une étiquette « dependance:<nom> » sur le ticket
//   - les statuts dont le nom contient review / revue / qa / test sont considérés « en revue »

const BASE = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
const POINTS = process.env.JIRA_POINTS_FIELD || 'customfield_10016';
const SPRINT_FIELD = process.env.JIRA_SPRINT_FIELD || 'customfield_10020';
const day = (s) => (s ? s.slice(0, 10) : null);

async function jira(pathname, params = {}) {
  if (!BASE || !process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
    throw new Error('Configurer JIRA_BASE_URL, JIRA_EMAIL et JIRA_API_TOKEN');
  }
  const url = new URL(`${BASE}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Jira ${res.status} sur ${pathname} : ${await res.text()}`);
  return res.json();
}

async function paginate(pathname, key, params = {}) {
  const out = [];
  let startAt = 0;
  for (;;) {
    const page = await jira(pathname, { ...params, startAt, maxResults: 50 });
    out.push(...page[key]);
    startAt += page[key].length;
    if (page.isLast || !page[key].length || (page.total != null && startAt >= page.total)) return out;
  }
}

const adfText = (node) => (typeof node === 'string' ? node : node?.text ?? (node?.content || []).map(adfText).join(' '));

function statusMapper(statuses) {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  return (id, name) => {
    const s = byId.get(id);
    const label = name || s?.name || '';
    if (/review|revue|qa|test|validation/i.test(label)) return 'review';
    const cat = s?.statusCategory?.key;
    return cat === 'done' ? 'done' : cat === 'indeterminate' ? 'in_progress' : 'todo';
  };
}

function mapIssue(raw, sprint, closedBefore, toStatus) {
  const f = raw.fields;
  const start = day(sprint.startDate);
  const end = day(sprint.completeDate || sprint.endDate);
  const histories = [...(raw.changelog?.histories || [])].sort((a, b) => a.created.localeCompare(b.created));

  // Statut au début du sprint puis transitions pendant le sprint
  let initial = 'todo';
  const history = [];
  for (const h of histories) {
    for (const it of h.items.filter((i) => i.field === 'status')) {
      const to = toStatus(it.to, it.toString);
      if (day(h.created) < start) initial = to;
      else if (day(h.created) <= end) history.push({ date: day(h.created), to });
    }
  }
  if (initial !== 'todo') history.unshift({ date: start, to: initial });

  // Blocages (drapeau Impediment)
  const dependency = (f.labels || []).find((l) => l.startsWith('dependance:'))?.slice(11) || null;
  const blocks = [];
  for (const h of histories) {
    for (const it of h.items.filter((i) => i.field === 'Flagged')) {
      const d = day(h.created);
      if (it.toString) blocks.push({ from: d < start ? start : d, to: null, reason: 'Ticket signalé (Impediment)', dependency });
      else if (blocks.length && blocks.at(-1).to == null) blocks.at(-1).to = d;
    }
  }

  const changes = histories
    .filter((h) => day(h.created) > start && day(h.created) <= end)
    .flatMap((h) => h.items.filter((i) => /story point/i.test(i.field)).map((i) => ({ date: day(h.created), field: 'points', from: i.fromString, to: i.toString })));

  const sprintAdd = histories.find((h) => h.items.some((i) => i.field === 'Sprint' && (i.toString || '').includes(sprint.name) && !(i.fromString || '').includes(sprint.name)));
  const addedDate = sprintAdd && day(sprintAdd.created) > start ? day(sprintAdd.created) : start;

  const comments = (f.comment?.comments || [])
    .filter((c) => day(c.created) >= start && day(c.created) <= end)
    .map((c) => ({ date: day(c.created), author: c.author?.accountId, text: adfText(c.body).trim() }));

  return {
    key: raw.key,
    title: f.summary,
    type: /bug/i.test(f.issuetype?.name) ? 'bug' : /t[aâ]che|task|sub/i.test(f.issuetype?.name) ? 'task' : 'story',
    points: f[POINTS] ?? null,
    epic: f.parent?.fields?.summary || f.epic?.name || 'Sans epic',
    assignee: f.assignee?.accountId || 'non-assigne',
    goal: false, // à enrichir : étiquette « objectif » par exemple
    addedDate,
    carriedOver: (f[SPRINT_FIELD] || []).filter((s) => closedBefore.has(s.id)).length,
    history,
    blocks,
    changes,
    comments,
    _assigneeName: f.assignee?.displayName,
  };
}

export async function importFromJira({ boardId, sprints: count = 6 }) {
  const toStatus = statusMapper(await jira('/rest/api/3/status'));
  const allSprints = (await paginate(`/rest/agile/1.0/board/${boardId}/sprint`, 'values', { state: 'closed,active' }))
    .filter((s) => s.startDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(-count);

  const team = new Map();
  const sprints = [];
  const closedBefore = new Set();
  for (const s of allSprints) {
    const raws = await paginate(`/rest/agile/1.0/board/${boardId}/sprint/${s.id}/issue`, 'issues', { expand: 'changelog' });
    const issues = raws.map((r) => mapIssue(r, s, closedBefore, toStatus));
    for (const i of issues) {
      if (i._assigneeName) team.set(i.assignee, { id: i.assignee, name: i._assigneeName, role: 'Équipe' });
      delete i._assigneeName;
      if (/objectif|goal/i.test(s.goal || '') && (s.goal || '').includes(i.key)) i.goal = true;
    }
    sprints.push({
      id: `J${s.id}`,
      name: s.name,
      status: s.state === 'active' ? 'active' : 'closed',
      start: day(s.startDate),
      end: day(s.completeDate || s.endDate),
      goal: s.goal || '',
      absences: {},
      issues,
      review: null,
      retro: null,
    });
    if (s.state === 'closed') closedBefore.add(s.id);
  }

  return {
    meta: { product: process.env.JIRA_PROJECT_LABEL || 'Projet Jira', team: `Board ${boardId}`, demo: false, holidays: [], importedAt: new Date().toISOString() },
    team: [...team.values()],
    sprints,
    backlog: [],
  };
}
