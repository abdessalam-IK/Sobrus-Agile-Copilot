// Interface Sobrus AI Copilot — vanilla JS, aucun build.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
const r1 = (x) => (x == null ? '—' : String(Math.round(x * 10) / 10).replace('.', ','));
const r2 = (x) => (x == null ? '—' : String(Math.round(x * 100) / 100).replace('.', ','));
const dm = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');

const SOBRUS = '__sobrus';
const state = { mode: 'sobrus', sobrus: null, teams: [], team: null, summary: null, config: null, sprintId: null, asOf: null, data: null, tab: 'overview', ai: {} };

// Un seul menu, dans l'ordre où l'on en a besoin au fil du sprint.
// Menu d'un projet : l'essentiel d'abord ; les analyses détaillées sont rangées à part.
const ESSENTIAL = 'L’essentiel';
const DETAILS = 'Analyses détaillées';
const PAGES = [
  { id: 'overview', group: ESSENTIAL, label: 'Résumé', sub: 'Le sprint en 30 secondes', intro: 'Où en est le sprint, les points qui demandent votre attention et les actions proposées.' },
  { id: 'daily', group: ESSENTIAL, label: 'Daily', sub: 'Préparer le point du jour', intro: 'À ouvrir 5 minutes avant le Daily : ce qui a bougé depuis hier, ce qui est bloqué ou immobile, et les questions à poser à l’équipe.' },
  { id: 'review', group: ESSENTIAL, label: 'Sprint Review', sub: 'Livré, non livré, messages', intro: 'L’objectif du sprint, ce qui est livré, ce qui ne l’est pas et pourquoi, et les messages clés à partager.' },
  { id: 'retro', group: ESSENTIAL, label: 'Rétrospective', sub: 'Préparer l’atelier', intro: 'Les données à montrer, la chronologie des événements, les questions à poser et le suivi des actions précédentes.' },
  { id: 'planning', group: ESSENTIAL, label: 'Prochain Planning', sub: 'Capacité et points à challenger', intro: 'La capacité du prochain sprint (congés et jours fériés inclus), une fourchette d’engagement réaliste et les tickets à challenger.' },
  { id: 'sprint', group: DETAILS, label: 'Sprint', intro: 'Les données du sprint telles que le Copilot les lit dans Linear : indicateurs, board, fonctionnalités, burndown et charge par développeur.' },
  { id: 'kpis', group: DETAILS, label: 'Indicateurs', intro: 'Les indicateurs de flux du sprint : d’où vient le travail imprévu, ce que vaut le Planning, où les tickets attendent entre le développement et la PROD, ce qui bloque, et les tickets en cours depuis trop longtemps.' },
  { id: 'objectives', group: DETAILS, label: 'Objectifs', intro: 'Le lien entre le travail de l’équipe et les objectifs de Sobrus : objectif de sprint, part du travail rattachée à un projet, et avancement des projets Linear.' },
  { id: 'signals', group: DETAILS, label: 'Signaux', intro: 'Chaque signal détecté, avec ses preuves (tickets, dates, chiffres) et la question à poser à l’équipe.' },
  { id: 'trends', group: DETAILS, label: 'Tendances', intro: 'La comparaison des sprints : qu’est-ce qui est en train de changer dans votre manière de travailler ?' },
  { id: 'report', group: DETAILS, label: 'Rapport', intro: 'Le rapport complet du sprint, à copier ou à télécharger.' },
];

/** Pages conseillées selon le moment du sprint. */
function recommendedPages(o) {
  if (o.closed) return ['review', 'retro', 'planning'];
  if (o.dayIndex >= o.totalDays - 1) return ['review', 'planning'];
  return ['daily'];
}

const STATUS = { todo: 'À faire', in_progress: 'En cours', review: 'En revue', done: 'Terminé' };
const LEVEL_COLOR = { critical: 'var(--critical)', attention: 'var(--attention)', watch: 'var(--watch)', info: 'var(--info)' };

const name = (id) => state.summary?.team.find((m) => m.id === id)?.name || id;
const role = (id) => state.summary?.team.find((m) => m.id === id)?.role || '';

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || res.statusText);
  return body;
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------
const teamQuery = () => `team=${encodeURIComponent(state.team)}`;
const sprintOptions = (sprints) => sprints.map((s) => `<option value="${s.id}">${esc(s.name)} — ${s.status === 'active' ? 'en cours' : 'terminé'} (${dm(s.start)} → ${dm(s.end)})</option>`).join('');

async function init() {
  [state.config, state.teams] = await Promise.all([api('/api/config'), api('/api/teams')]);
  const badge = $('#ai-badge');
  badge.textContent = state.config.ai.configured ? `IA générative : ${state.config.ai.model}` : 'IA générative : non configurée';
  badge.classList.toggle('on', state.config.ai.configured);
  $('#sync-btn').addEventListener('click', syncNow);

  // Vue Sobrus par défaut ; sinon le dernier projet ouvert dans ce navigateur
  let saved = null;
  try { saved = localStorage.getItem('copilot.team'); } catch { /* stockage indisponible */ }
  const teamSel = $('#team-select');
  teamSel.innerHTML = `<option value="${SOBRUS}">Vue Sobrus — tous les projets</option>` + state.teams.map((t) => `<option value="${t.key}">${esc(t.product)}</option>`).join('');
  teamSel.value = saved && (saved === SOBRUS || state.teams.some((t) => t.key === saved)) ? saved : SOBRUS;
  teamSel.addEventListener('change', () => openView(teamSel.value));
  $('#sprint-select').addEventListener('change', (e) => { state.sprintId = e.target.value; state.asOf = null; load(); });
  await openView(teamSel.value);
}

/** Ouvre la Vue Sobrus ou un projet. */
async function openView(value) {
  $('#team-select').value = value;
  try { localStorage.setItem('copilot.team', value); } catch { /* stockage indisponible */ }
  state.ai = {};
  if (value === SOBRUS) return loadSobrus();
  state.team = value;
  state.tab = 'overview';
  return loadTeam();
}

/** Affiche ou masque ce qui n'a de sens que dans un projet (sprint, bandeau, menu, précisions). */
function setMode(mode) {
  state.mode = mode;
  const project = mode === 'team';
  $('#sprint-select').closest('label').hidden = !project;
  $('#hero').hidden = !project;
  $('#tabs').hidden = !project;
  if (!project) $('#precisions').innerHTML = '';
}

async function loadSobrus() {
  setMode('sobrus');
  $('#brand-sub').textContent = 'Vue Sobrus — tous les projets';
  $('#data-note').textContent = '';
  const oldest = state.teams.map((t) => t.syncedAt).sort()[0];
  renderSync({ source: 'linear', syncedAt: oldest });
  $('#view').innerHTML = '<p class="muted">Chargement de la vue Sobrus…</p>';
  state.sobrus = await api('/api/sobrus');
  $('#view').innerHTML = viewSobrus(state.sobrus);
  $('#view').querySelectorAll('[data-open-team]').forEach((b) => b.addEventListener('click', () => openView(b.dataset.openTeam)));
  window.scrollTo({ top: 0 });
}

/** Charge le résumé du projet choisi et positionne le sprint en cours. */
async function loadTeam(keepSprint = false) {
  setMode('team');
  state.summary = await api(`/api/summary?${teamQuery()}`);
  const { meta, sprints } = state.summary;
  $('#brand-sub').textContent = `Projet : ${meta.product}`;
  $('#data-note').textContent = meta.demo ? ' · Données de démonstration fictives.' : '';
  renderSync(meta);
  const sel = $('#sprint-select');
  sel.innerHTML = sprintOptions(sprints);
  const active = sprints.find((s) => s.status === 'active') || sprints.at(-1);
  if (!keepSprint || !sprints.some((s) => s.id === state.sprintId)) state.sprintId = active.id;
  sel.value = state.sprintId;
  state.asOf = null;
  await load();
}

// ---------------------------------------------------------------------------
// Vue Sobrus : tous les projets sur un seul écran
// ---------------------------------------------------------------------------
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function viewSobrus(v) {
  const pill = (st) => `<span class="status-pill ${st.id}">${esc(st.label)}</span>`;
  const n = v.cards.length;
  const parts = [
    v.counts.ok && `${v.counts.ok} dans les temps`,
    v.counts.tension && `${v.counts.tension} sous tension`,
    v.counts.risk && `${v.counts.risk} en difficulté`,
  ].filter(Boolean).join(', ');
  const first = v.cards[0];

  const cards = v.cards.map((c) => `
    <div class="card project-card ${c.status.id}">
      <div class="pc-head"><h3>${esc(c.product)}</h3>${pill(c.status)}</div>
      <div class="small muted">${esc(c.sprint)} · ${c.closed ? 'sprint terminé' : `jour ${c.day}/${c.totalDays}`}</div>
      <div class="pc-progress">
        <div class="bar big" title="Repère : part du sprint écoulée"><span style="width:${(c.done / Math.max(1, c.scope)) * 100}%"></span><i class="marker" style="left:${c.expected * 100}%"></i></div>
        <div class="small"><b>${c.done}/${c.scope} tickets livrés</b> <span class="muted">· ${pct(c.expected)} du sprint écoulé</span></div>
      </div>
      <p class="pc-main"><b>Point principal :</b> ${esc(c.mainPoint)}</p>
      <div class="pc-facts">
        <span title="Tickets entrés dans le sprint après le Planning">Imprévu <b>${pct(c.unplannedShare)}</b></span>
        <span title="Part des tickets livrés rattachés à un projet Linear">Rattaché à un projet <b>${c.linkedShare == null ? '—' : pct(c.linkedShare)}</b></span>
        <span title="Description du cycle Linear">Objectif de sprint <b>${c.goalSet ? 'écrit' : 'non écrit'}</b></span>
      </div>
      <button class="btn ghost" data-open-team="${esc(c.team)}">Ouvrir le projet →</button>
    </div>`).join('');

  const decisions = v.decisions.map((d) => `<li>
      <div class="d-problem"><b>${esc(d.topic)}</b><ul>${d.projects.map((p) => `<li>${p.team ? `<span class="tag">${esc(p.product)}</span> ` : ''}${esc(p.problem)}</li>`).join('')}</ul></div>
      <div class="d-action">→ ${esc(d.action)} <span class="muted small">— ${esc(d.owner)}</span></div>
    </li>`).join('');

  const changes = v.cards.flatMap((c) => [
    ...c.change.map((x) => `<li><span class="tag">${esc(c.product)}</span> ${esc(x)}</li>`),
    ...c.progress.slice(0, 1).map((x) => `<li><span class="tag green">${esc(c.product)}</span> ${esc(x)}</li>`),
  ]);

  return `
    <div class="sobrus-head">
      <h1>${esc(first?.sprint || 'Sprint en cours')}${first && !first.closed ? ` · jour ${first.day}/${first.totalDays}` : ''}</h1>
      <p class="sobrus-summary">${plural(n, 'projet suivi', 'projets suivis')} : ${parts}. <b>${plural(v.decisions.length, 'décision', 'décisions')} à prendre cette semaine.</b></p>
    </div>

    <div class="grid cols-2">${cards}</div>
    <p class="small muted">Statut = avancement du sprint et gravité des points d’attention. Le repère sur la barre indique où l’équipe devrait en être à ce jour.</p>

    <div class="section-title"><h2>À décider cette semaine</h2><span class="muted small">Les points les plus importants, tous projets confondus</span></div>
    ${decisions ? `<div class="card"><ol class="decisions">${decisions}</ol></div>` : '<div class="card"><p class="muted">Aucune décision urgente.</p></div>'}

    ${changes.length ? `<div class="section-title"><h2>Ce qui change d’un sprint à l’autre</h2></div><div class="card"><ul class="changes">${changes.join('')}</ul></div>` : ''}`;
}

/** Date de la dernière synchronisation Linear, en évidence si elle ne date pas d'aujourd'hui. */
function renderSync(meta) {
  $('#sync').hidden = meta.source !== 'linear';
  if (meta.source !== 'linear') return;
  const at = new Date(meta.syncedAt);
  const today = new Date().toDateString() === at.toDateString();
  const label = $('#sync-label');
  label.textContent = `Données du ${at.toLocaleDateString('fr-FR')} à ${at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  label.classList.toggle('stale', !today);
  label.title = today ? '' : 'Les données ne sont pas à jour : cliquez sur « Synchroniser Linear ».';
}

async function syncNow() {
  const btn = $('#sync-btn');
  btn.disabled = true;
  btn.textContent = `Synchronisation de ${state.teams.length} projet${state.teams.length > 1 ? 's' : ''}… (≈ ${30 * state.teams.length} s)`;
  try {
    await api('/api/sync', { method: 'POST' });
    state.teams = await api('/api/teams');
    state.ai = {};
    if (state.mode === 'sobrus') await loadSobrus();
    else await loadTeam(true);
  } catch (err) {
    alert(`Synchronisation impossible : ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Synchroniser Linear';
  }
}

async function load() {
  const q = state.asOf ? `&asOf=${state.asOf}` : '';
  state.data = await api(`/api/analysis/${state.sprintId}?${teamQuery()}${q}`);
  render();
}

// ---------------------------------------------------------------------------
// Rendu global
// ---------------------------------------------------------------------------
function render() {
  renderHero();
  renderTabs();
  const p = state.data.prepare;
  const views = {
    overview: viewOverview,
    daily: () => prepDaily(p.daily) + aiBox('daily', 'Rédiger la note du Daily avec Claude'),
    sprint: viewObserve,
    kpis: viewKpis,
    signals: viewSignals,
    review: () => prepReview(p.review) + aiBox('bilan', 'Rédiger le bilan de fin de sprint avec Claude (Review, Rétro, Planning)'),
    retro: () => prepRetro(p.retro) + aiBox('bilan', 'Rédiger le bilan de fin de sprint avec Claude (Review, Rétro, Planning)'),
    planning: () => prepPlanning(p.planning) + aiBox('bilan', 'Rédiger le bilan de fin de sprint avec Claude (Review, Rétro, Planning)'),
    objectives: viewObjectives,
    trends: viewLearn,
    report: viewReport,
  };
  const page = PAGES.find((x) => x.id === state.tab);
  $('#view').innerHTML = `<p class="page-intro">${esc(page.intro)}</p>${views[state.tab]()}`;
  bindView();
}

function renderTabs() {
  const rec = recommendedPages(state.data.observe);
  const groups = [...new Set(PAGES.map((p) => p.group))];
  $('#tabs').innerHTML = groups.map((g) => `<div class="tab-group${g === DETAILS ? ' secondary' : ''}"><div class="tab-group-label">${g}</div><div class="tab-group-items">${PAGES.filter((p) => p.group === g).map((p) => `<button role="tab" aria-selected="${p.id === state.tab}" class="${p.id === state.tab ? 'active' : ''}" data-tab="${p.id}">${p.label}${rec.includes(p.id) ? '<span class="rec" title="Conseillé à ce moment du sprint">conseillé</span>' : ''}${p.sub ? `<span class="sub">${p.sub}</span>` : ''}</button>`).join('')}</div></div>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    render();
    $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function gauge(value, label) {
  const color = value >= 75 ? 'var(--ok)' : value >= 50 ? 'var(--attention)' : 'var(--critical)';
  const R = 52;
  const C = Math.PI * R;
  return `<svg viewBox="0 0 130 78" width="140" role="img" aria-label="Santé ${value}/100">
    <path d="M13 70 A52 52 0 0 1 117 70" fill="none" stroke="var(--surface-2)" stroke-width="12" stroke-linecap="round"/>
    <path d="M13 70 A52 52 0 0 1 117 70" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(C * value) / 100} ${C}"/>
    <text x="65" y="62" text-anchor="middle" style="font-size:26px;font-weight:700;fill:var(--text)">${value}</text>
  </svg><div class="gauge-label">Santé · ${esc(label)}</div>`;
}

function renderHero() {
  const { observe: o, think: t } = state.data;
  $('#hero').innerHTML = `
    <div class="gauge">${gauge(t.health, t.healthLabel)}${t.healthBreakdown ? `<div class="gauge-parts"><span title="Travail terminé par rapport à l’attendu à ce jour du sprint">Avancement ${t.healthBreakdown.progress.score}</span> · <span title="Points d’attention, un par thème">Signaux ${t.healthBreakdown.signals.score}</span></div><a class="small" href="#precision-sante">Comment est-elle calculée ?</a>` : ''}</div>
    <div>
      <div class="goal-line">🎯 ${esc(o.sprint.goal)} · ${o.closed ? 'Sprint terminé' : `Jour ${o.dayIndex}/${o.totalDays} (au ${dm(o.asOf)})`}</div>
      <div class="headline">${state.tab === 'overview' ? esc(verdict(t)) : headlineHtml(t)}</div>
      <div class="facts">${t.facts.slice(0, 3).map((f) => `<span class="fact">${esc(f)}</span>`).join('')}</div>
    </div>`;
  renderPrecisions(t);
}

/** Verdict d'une ligne pour le Résumé (les points eux-mêmes sont détaillés juste en dessous). */
function verdict(t) {
  const n = t.headlineParts?.items.length || 0;
  const state_ = t.health >= 75 ? 'Sprint dans les temps' : t.health >= 50 ? 'Sprint sous tension' : 'Sprint en difficulté';
  return n ? `${state_} : ${n} point${n > 1 ? 's demandent' : ' demande'} votre attention.` : `${state_} : rien de particulier à signaler.`;
}

const star = (k) => `<a class="star" href="#precision-${k}" title="Voir le détail en bas de page">★${k}</a>`;

/** Titre du bandeau : chaque point porte une étoile qui renvoie à ses précisions en bas de page. */
function headlineHtml(t) {
  const h = t.headlineParts;
  if (!h) return esc(t.headline);
  const items = h.items.map((x, i) => `${esc(x.text)} ${star(i + 1)}`).join(' ; ');
  const watch = h.watch.length ? ` À surveiller : ${h.watch.map((x) => esc(x.label.toLowerCase())).join(', ')} ${star(h.items.length + 1)}` : '';
  return `${esc(h.intro)}${items ? ` : ${items}` : ''}.${watch}${watch ? '.' : ''}`;
}

/** Détail du score de santé : 60 % avancement + 40 % signaux (un retrait par thème). */
function healthPrecision(t) {
  const b = t.healthBreakdown;
  const p = b.progress;
  const themes = b.signals.themes.map((x) => `<tr><td>${esc(x.label)}</td><td class="small muted">${esc(x.signal)}</td><td class="num">−${r1(x.cost)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Aucun signal.</td></tr>';
  return `<div class="card precision" id="precision-sante"><h3>Comment est calculée la santé (${t.health}/100)</h3>
    <p><b>Santé = ${Math.round(b.weights.progress * 100)} % avancement + ${Math.round(b.weights.signals * 100)} % signaux</b> = ${Math.round(b.weights.progress * 100)} % × ${p.score} + ${Math.round(b.weights.signals * 100)} % × ${b.signals.score} ≈ ${t.health}</p>
    <h4>Avancement : ${p.score}/100</h4>
    <p class="muted">${pct(p.completion)} du travail terminé (en ${esc(p.unit)}) pour ${pct(p.expected)} attendu à ce jour du sprint. Chaque point de retard sur l’attendu retire 2 points ; être en avance donne 100.</p>
    <h4>Signaux : ${b.signals.score}/100</h4>
    <p class="muted">On part de 100 ; chaque thème en alerte retire une part selon son signal le plus grave. Un seul retrait par thème, pour ne pas compter deux fois le même problème.</p>
    <table><thead><tr><th>Thème</th><th>Signal le plus grave</th><th class="num">Retrait</th></tr></thead><tbody>${themes}</tbody></table>
    ${b.signals.excluded.length ? `<p class="small muted">Non comptés dans les signaux car déjà reflétés par l’avancement : ${b.signals.excluded.map(esc).join(' ; ')}.</p>` : ''}
  </div>`;
}

/** Précisions en bas de page : pour chaque point du bandeau, les signaux, les tickets et la question à poser. */
function renderPrecisions(t) {
  const h = t.headlineParts;
  const el = $('#precisions');
  if (!h) { el.innerHTML = ''; return; }
  const evidence = (s) => {
    if (!s.evidence.length) return '';
    const li = s.evidence.map((e) => `<li>${esc(e)}</li>`).join('');
    return s.evidence.length > 8 ? `<details><summary>Voir les ${s.evidence.length} éléments</summary><ul>${li}</ul></details>` : `<ul>${li}</ul>`;
  };
  const signals = (theme) => t.signals.filter((s) => s.theme === theme).map((s) => `
    <div class="precision-signal"><b>${esc(s.title)}</b><p class="muted">${esc(s.narrative)}</p>${evidence(s)}<div class="question">${esc(s.question)}</div></div>`).join('');
  const blocks = h.items.map((x, i) => `
    <div class="card precision" id="precision-${i + 1}"><h3>★${i + 1} — ${esc(t.insights.find((n) => n.theme === x.theme)?.label || '')}</h3>${signals(x.theme)}</div>`);
  if (h.watch.length) {
    blocks.push(`<div class="card precision" id="precision-${h.items.length + 1}"><h3>★${h.items.length + 1} — À surveiller</h3>${h.watch.map((x) => `<h4>${esc(x.label)}</h4>${signals(x.theme)}`).join('')}</div>`);
  }
  if (t.healthBreakdown) blocks.push(healthPrecision(t));
  el.innerHTML = `<div class="section-title"><h2>Précisions</h2><span class="muted small">Le détail des points marqués d’une étoile dans le bandeau</span></div><div class="grid">${blocks.join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Graphiques SVG
// ---------------------------------------------------------------------------
function burndownChart(o) {
  const W = 620, H = 230, P = { l: 34, r: 12, t: 12, b: 28 };
  const pts = o.burndown;
  const max = Math.max(1, ...pts.map((p) => Math.max(p.ideal, p.scope ?? 0)));
  const x = (i) => P.l + (i * (W - P.l - P.r)) / Math.max(1, pts.length - 1);
  const y = (v) => H - P.b - (v * (H - P.t - P.b)) / max;
  const line = (key) => pts.map((p, i) => (p[key] == null ? null : `${x(i)},${y(p[key])}`)).filter(Boolean).join(' ');
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(max * g)}" y2="${y(max * g)}" stroke="var(--border)"/><text x="${P.l - 6}" y="${y(max * g) + 4}" text-anchor="end">${Math.round(max * g)}</text>`).join('');
  const labels = pts.map((p, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${dm(p.date)}</text>`).join('');
  const today = pts.findIndex((p) => p.date >= o.asOf);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Burndown">
    ${grid}${labels}
    ${!o.closed && today >= 0 ? `<line x1="${x(today)}" x2="${x(today)}" y1="${P.t}" y2="${H - P.b}" stroke="var(--brand)" stroke-dasharray="3 3"/>` : ''}
    <polyline points="${line('ideal')}" fill="none" stroke="var(--muted)" stroke-dasharray="5 4" stroke-width="1.5"/>
    <polyline points="${line('scope')}" fill="none" stroke="var(--attention)" stroke-width="1.5"/>
    <polyline points="${line('remaining')}" fill="none" stroke="var(--brand)" stroke-width="2.5"/>
    ${pts.map((p, i) => (p.remaining == null ? '' : `<circle cx="${x(i)}" cy="${y(p.remaining)}" r="3" fill="var(--brand)"><title>${dm(p.date)} : reste ${p.remaining} pts (idéal ${p.ideal})</title></circle>`)).join('')}
  </svg>
  <div class="chips small"><span class="tag brand">— Reste à faire</span><span class="tag">- - Trajectoire idéale</span><span class="tag orange">— Périmètre</span></div>`;
}

function spark(values, better) {
  const vals = values.map((v) => (v == null ? null : Number(v)));
  const real = vals.filter((v) => v != null);
  if (real.length < 2) return '<span class="muted small">—</span>';
  const W = 120, H = 28;
  const min = Math.min(...real), max = Math.max(...real);
  const x = (i) => 3 + (i * (W - 6)) / (vals.length - 1);
  const y = (v) => H - 4 - ((v - min) * (H - 8)) / (max - min || 1);
  const pts = vals.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
  const last = real.at(-1), first = real[0];
  const good = better === 'up' ? last >= first : last <= first;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><polyline points="${pts.join(' ')}" fill="none" stroke="${good ? 'var(--ok)' : 'var(--critical)'}" stroke-width="2"/></svg>`;
}

function velocityChart(series) {
  const W = 620, H = 220, P = { l: 34, r: 10, t: 12, b: 30 };
  const max = Math.max(1, ...series.map((s) => Math.max(s.committedPoints, s.metrics.donePoints)));
  const bw = (W - P.l - P.r) / series.length;
  const y = (v) => H - P.b - (v * (H - P.t - P.b)) / max;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Engagement et livraison par sprint">
    ${[0, 0.5, 1].map((g) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(max * g)}" y2="${y(max * g)}" stroke="var(--border)"/><text x="${P.l - 6}" y="${y(max * g) + 4}" text-anchor="end">${Math.round(max * g)}</text>`).join('')}
    ${series.map((s, i) => {
      const x0 = P.l + i * bw + bw * 0.18;
      const w = bw * 0.3;
      return `<rect x="${x0}" y="${y(s.committedPoints)}" width="${w}" height="${H - P.b - y(s.committedPoints)}" fill="var(--border)" rx="3"><title>Engagé : ${s.committedPoints}</title></rect>
        <rect x="${x0 + w + 3}" y="${y(s.metrics.donePoints)}" width="${w}" height="${H - P.b - y(s.metrics.donePoints)}" fill="${s.closed ? 'var(--brand)' : 'var(--brand-2)'}" opacity="${s.closed ? 1 : 0.55}" rx="3"><title>Livré : ${s.metrics.donePoints}</title></rect>
        <text x="${x0 + w}" y="${H - 10}" text-anchor="middle">${esc(s.name.replace('Sprint ', 'S'))}${s.closed ? '' : '*'}</text>`;
    }).join('')}
  </svg><div class="chips small"><span class="tag">■ Engagé au Planning</span><span class="tag brand">■ Livré</span><span class="muted">* sprint en cours</span></div>`;
}

// ---------------------------------------------------------------------------
// Page « Sprint »
// ---------------------------------------------------------------------------
function kpi(label, value, hint = '') {
  return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${value}</div><div class="hint">${esc(hint)}</div></div>`;
}

function ticket(i) {
  const tags = [
    `<span class="tag">${i.points ?? '?'} pts</span>`,
    `<span class="tag">${esc(name(i.assignee))}</span>`,
    i.goal ? '<span class="tag brand">objectif</span>' : '',
    i.blockedNow ? `<span class="tag red">bloqué ${i.blockedDays} j</span>` : '',
    !i.done && !i.blockedNow && i.status !== 'todo' && i.ageInStatus >= 3 ? `<span class="tag orange">immobile ${i.ageInStatus} j</span>` : '',
    i.carriedOver ? `<span class="tag orange">reporté ×${i.carriedOver}</span>` : '',
    i.addedMidSprint ? '<span class="tag orange">ajouté</span>' : '',
    i.reopenCount ? '<span class="tag red">rouvert</span>' : '',
    i.churn >= 2 ? '<span class="tag orange">besoin modifié</span>' : '',
    i.type === 'bug' ? '<span class="tag">bug</span>' : '',
  ].join('');
  const cls = i.blockedNow ? 'blocked' : !i.done && i.status !== 'todo' && i.ageInStatus >= 3 ? 'aging' : '';
  return `<div class="ticket ${cls}"><span class="key">${esc(i.key)}</span> ${esc(i.title)}<div class="meta">${tags}</div></div>`;
}

// ---------------------------------------------------------------------------
// Page « Indicateurs » (flux)
// ---------------------------------------------------------------------------
function hbar(value, max, color = 'var(--brand)') {
  return `<div class="bar"><span style="width:${max ? Math.min(100, (value / max) * 100) : 0}%;background:${color}"></span></div>`;
}

function viewKpis() {
  const f = state.data.flow;
  const o = state.data.observe;
  if (!f) return '<p class="empty">Indicateurs indisponibles.</p>';
  const u = f.unplanned;
  const p = f.planning;
  const c = f.cycle;
  const b = f.blockages;
  const unknown = u.byOrigin.filter((x) => /non précisée/.test(x.origin)).reduce((a, x) => a + x.count, 0);
  const maxOrigin = Math.max(1, ...u.byOrigin.map((x) => x.count));
  const maxStage = Math.max(1, ...c.stages.map((x) => x.median || 0));
  const maxCause = Math.max(1, ...b.byCause.map((x) => x.ticketDays));
  const ageColor = { risk: 'var(--critical)', watch: 'var(--attention)', ok: 'var(--ok)' };
  const ageLabel = { risk: 'à risque', watch: 'à surveiller', ok: 'normal' };

  return `
    <div class="section-title"><h2>En un coup d’œil</h2><span class="muted small">${o.closed ? 'Sprint terminé' : `Au jour ${o.dayIndex}/${o.totalDays}`}</span></div>
    <div class="kpis">
      ${kpi('Tickets imprévus', `${u.count}<span class="muted small"> / ${o.metrics.scopeCount}</span>`, `${pct(u.ratio)} du sprint, entrés après le Planning`)}
      ${kpi(o.closed ? 'Tickets planifiés livrés' : 'Planifiés déjà livrés', p.accuracy == null ? '—' : pct(p.accuracy), `${p.plannedDone}/${p.planned} tickets du Planning`)}
      ${kpi('Part du livré qui était planifiée', p.shareOfDone == null ? '—' : pct(p.shareOfDone), `sur ${p.done} tickets livrés`)}
      ${kpi('Délai jusqu’en PROD', c.leadToProd ? `${r1(c.leadToProd.median)} j` : '—', c.leadToProd ? `médiane · ${pct(c.leadToProd.share)} des tickets finis sont en PROD` : 'pas assez de tickets passés en PROD')}
      ${kpi('Jours-ticket bloqués', b.ticketDays, `${b.blockedNow.length} bloqué${b.blockedNow.length > 1 ? 's' : ''} maintenant`)}
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>D’où vient le travail imprévu ?</h3>
        ${u.count ? u.byOrigin.map((x) => `<div class="bar-row"><span>${esc(x.origin)}</span>${hbar(x.count, maxOrigin, /non précisée/.test(x.origin) ? 'var(--muted)' : 'var(--attention)')}<span class="small muted">${x.count} ticket${x.count > 1 ? 's' : ''}${x.points ? ` · ${x.points} pts` : ''}</span></div>`).join('') : '<p class="empty">Aucun ticket ajouté après le Planning.</p>'}
        ${unknown && unknown >= u.count / 2 ? `<p class="small muted" style="margin-top:8px">${unknown} des ${u.count} tickets imprévus n’ont pas de label <code>Source/…</code> : ajouter ce label à l’entrée d’un ticket en cours de sprint (Customer care, Business developer…) rendra cet indicateur exploitable.</p>` : ''}
        ${u.count ? `<details><summary>Voir les ${u.count} tickets</summary><ul>${u.byOrigin.flatMap((x) => x.issues.map((i) => `<li><b>${esc(i.key)}</b> ${esc(i.title)} <span class="muted small">— ${esc(x.origin.toLowerCase())}, ajouté le ${dm(i.addedDate)}${i.done ? ', terminé' : ''}</span></li>`)).join('')}</ul></details>` : ''}
      </div>
      <div class="card"><h3>Où les tickets attendent-ils ?</h3>
        <p class="small muted">Durée médiane de chaque étape, en jours ouvrés, sur ${c.tickets} tickets terminés (3 derniers sprints et sprint affiché).</p>
        ${c.stages.map((x) => `<div class="bar-row"><span>${esc(x.label)}</span>${x.median != null ? hbar(x.median, maxStage, c.bottleneck?.key === x.key ? 'var(--critical)' : 'var(--brand)') : '<div class="bar"></div>'}<span class="small muted">${x.median != null ? `${r1(x.median)} j` : 'données insuffisantes'} · n=${x.tickets}</span></div>`).join('')}
        ${c.bottleneck ? `<p style="margin-top:8px"><b>Étape la plus longue : ${esc(c.bottleneck.label.toLowerCase())}</b> (${r1(c.bottleneck.median)} j en médiane, 85 % des tickets en moins de ${r1(c.bottleneck.p85)} j).</p>` : ''}
        ${c.stages.some((x) => !x.reliable) ? `<p class="small muted">« Données insuffisantes » = moins de ${c.minSample} tickets sont passés par ce statut : l’équipe l’utilise peu ou le saute.</p>` : ''}
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Âge du travail en cours</h3>
        ${f.aging ? `<p class="small muted">D’habitude, la moitié des tickets se terminent en ${f.aging.thresholds.p50} j ouvrés et 85 % en ${f.aging.thresholds.p85} j${f.aging.thresholds.fallback ? ' (seuils par défaut : historique insuffisant)' : ` (sur ${f.aging.thresholds.basedOn} tickets terminés)`}.</p>
          ${f.aging.items.length ? `<table><thead><tr><th>Ticket</th><th class="num">En cours depuis</th><th>État</th></tr></thead><tbody>${f.aging.items.map((i) => `<tr><td><b>${esc(i.key)}</b> ${esc(i.title)} <span class="muted small">(${esc(name(i.assignee))})</span></td><td class="num">${i.age} j</td><td><span class="tag" style="color:${ageColor[i.level]}">${ageLabel[i.level]}</span>${i.blocked ? ' <span class="tag red">bloqué</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Aucun ticket en cours (statut « In Progress »).</p>'}` : '<p class="empty">Sprint terminé.</p>'}
      </div>
      <div class="card"><h3>Blocages : durée et causes</h3>
        ${b.byCause.length ? b.byCause.map((x) => `<div class="bar-row"><span>${esc(x.cause)}</span>${hbar(x.ticketDays, maxCause, 'var(--critical)')}<span class="small muted">${x.ticketDays} j · ${x.tickets.length} ticket${x.tickets.length > 1 ? 's' : ''}${x.open ? ` · ${x.open} en cours` : ''}</span></div>`).join('') : '<p class="empty">Aucun blocage déclaré pendant ce sprint (statut « Stuck » ou labels « Besoin … », « En Standby »).</p>'}
      </div>
    </div>
    <p class="small muted" style="margin-top:12px">L’évolution de la précision du Planning et de l’imprévu d’un sprint à l’autre se trouve dans <b>Tendances</b>.</p>`;
}

// ---------------------------------------------------------------------------
// Page « Objectifs »
// ---------------------------------------------------------------------------

function viewObjectives() {
  const o = state.data.objectives;
  if (!o) return '<p class="empty">Indicateurs indisponibles.</p>';
  const goals = o.goals;
  const current = goals.at(-1);
  const alloc = o.allocation;
  const last = alloc.at(-1);
  const proj = o.projects;
  const etaText = (p) => p.eta?.done ? '<span class="tag green">terminé</span>'
    : p.eta?.slow ? '<span class="tag orange">rythme trop faible</span>'
    : p.eta?.date ? `vers le ${dm(p.eta.date)}/${p.eta.date.slice(2, 4)} <span class="small muted">(${p.eta.sprints} sprint${p.eta.sprints > 1 ? 's' : ''})</span>`
    : '<span class="muted">—</span>';

  return `
    <div class="grid cols-2">
      <div class="card"><h3>Objectif du sprint</h3>
        ${current?.goalSet ? `<p><b>« ${esc(current.goal)} »</b></p>` : '<p><span class="tag red">non renseigné</span> La description du cycle est vide dans Linear. Une phrase suffit : elle apparaîtra ici à la prochaine synchronisation.</p>'}
        <table><thead><tr><th>Sprint</th><th>Objectif écrit</th><th class="num">Éléments clés livrés</th></tr></thead><tbody>
          ${[...goals].reverse().map((g) => `<tr><td>${esc(g.sprint)}${g.closed ? '' : ' <span class="small muted">(en cours)</span>'}</td><td>${g.goalSet ? '<span class="tag green">oui</span>' : '<span class="tag">non</span>'}</td><td class="num">${g.keyItems ? `${g.keyDone}/${g.keyItems} <span class="small muted">(${pct(g.achievement)})</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
        </tbody></table>
        <p class="small muted" style="margin-top:8px">Éléments clés = tickets portant le label « commitment prod ».</p>
      </div>
      <div class="card"><h3>Le travail livré sert-il un projet ?</h3>
        ${last?.done ? `<p class="big-number">${pct(last.linkedShare)}</p><p>des tickets livrés ce sprint sont rattachés à un projet Linear${last.linkedShare < 1 ? ` ; les ${last.done - Math.round(last.linkedShare * last.done)} autres ne le sont pas, on ne peut donc pas dire à quel objectif ils servent` : ''}.</p>` : '<p class="muted">Aucun ticket livré pour l’instant.</p>'}
        ${last?.byProject.length ? `<h4>Projets servis ce sprint</h4>${list(last.byProject.map((p) => `${esc(p.project)} <span class="muted small">— ${p.count} ticket${p.count > 1 ? 's' : ''} livré${p.count > 1 ? 's' : ''}</span>`))}` : ''}
        <table style="margin-top:8px"><thead><tr><th>Sprint</th><th class="num">Tickets livrés</th><th class="num">Rattachés à un projet</th></tr></thead><tbody>
          ${[...alloc].reverse().map((a) => `<tr><td>${esc(a.sprint)}</td><td class="num">${a.done}</td><td class="num">${pct(a.linkedShare)}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>

    <div class="section-title"><h2>Projets Linear travaillés</h2><span class="muted small">Projets ayant reçu des tickets de l’équipe pendant les 4 derniers sprints · ${proj.total} projets ouverts ou récents au total</span></div>
    ${proj.worked.length ? `<div class="card"><table><thead><tr><th>Projet</th><th>Statut Linear</th><th>Date cible</th><th>Avancement</th><th class="num">Rythme</th><th>Fin prévisible</th><th>Alertes</th></tr></thead><tbody>
      ${proj.worked.map((p) => `<tr>
        <td><a href="${esc(p.url)}" target="_blank" rel="noopener"><b>${esc(p.name)}</b></a>${p.lead ? `<div class="small muted">${esc(p.lead)}</div>` : ''}</td>
        <td>${esc(p.status || '—')}</td>
        <td>${p.targetDate ? dm(p.targetDate) + '/' + p.targetDate.slice(2, 4) : '<span class="muted">—</span>'}</td>
        <td style="min-width:150px">${p.issues ? `${hbar(p.issues.done, p.issues.total)}<span class="small muted">${p.issues.done}/${p.issues.total} tickets</span>` : '—'}</td>
        <td class="num">${p.rate != null ? r1(p.rate) : '—'} <span class="small muted">/sprint</span></td>
        <td>${etaText(p)}</td>
        <td>${p.alerts.map((a) => `<div class="tag orange" style="margin:2px 0;white-space:normal">${esc(a)}</div>`).join('') || '<span class="tag green">RAS</span>'}</td>
      </tr>`).join('')}
    </tbody></table>
    <p class="small muted" style="margin-top:8px">Rythme = tickets du projet terminés par cette équipe par sprint (3 derniers sprints). Fin prévisible = tickets restants (toutes équipes) ÷ ce rythme : si d’autres équipes contribuent, la fin peut arriver plus tôt.</p></div>`
    : '<div class="card"><p><span class="tag red">aucun</span> Aucun ticket de l’équipe n’a été rattaché à un projet Linear pendant les 4 derniers sprints : le Copilot ne peut pas relier le travail livré aux objectifs. Rattacher les tickets à leur projet dès leur création rend ce suivi automatique.</p></div>'}

    ${proj.stale.length ? `<div class="card" style="margin-top:16px"><h3>Projets ouverts dont la date cible est dépassée</h3><p class="small muted">${proj.stale.length} projet${proj.stale.length > 1 ? 's' : ''} encore ouvert${proj.stale.length > 1 ? 's' : ''} dans Linear, sans ticket travaillé récemment par l’équipe : à clore, replanifier ou abandonner.</p>
      <details><summary>Voir la liste</summary><ul>${proj.stale.map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a> <span class="muted small">— ${esc(p.status || '')}, cible ${dm(p.targetDate)}/${p.targetDate.slice(2, 4)}, ${pct(p.progress)} d’avancement</span></li>`).join('')}</ul></details></div>` : ''}`;
}

/** Charge de chaque développeur, en additionnant ses estimations sur tous les projets suivis. */
function portfolioCard(p) {
  if (!p?.devs?.length) return '';
  const projects = p.projects.map((x) => x.product);
  const rows = p.devs.map((d) => `<tr${d.overloaded ? ' class="overloaded"' : ''}>
    <td><b>${esc(d.name)}</b>${d.multiProject ? ' <span class="tag brand">multi-projets</span>' : ''}</td>
    ${projects.map((name) => { const x = d.projects.find((y) => y.product === name); return `<td class="num">${x ? `${x.points}${x.unestimated ? ` <span class="small muted">+${x.unestimated} n.e.</span>` : ''}${x.intervention ? ' <span class="tag">intervention</span>' : ''}` : '<span class="muted">—</span>'}</td>`; }).join('')}
    <td class="num"><b>${d.total}</b></td>
    <td class="num">${d.capacityPoints != null ? `~${Math.round(d.capacityPoints)}` : '—'}</td>
    <td>${d.overloaded ? `<span class="tag red">surcharge ×${r2(d.ratio)}</span>` : d.ratio != null ? `<span class="tag ${d.ratio > 1 ? 'orange' : 'green'}">×${r2(d.ratio)}</span>` : ''}</td>
  </tr>`).join('');
  return `<div class="section-title"><h2>Charge des développeurs, tous projets</h2><span class="muted small">Estimations de chaque développeur sur tous les projets du sprint · surcharge au-delà de ×${r2(p.overloadRatio)}</span></div>
    <div class="card"><table><thead><tr><th>Développeur</th>${projects.map((n) => `<th class="num">${esc(n)}</th>`).join('')}<th class="num">Total (pts)</th><th class="num">Absorbable</th><th>Charge</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small muted" style="margin-top:8px">Absorbable = jours disponibles (congés et fériés déduits) × rythme de référence de ${r2(p.rate)} point/jour, mesuré sur les 3 derniers sprints de tous les projets. « n.e. » = tickets non estimés, non comptés dans le total.</p></div>`;
}

/** Personnes hors équipe qui ont des tickets dans le sprint : leur intervention, sans compter dans la capacité. */
function outsideList(load, kind, title) {
  const rows = load.filter((l) => l.outside && l.kind === kind && l.tickets);
  if (!rows.length) return '';
  return `<h4 style="margin-top:14px">${title}</h4>${list(rows.map((l) => `<b>${esc(name(l.member))}</b> <span class="muted small">— ${l.tickets} ticket${l.tickets > 1 ? 's' : ''} (${l.doneTickets} terminé${l.doneTickets > 1 ? 's' : ''})${l.donePoints + l.remainingPoints ? `, ${l.donePoints + l.remainingPoints} pts` : ''}</span>`))}`;
}

/** Fonctionnalités = tickets parents, terminés seulement quand tous leurs sous-tickets le sont. */
function featuresCard(o) {
  if (!o.features?.length) return '';
  const rows = o.features.map((f) => `<tr>
    <td><b>${esc(f.key)}</b> ${esc(f.title)}${f.goal ? ' <span class="tag brand">objectif</span>' : ''}</td>
    <td style="min-width:160px"><div class="bar"><span style="width:${(f.done / Math.max(1, f.total)) * 100}%;background:var(--brand)"></span></div><span class="small muted">${f.done}/${f.total} sous-tickets · ${f.pointsDone}/${f.points} pts</span></td>
    <td>${f.complete ? '<span class="tag green">terminée</span>' : f.outside.length ? `<span class="tag red" title="${esc(f.outside.map((x) => `${x.key} (${x.state})`).join(', '))}">${f.outside.length} sous-ticket(s) hors du cycle</span>` : '<span class="tag">en cours</span>'}${f.unestimated ? ` <span class="tag orange">${f.unestimated} non estimé(s)</span>` : ''}</td>
  </tr>`).join('');
  return `<div class="section-title"><h2>Fonctionnalités</h2><span class="muted small">Tickets parents : terminés quand tous leurs sous-tickets le sont · état actuel de Linear</span></div>
    <div class="card"><table><thead><tr><th>Fonctionnalité</th><th>Avancement</th><th>État</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function viewObserve() {
  const o = state.data.observe;
  const m = o.metrics;
  const cols = ['todo', 'in_progress', 'review', 'done'];
  const maxLoad = Math.max(1, ...o.load.map((l) => l.remainingPoints + l.donePoints));
  const committed = o.issues.filter((i) => i.committed);
  return `
    <div class="section-title" id="kpis"><h2>Indicateurs du sprint</h2><span class="muted small">Données au ${dm(o.asOf)} · ${o.issues.length} tickets</span></div>
    <div class="kpis">
      ${kpi('Tickets terminés', `${m.doneCount}<span class="muted small"> / ${m.scopeCount}</span>`, m.openUnestimated ? `dont ${m.openUnestimated} restant${m.openUnestimated > 1 ? 's' : ''} non estimé${m.openUnestimated > 1 ? 's' : ''}` : 'tous estimés')}
      ${kpi('Points estimés terminés', `${m.donePoints}<span class="muted small"> / ${m.scopePoints}</span>`, 'un ticket non estimé compte 0')}
      ${kpi('Engagement initial', m.committedPoints, `${committed.length} tickets au Planning`)}
      ${kpi('Ajouts en cours', `+${m.addedPoints}`, `${pct(m.scopeChangeRatio)} de l’engagement`)}
      ${o.closed ? kpi('Tickets planifiés livrés', pct(m.planningAccuracy), `${m.plannedDoneCount}/${m.plannedCount} du Planning`) : kpi('Probabilité de finir', o.forecast ? pct(o.forecast.probability) : '—', 'simulation Monte Carlo')}
      ${kpi('Cycle time moyen', m.avgCycleTime ? `${r1(m.avgCycleTime)} j` : '—', 'début → terminé')}
      ${kpi('WIP moyen', r1(m.avgWip), `${o.load.length} personnes`)}
      ${kpi('Jours-ticket bloqués', m.blockedIssueDays, `${m.blockedNowCount} bloqué${m.blockedNowCount > 1 ? 's' : ''} maintenant`)}
      ${kpi('Tickets rouverts', m.reopenCount, `bugs : ${pct(m.bugRatio)} des tickets`)}
      ${kpi('Objectif', `${m.goalDone}/${m.goalTotal}`, 'éléments clés terminés')}
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Burndown</h3>${burndownChart(o)}</div>
      <div class="card"><h3>Charge de l’équipe</h3>
        ${o.load.filter((l) => !l.outside).map((l) => `<div class="bar-row"><span>${esc(name(l.member))} <span class="small muted">${esc(role(l.member))}</span></span><div class="bar"><span style="width:${(l.donePoints / maxLoad) * 100}%;background:var(--brand)"></span><span style="width:${(l.remainingPoints / maxLoad) * 100}%;background:var(--attention)"></span></div><span class="small muted">${l.donePoints}/${l.donePoints + l.remainingPoints} pts${l.upcomingAbsences.length ? ` · ✈ ${l.upcomingAbsences.length} j` : ''}</span></div>`).join('')}
        <div class="chips small" style="margin-top:8px"><span class="tag brand">■ terminé</span><span class="tag orange">■ restant</span><span class="muted">✈ absences à venir</span></div>
        ${outsideList(o.load, 'guest', 'Interventions d’autres équipes')}
        ${outsideList(o.load, 'other', 'Autres personnes assignées (PM, PO, design…)')}
      </div>
    </div>
    <div class="section-title" id="board"><h2>Board du sprint</h2><span class="muted small">Bordure rouge : bloqué · orange : immobile ≥ 3 jours</span></div>
    <div class="board">${cols.map((c) => {
      const items = o.issues.filter((i) => i.status === c);
      return `<div class="column"><h4>${STATUS[c]}<span>${items.length} · ${items.reduce((a, i) => a + (i.points || 0), 0)} pts</span></h4>${items.map(ticket).join('') || '<div class="empty small">—</div>'}</div>`;
    }).join('')}</div>
    ${featuresCard(o)}
    ${portfolioCard(state.data.portfolio)}
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card" id="commit"><h3>Engagement au Sprint Planning</h3>
        <table><thead><tr><th>Ticket</th><th>Epic</th><th class="num">Pts</th><th>Statut</th></tr></thead><tbody>
        ${committed.map((i) => `<tr><td><b>${esc(i.key)}</b> ${esc(i.title)}</td><td class="small muted">${esc(i.epic)}</td><td class="num">${i.points ?? '?'}</td><td>${STATUS[i.status]}</td></tr>`).join('')}
        </tbody></table></div>
      <div class="card"><h3>Ce que disent les commentaires</h3>
        ${o.comments.length ? `<ul class="timeline">${[...o.comments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map((c) => `<li><b>${esc(c.key)}</b> · ${dm(c.date)} · ${esc(name(c.author))}<br>« ${esc(c.text)} »</li>`).join('')}</ul>` : '<p class="empty">Aucun commentaire.</p>'}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Page « Signaux »
// ---------------------------------------------------------------------------
function signalCard(s) {
  return `<div class="signal">
    <div class="signal-head">
      <div>
        <span class="level ${s.level.id}">${s.level.label}</span>
        <span class="signal-title">${esc(s.title)}</span>
      </div>
    </div>
    <div class="sev"><span style="width:${s.severity * 100}%;background:${LEVEL_COLOR[s.level.id]}"></span></div>
    <p>${esc(s.narrative)}</p>
    ${s.evidence.length ? `<details><summary>Preuves (${s.evidence.length})</summary><ul>${s.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}
    ${s.hypotheses?.length ? `<details><summary>Hypothèses à vérifier</summary><ul>${s.hypotheses.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></details>` : ''}
    <div class="question">${esc(s.question)}</div>
    <div class="small muted" style="margin-top:6px">Détecteur : <code>${s.type}</code> · sévérité ${r2(s.severity)}</div>
  </div>`;
}

function viewSignals() {
  const { think: t, observe: o } = state.data;
  const forecast = o.forecast ? `<span class="muted small">Prévision : ~${Math.round(o.forecast.expected)} ${o.forecast.unit} terminables (fourchette ${Math.round(o.forecast.p15)}–${Math.round(o.forecast.p85)}) pour ${o.forecast.remaining} restants</span>` : '';
  if (!t.signals.length) return '<div class="card"><h2>Aucun signal détecté</h2><p class="muted">Le flux est régulier, sans blocage ni dérive notable.</p></div>';
  return `
    <div class="section-title"><h2>Signaux détectés</h2>${forecast || `<span class="muted small">${t.signals.length} signaux · triés par importance</span>`}</div>
    <div class="grid cols-2">${[0, 1].map((col) => `<div>${t.signals.filter((_, i) => i % 2 === col).map(signalCard).join('')}</div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Page « Vue d’ensemble »
// ---------------------------------------------------------------------------
function viewOverview() {
  const { think: t } = state.data;
  const items = t.headlineParts?.items || [];
  const points = items.map((x, i) => {
    const insight = t.insights.find((n) => n.theme === x.theme);
    const sig = insight?.signals[0];
    return `<div class="card point"><div class="point-num">${i + 1}</div><div>
      <h3>${esc(insight?.headline || x.text)}</h3>
      <p class="muted">${esc(sig?.narrative || '')}</p>
      <div class="question">${esc(sig?.question || '')}</div>
      <a class="small" href="#precision-${i + 1}">Voir les tickets concernés</a></div></div>`;
  }).join('');
  const actions = t.recommendations.slice(0, 3);
  return `
    ${points ? `<div class="section-title"><h2>Ce qui demande votre attention</h2></div><div class="grid">${points}</div>` : '<div class="card"><h2>Rien de particulier à signaler</h2><p class="muted">Le sprint se déroule sans signal notable.</p></div>'}
    ${actions.length ? `<div class="section-title"><h2>Actions proposées</h2><span class="muted small">À discuter avec l’équipe, qui décide</span></div>
      <div class="card"><ol class="actions">${actions.map((r) => `<li><b>${esc(r.text)}</b> <span class="muted small">— ${esc(r.owner)}</span></li>`).join('')}</ol></div>` : ''}
    ${t.crossReadings.length ? `<p class="muted small" style="margin-top:12px"><b>Lecture d’ensemble :</b> ${esc(t.crossReadings[0])}</p>` : ''}`;
}

// ---------------------------------------------------------------------------
// Pages de préparation (Daily, Review, Rétro, Planning, Rapport)
// ---------------------------------------------------------------------------
function list(items, empty = '—') {
  return items.length ? `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="empty">${empty}</p>`;
}

function prepDaily(d) {
  return `<div class="grid cols-2">
    <div class="card"><h3>Avant le Daily — ${dm(d.date)} (jour ${d.day})</h3>
      <p class="muted">🎯 ${esc(d.sprintGoal)} — ${d.goalProgress.done}/${d.goalProgress.total} éléments clés terminés</p>
      <h4>Questions à poser</h4>${d.questions.map((q) => `<div class="question">${esc(q)}</div>`).join('') || '<p class="empty">—</p>'}
      <p class="small muted" style="margin-top:10px">💡 ${esc(d.tip)}</p>
    </div>
    <div class="card"><h3>Ce qui a bougé depuis hier</h3>${list(d.moved.map((m) => `<b>${esc(m.key)}</b> → ${STATUS[m.to]} (${esc(name(m.assignee))}, ${dm(m.date)})`), 'Aucun mouvement : à questionner en Daily.')}
      <h3>Bloqués</h3>${list(d.blocked.map((b) => `<b>${esc(b.key)}</b> — ${b.days} j — ${esc(b.reason)}${b.dependency ? ` <span class="tag red">${esc(b.dependency)}</span>` : ''}`), 'Aucun blocage déclaré.')}
      <h3>Immobiles</h3>${list(d.stuck.map((s) => `<b>${esc(s.key)}</b> — ${esc(s.status)} depuis ${s.days} j (${esc(s.assignee)})`), 'Aucun ticket immobile.')}
      ${d.forecast ? `<p class="small muted">Probabilité de terminer le périmètre : <b>${pct(d.forecast.probability)}</b></p>` : ''}
    </div></div>`;
}

function prepReview(r) {
  return `${r.anticipated ? '<p class="tag orange" style="display:inline-block;margin-bottom:10px">Préparation anticipée : le sprint est encore en cours</p>' : ''}
  <div class="grid cols-2">
    <div class="card"><h3>Objectif : ${esc(r.goalStatus)}</h3><p class="muted">${esc(r.goal)} — ${esc(r.goalDetail)}</p>
      <h4>Messages clés</h4>${list(r.keyMessages.map(esc))}
    </div>
    <div class="card"><h3>Livré</h3>${r.delivered.map((e) => `<p><b>${esc(e.epic)}</b> · ${e.points} pts</p>${list(e.items.map((i) => `${esc(i.key)} ${esc(i.title)}${i.goal ? ' <span class="tag brand">objectif</span>' : ''}`))}`).join('') || '<p class="empty">Rien de terminé.</p>'}
      <h3>Non livré — et pourquoi</h3>${list(r.notDelivered.map((i) => `<b>${esc(i.key)}</b> ${esc(i.title)} <span class="muted">— ${esc(i.reason)}</span>`), 'Tout est livré.')}
      ${r.feedback.length ? `<h3>Feedback reçu</h3>${list(r.feedback.map((f) => `<b>${esc(f.from)}</b> <span class="tag ${f.sentiment === 'negative' ? 'red' : f.sentiment === 'positive' ? 'green' : ''}">${f.sentiment}</span> « ${esc(f.text)} »`))}` : ''}
    </div></div>`;
}

function prepRetro(r) {
  return `${r.anticipated ? '<p class="tag orange" style="display:inline-block;margin-bottom:10px">Préparation anticipée : le sprint est encore en cours</p>' : ''}
  <div class="grid cols-2">
    <div class="card"><h3>Données à montrer</h3><div class="kpis">${r.dataCards.map((c) => kpi(c.label, esc(c.value))).join('')}</div>
      <h4 style="margin-top:12px">Questions pour l’équipe</h4>${r.questions.map((q) => `<div class="question">${esc(q)}</div>`).join('')}
      <h4 style="margin-top:12px">Expériences possibles</h4>${list(r.experiments.map((e) => `${esc(e.hypothesis)} <span class="muted">(${esc(e.owner)})</span>`))}
    </div>
    <div class="card"><h3>Suivi des actions de la rétro précédente</h3>
      ${list(r.previousActions.map((a) => `${esc(a.text)} — ${esc(a.owner)} <span class="tag ${a.status === 'done' ? 'green' : a.status === 'in_progress' ? 'orange' : 'red'}">${a.status === 'done' ? 'réalisée' : a.status === 'in_progress' ? 'en cours' : 'non démarrée'}</span>`), 'Aucune action précédente.')}
      <h3>Chronologie du sprint</h3>
      ${r.timeline.length ? `<ul class="timeline">${r.timeline.map((e) => `<li class="${e.kind}">${dm(e.date)} · ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="empty">Sprint sans événement notable.</p>'}
    </div></div>`;
}

function prepPlanning(p) {
  return `<div class="grid cols-2">
    <div class="card"><h3>Équipe ${p.capacity ? `— ${esc(p.capacity.sprint)}` : ''}</h3>
      ${p.capacity ? list(p.capacity.members.map((m) => `<b>${esc(m.member)}</b> <span class="muted small">${esc(m.role || '')}</span>${m.absences ? ` <span class="tag orange">absent${m.absences > 1 ? ` ${m.absences} jours` : ' 1 jour'}</span>` : ''}`)) : '<p class="empty">Sprint suivant non renseigné.</p>'}
      ${p.range ? `<div class="kpis">${kpi('Fourchette réaliste', `${p.range.low}–${p.range.high} pts`, 'au rythme des 3 derniers sprints')}${kpi('Ajouts habituels', `${p.range.buffer} pts`, 'ajoutés en moyenne en cours de sprint')}${kpi('Engagement suggéré', `≈ ${p.range.recommended} pts`, 'fourchette moins les ajouts habituels')}</div>` : ''}
      <h4 style="margin-top:12px">Historique</h4>
      <table><thead><tr><th>Sprint</th><th class="num">Engagé au Planning</th><th class="num">Livré</th></tr></thead><tbody>${p.velocityHistory.map((v) => `<tr><td>${esc(v.sprint)}</td><td class="num">${v.committed} pts</td><td class="num">${v.done} pts</td></tr>`).join('')}</tbody></table>
      <h4 style="margin-top:12px">Préconditions</h4>${list(p.preconditions.map(esc))}
      <h4>Questions pour le Planning</h4>${p.questions.map((q) => `<div class="question">${esc(q)}</div>`).join('')}
    </div>
    <div class="card" id="candidates"><h3>Candidats et éléments à challenger</h3>
      <p class="muted small">${p.candidates.filter((c) => c.ready).length} prêts (${p.readyPoints} pts) · ${p.toChallenge.length} à challenger</p>
      <table><thead><tr><th>Élément</th><th class="num">Pts</th><th>Points d’attention</th></tr></thead><tbody>
      ${p.candidates.map((c) => `<tr><td><b>${esc(c.key)}</b> ${esc(c.title)}<div class="small muted">${esc(c.origin)}</div></td><td class="num">${c.points ?? '?'}</td><td>${c.flags.length ? c.flags.map((f) => `<div class="tag ${f.level === 'high' ? 'red' : 'orange'}" style="margin:2px 0;white-space:normal">${esc(f.text)}</div>`).join('') : '<span class="tag green">Prêt</span>'}</td></tr>`).join('')}
      </tbody></table>
    </div></div>`;
}

function viewReport() {
  return `<div class="card"><div class="signal-head"><h3>Rapport de sprint (Markdown)</h3><div class="chips"><button class="btn ghost" id="copy-report">Copier</button><a class="btn" href="/api/report/${state.sprintId}.md?${teamQuery()}${state.asOf ? `&asOf=${state.asOf}` : ''}" download="sobrus-copilot-${state.team.toLowerCase()}-${state.sprintId}.md">Télécharger .md</a></div></div><pre class="report">${esc(state.data.report)}</pre></div>`;
}

// ---------------------------------------------------------------------------
// Page « Tendances »
// ---------------------------------------------------------------------------
function heat(sev) {
  if (!sev) return '<span class="heat muted">·</span>';
  const a = 0.15 + sev * 0.85;
  return `<span class="heat" style="background:rgba(192,57,43,${a.toFixed(2)});color:${sev > 0.5 ? '#fff' : 'inherit'}">${Math.round(sev * 100)}</span>`;
}

function fmtMetric(v, f) {
  if (v == null) return '—';
  return f === 'pct' ? pct(v) : f === 'dec' ? r2(v) : Math.round(v);
}

function viewLearn() {
  const l = state.data.learn;
  const themes = { flow: 'Flux', dependencies: 'Dépendances', scope: 'Périmètre', predictability: 'Prévisibilité', quality: 'Qualité', team: 'Équipe', improvement: 'Amélioration', stakeholders: 'Parties prenantes', objectives: 'Objectifs' };
  const closedSeries = l.series.filter((s) => s.closed && !s.atypical);
  return `
    <div class="card cross"><h2>Qu’est-ce qui est en train de changer dans notre manière de travailler ?</h2><p>${esc(l.headline)}</p>
      <div class="chips">${l.dominant.map((d, i) => `<span class="tag ${d.theme ? 'orange' : 'green'}">${esc(d.sprint)} : ${esc(d.label)}</span>${i < l.dominant.length - 1 ? '<span class="muted">→</span>' : ''}`).join('')}</div>
    </div>
    ${l.shifts.length ? `<div class="grid cols-3" style="margin-top:16px">${l.shifts.map((s) => `<div class="card shift ${s.positive ? 'positive' : ''}"><h3>${esc(s.title)}</h3><p class="muted">${esc(s.text)}</p></div>`).join('')}</div>` : ''}
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Engagement vs livraison</h3>${velocityChart(l.series)}</div>
      <div class="card"><h3>Carte de chaleur des thèmes</h3><p class="small muted">Sévérité (0–100) de chaque thème, sprint par sprint : où se déplace le centre de gravité des difficultés.</p>
        <table class="heatmap"><thead><tr><th></th>${l.series.map((s) => `<th>${esc(s.name.replace('Sprint ', 'S'))}</th>`).join('')}</tr></thead><tbody>
        ${Object.entries(themes).map(([k, label]) => `<tr><th>${label}</th>${l.series.map((s) => `<td>${heat(s.themes[k])}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>
    </div>
    <div class="section-title"><h2>Tendances</h2><span class="muted small">${l.sprintsAnalysed} sprints terminés analysés (fenêtre glissante de 4)${l.excluded.length ? ` · exclu(s) car atypique(s) : ${l.excluded.map((e) => `${esc(e.name)} (${esc(e.reason)})`).join(', ')}` : ''}</span></div>
    <div class="card"><table><thead><tr><th>Indicateur</th>${closedSeries.map((s) => `<th class="num">${esc(s.name.replace('Sprint ', 'S'))}</th>`).join('')}<th>Évolution</th><th>Tendance</th></tr></thead><tbody>
      ${l.metrics.map((m) => {
        const t = l.trend[m.key];
        const label = !t ? '<span class="muted">—</span>' : t.direction === 'stable' ? '<span class="muted">stable</span>' : `<span class="trend-${t.direction}-${t.quality}">${t.direction === 'up' ? '↗ hausse' : '↘ baisse'} ${t.quality === 'worse' ? '(dégradation)' : '(amélioration)'}</span>`;
        return `<tr><td>${esc(m.label)}</td>${closedSeries.map((s) => `<td class="num">${fmtMetric(s.metrics[m.key], m.format)}</td>`).join('')}<td>${spark(closedSeries.map((s) => s.metrics[m.key]), m.better)}</td><td>${label}</td></tr>`;
      }).join('')}
    </tbody></table></div>
    <div style="margin-top:16px">
      <div class="card"><h3>Patterns persistants</h3>${list(l.patterns.map((p) => `<b>${esc(p.title)}</b><br><span class="muted">${esc(p.detail)}</span>`), 'Aucun pattern récurrent pour l’instant.')}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Couche IA générative
// ---------------------------------------------------------------------------
const aiKey = (kind) => `${state.team}|${state.sprintId}|${state.data.observe.asOf}|${kind}`;

function aiBox(kind, label) {
  const entry = state.ai[aiKey(kind)];
  const configured = state.config.ai.configured;
  let body = '';
  if (entry?.loading) body = '<p class="muted">Claude rédige… (cela peut prendre une minute)</p>';
  else if (entry?.error) body = `<p class="error">${esc(entry.error)}</p>`;
  else if (entry?.markdown) body = `<div class="md">${md(entry.markdown)}</div><p class="small muted">Généré par ${esc(entry.model)}${entry.pseudonymized ? ' · noms pseudonymisés avant envoi' : ''} · à relire et adapter.</p>`;
  return `<div class="ai-box"><div class="ai-head"><div><b>✦ Couche IA générative</b><div class="small muted">${configured ? 'Claude reçoit uniquement l’analyse agrégée (pas les données brutes).' : 'Installez Claude Code (npm install -g @anthropic-ai/claude-code), connectez-vous avec « claude », puis relancez le serveur.'}</div></div>
    <button class="btn" data-ai="${kind}" ${entry?.loading ? 'disabled' : ''}>${entry?.markdown ? 'Régénérer' : esc(label)}</button></div>${body}</div>`;
}

async function runAi(kind) {
  const key = aiKey(kind);
  state.ai[key] = { loading: true };
  render();
  try {
    state.ai[key] = await api(`/api/ai/${state.sprintId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, asOf: state.asOf, team: state.team }) });
  } catch (err) {
    state.ai[key] = { error: err.message };
  }
  render();
}

function md(src) {
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = esc(src).split(/\r?\n/);
  let html = '';
  let open = null;
  const close = () => { if (open) { html += `</${open}>`; open = null; } };
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k].trimEnd();
    let m;
    if (/^\|.*\|$/.test(l.trim())) {
      close();
      const rows = [];
      while (k < lines.length && /^\|.*\|$/.test(lines[k].trim())) rows.push(lines[k++].trim());
      k--;
      const cells = (r) => r.slice(1, -1).split('|').map((c) => inline(c.trim()));
      const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      html += `<table><thead><tr>${cells(body[0]).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else if ((m = l.match(/^(#{1,4})\s+(.*)/))) { close(); const n = Math.min(4, m[1].length + 1); html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (open !== 'ul') { close(); html += '<ul>'; open = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (open !== 'ol') { close(); html += '<ol>'; open = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^&gt;\s?(.*)/))) { close(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if (/^-{3,}$/.test(l.trim())) { close(); html += '<hr>'; }
    else if (!l.trim()) close();
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  close();
  return html;
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------
function bindView() {
  const view = $('#view');
  view.querySelectorAll('[data-ai]').forEach((b) => b.addEventListener('click', () => runAi(b.dataset.ai)));
  $('#copy-report')?.addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(state.data.report);
    e.target.textContent = 'Copié ✓';
  });
}

init().catch((err) => {
  $('#view').innerHTML = `<div class="card"><h2 class="error">Impossible de charger le Copilot</h2><p>${esc(err.message)}</p></div>`;
});
