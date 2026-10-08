// Interface Sobrus AI Copilot — vanilla JS, aucun build.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
const r1 = (x) => (x == null ? '—' : String(Math.round(x * 10) / 10).replace('.', ','));
const r2 = (x) => (x == null ? '—' : String(Math.round(x * 100) / 100).replace('.', ','));
const dm = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');

const state = { summary: null, config: null, sprintId: null, asOf: null, maxDay: {}, data: null, tab: 'think', prep: 'daily', ai: {}, voted: new Set() };

const TABS = [
  { id: 'observe', num: '01', label: 'Observer', sub: 'Données du sprint' },
  { id: 'understand', num: '02', label: 'Comprendre', sub: 'Patterns & signaux faibles' },
  { id: 'think', num: '03', label: 'Penser', sub: 'Insights & risques' },
  { id: 'prepare', num: '04', label: 'Préparer', sub: 'Cérémonies & reporting' },
  { id: 'learn', num: '05', label: 'Apprendre', sub: 'Sprint après sprint' },
];
const PREP = [
  { id: 'daily', label: 'Daily' },
  { id: 'review', label: 'Sprint Review' },
  { id: 'retro', label: 'Rétrospective' },
  { id: 'planning', label: 'Prochain Planning' },
  { id: 'report', label: 'Rapport' },
];
const FLOW = [
  { id: 'backlog', label: 'Backlog', go: ['prepare', 'planning', 'candidates'] },
  { id: 'planning', label: 'Sprint Planning', go: ['observe', null, 'commit'] },
  { id: 'sprint', label: 'Sprint', go: ['observe', null, 'board'] },
  { id: 'daily', label: 'Daily', go: ['prepare', 'daily'] },
  { id: 'metrics', label: 'Metrics', go: ['observe', null, 'kpis'] },
  { id: 'risks', label: 'Risks', go: ['think', null, 'risks'] },
  { id: 'review', label: 'Sprint Review', go: ['prepare', 'review'] },
  { id: 'retro', label: 'Rétrospective', go: ['prepare', 'retro'] },
  { id: 'next', label: 'Next Sprint', go: ['prepare', 'planning'] },
];
const STATUS = { todo: 'À faire', in_progress: 'En cours', review: 'En revue', done: 'Terminé' };
const LEVEL_COLOR = { critical: 'var(--critical)', attention: 'var(--attention)', watch: 'var(--watch)', info: 'var(--info)' };

const name = (id) => state.summary?.team.find((m) => m.id === id)?.name || id;

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(body?.error || res.statusText);
  return body;
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------
async function init() {
  [state.config, state.summary] = await Promise.all([api('/api/config'), api('/api/summary')]);
  const { meta, sprints } = state.summary;
  $('#brand-sub').textContent = `${meta.product} · ${meta.team}`;
  $('#data-note').textContent = meta.demo ? ' · Données de démonstration fictives.' : '';
  const badge = $('#ai-badge');
  badge.textContent = state.config.ai.configured ? `IA générative : ${state.config.ai.model}` : 'IA générative : non configurée';
  badge.classList.toggle('on', state.config.ai.configured);

  const sel = $('#sprint-select');
  sel.innerHTML = sprints.map((s) => `<option value="${s.id}">${esc(s.name)} — ${s.status === 'active' ? 'en cours' : 'terminé'} (${dm(s.start)} → ${dm(s.end)})</option>`).join('');
  state.sprintId = (sprints.find((s) => s.status === 'active') || sprints.at(-1)).id;
  sel.value = state.sprintId;
  sel.addEventListener('change', () => { state.sprintId = sel.value; state.asOf = null; load(); });
  $('#day-slider').addEventListener('input', (e) => { $('#day-label').textContent = `${e.target.value}/${state.data.observe.totalDays}`; });
  $('#day-slider').addEventListener('change', (e) => { state.asOf = state.data.observe.days[Number(e.target.value) - 1]; load(); });
  await load();
}

async function load() {
  const q = state.asOf ? `?asOf=${state.asOf}` : '';
  state.data = await api(`/api/analysis/${state.sprintId}${q}`);
  const o = state.data.observe;
  if (!state.asOf) state.maxDay[state.sprintId] = o.dayIndex;
  const slider = $('#day-slider');
  slider.max = state.maxDay[state.sprintId] || o.totalDays;
  slider.value = o.dayIndex;
  $('#day-label').textContent = `${o.dayIndex}/${o.totalDays}`;
  render();
}

function navigate(tab, prep, anchor) {
  state.tab = tab;
  if (prep) state.prep = prep;
  render();
  if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Rendu global
// ---------------------------------------------------------------------------
function render() {
  renderFlow();
  renderHero();
  $('#tabs').innerHTML = TABS.map((t) => `<button role="tab" class="${t.id === state.tab ? 'active' : ''}" data-tab="${t.id}"><span class="num">${t.num}</span>${t.label}<span class="sub">${t.sub}</span></button>`).join('');
  $('#tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.tab)));
  const views = { observe: viewObserve, understand: viewUnderstand, think: viewThink, prepare: viewPrepare, learn: viewLearn };
  $('#view').innerHTML = views[state.tab]();
  bindView();
}

function renderFlow() {
  const o = state.data.observe;
  const current = o.closed ? 'retro' : o.dayIndex <= 1 ? 'planning' : 'daily';
  const ci = FLOW.findIndex((f) => f.id === current);
  $('#flow').innerHTML = FLOW.map((f, i) => `<button class="${i < ci ? 'past' : ''} ${i === ci ? 'current' : ''}" data-i="${i}">${f.label}</button>`).join('<span class="muted" aria-hidden="true">›</span>');
  $('#flow').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => navigate(...FLOW[b.dataset.i].go)));
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
    <div class="gauge">${gauge(t.health, t.healthLabel)}</div>
    <div>
      <div class="goal-line">🎯 ${esc(o.sprint.goal)} · ${o.closed ? 'Sprint terminé' : `Jour ${o.dayIndex}/${o.totalDays} (au ${dm(o.asOf)})`}</div>
      <div class="headline">${esc(t.headline)}</div>
      <div class="facts">${t.facts.map((f) => `<span class="fact">${esc(f)}</span>`).join('')}</div>
    </div>`;
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
// 01 — Observer
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

function viewObserve() {
  const o = state.data.observe;
  const m = o.metrics;
  const cols = ['todo', 'in_progress', 'review', 'done'];
  const maxLoad = Math.max(1, ...o.load.map((l) => l.remainingPoints + l.donePoints));
  const committed = o.issues.filter((i) => i.committed);
  return `
    <div class="section-title" id="kpis"><h2>Ce que le Copilot observe</h2><span class="muted small">Données au ${dm(o.asOf)} · ${o.issues.length} tickets · ${m.personDays} jours-personne</span></div>
    <div class="kpis">
      ${kpi('Points terminés', `${m.donePoints}<span class="muted small"> / ${m.scopePoints}</span>`, pct(m.completionRatio))}
      ${kpi('Engagement initial', m.committedPoints, `${committed.length} tickets au Planning`)}
      ${kpi('Ajouts en cours', `+${m.addedPoints}`, `${pct(m.scopeChangeRatio)} de l’engagement`)}
      ${o.closed ? kpi('Fiabilité (say/do)', pct(m.sayDo), 'engagé et livré') : kpi('Probabilité de finir', o.forecast ? pct(o.forecast.probability) : '—', 'simulation Monte Carlo')}
      ${kpi('Cycle time moyen', m.avgCycleTime ? `${r1(m.avgCycleTime)} j` : '—', 'début → terminé')}
      ${kpi('WIP moyen', r1(m.avgWip), `${o.load.length} personnes`)}
      ${kpi('Jours-ticket bloqués', m.blockedIssueDays, `${m.blockedNowCount} bloqué(s) maintenant`)}
      ${kpi('Tickets rouverts', m.reopenCount, `bugs : ${pct(m.bugRatio)} des tickets`)}
      ${kpi('Objectif', `${m.goalDone}/${m.goalTotal}`, 'éléments clés terminés')}
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Burndown</h3>${burndownChart(o)}</div>
      <div class="card"><h3>Charge par personne</h3>
        ${o.load.map((l) => `<div class="bar-row"><span>${esc(name(l.member))}</span><div class="bar"><span style="width:${(l.donePoints / maxLoad) * 100}%;background:var(--brand)"></span><span style="width:${(l.remainingPoints / maxLoad) * 100}%;background:var(--attention)"></span></div><span class="small muted">${l.donePoints}/${l.donePoints + l.remainingPoints} pts${l.upcomingAbsences.length ? ` · ✈ ${l.upcomingAbsences.length} j` : ''}</span></div>`).join('')}
        <div class="chips small" style="margin-top:8px"><span class="tag brand">■ terminé</span><span class="tag orange">■ restant</span><span class="muted">✈ absences à venir</span></div>
      </div>
    </div>
    <div class="section-title" id="board"><h2>Board du sprint</h2><span class="muted small">Bordure rouge : bloqué · orange : immobile ≥ 3 jours</span></div>
    <div class="board">${cols.map((c) => {
      const items = o.issues.filter((i) => i.status === c);
      return `<div class="column"><h4>${STATUS[c]}<span>${items.length} · ${items.reduce((a, i) => a + (i.points || 0), 0)} pts</span></h4>${items.map(ticket).join('') || '<div class="empty small">—</div>'}</div>`;
    }).join('')}</div>
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
// 02 — Comprendre
// ---------------------------------------------------------------------------
function signalCard(s) {
  const voted = state.voted.has(s.type);
  return `<div class="signal">
    <div class="signal-head">
      <div>
        <span class="level ${s.level.id}">${s.level.label}</span>
        <span class="signal-title">${esc(s.title)}</span>
      </div>
      <div class="feedback" title="Ce signal vous est-il utile ? Le Copilot apprend de vos retours.">
        <button data-vote="1" data-type="${s.type}" class="${voted ? 'done' : ''}" aria-label="Utile">👍</button>
        <button data-vote="0" data-type="${s.type}" aria-label="Pas utile">👎</button>
      </div>
    </div>
    <div class="sev"><span style="width:${s.severity * 100}%;background:${LEVEL_COLOR[s.level.id]}"></span></div>
    <p>${esc(s.narrative)}</p>
    ${s.evidence.length ? `<details><summary>Preuves (${s.evidence.length})</summary><ul>${s.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}
    ${s.hypotheses?.length ? `<details><summary>Hypothèses à vérifier</summary><ul>${s.hypotheses.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></details>` : ''}
    <div class="question">${esc(s.question)}</div>
    <div class="small muted" style="margin-top:6px">Détecteur : <code>${s.type}</code> · sévérité ${r2(s.severity)}${s.weight !== 1 ? ` · pondération apprise ×${r2(s.weight)}` : ''}</div>
  </div>`;
}

function viewUnderstand() {
  const t = state.data.think;
  if (!t.signals.length) return '<div class="card"><h2>Aucun pattern détecté</h2><p class="muted">Le flux est régulier, sans blocage ni dérive notable.</p></div>';
  return `
    <div class="section-title"><h2>Patterns détectés</h2><span class="muted small">${t.signals.length} signaux · 17 détecteurs · triés par sévérité</span></div>
    <p class="muted">Chaque signal est un fait observé avec ses preuves — pas un verdict. Votre retour 👍/👎 ajuste le poids de chaque type de signal pour les prochaines analyses.</p>
    <div class="grid cols-2">${[0, 1].map((col) => `<div>${t.signals.filter((_, i) => i % 2 === col).map(signalCard).join('')}</div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// 03 — Penser
// ---------------------------------------------------------------------------
function viewThink() {
  const { think: t, prepare: p, observe: o } = state.data;
  return `
    ${t.crossReadings.length ? `<div class="card cross"><h2>Ce que les signaux racontent ensemble</h2><ul>${t.crossReadings.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
    <div class="section-title"><h2>Insights par thème</h2><span class="muted small">${t.insights.length} thème(s)</span></div>
    ${t.insights.length ? `<div class="grid cols-2">${t.insights.map((i) => `
      <div class="card insight ${i.level.id}">
        <div class="signal-head"><h3>${i.icon} ${esc(i.label)}</h3><span class="level ${i.level.id}">${i.level.label}</span></div>
        <p><b>${esc(i.headline)}.</b> ${esc(i.narrative)}</p>
        ${i.questions.slice(0, 2).map((q) => `<div class="question">${esc(q)}</div>`).join('')}
      </div>`).join('')}</div>` : '<p class="empty">Aucun insight : rien ne nécessite d’attention particulière.</p>'}
    <div class="section-title"><h2>Recommandations</h2><span class="muted small">Propositions à discuter — l’équipe décide</span></div>
    <div class="card"><table><thead><tr><th>Proposition</th><th>Pour qui</th><th>Parce que</th></tr></thead><tbody>
      ${t.recommendations.map((r) => `<tr><td>${esc(r.text)}</td><td class="small">${esc(r.owner)}</td><td class="small muted">${esc(r.because)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">—</td></tr>'}
    </tbody></table></div>
    <div class="section-title" id="risks"><h2>Registre des risques</h2>${o.forecast ? `<span class="muted small">Prévision : ~${Math.round(o.forecast.expectedPoints)} pts livrables (fourchette ${Math.round(o.forecast.p15)}–${Math.round(o.forecast.p85)}) pour ${o.forecast.remainingPoints} restants</span>` : ''}</div>
    <div class="card"><table><thead><tr><th>Risque</th><th>Probabilité</th><th>Impact</th><th>Mitigation proposée</th><th>Porteur</th></tr></thead><tbody>
      ${p.risks.map((r) => `<tr><td>${esc(r.title)}</td><td><span class="level ${r.probability === 'Élevée' ? 'critical' : r.probability === 'Moyenne' ? 'attention' : 'watch'}">${r.probability}</span></td><td>${r.impact}</td><td class="small">${esc(r.mitigation)}</td><td class="small">${esc(r.owner)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Aucun risque significatif.</td></tr>'}
    </tbody></table></div>
    ${aiBox('insights', 'Approfondir les insights avec Claude')}`;
}

// ---------------------------------------------------------------------------
// 04 — Préparer
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
      <h4>Ordre de démo suggéré</h4>${list(r.demo.map((d, i) => `${i + 1}. <b>${esc(d.key)}</b> ${esc(d.title)} — ${esc(d.presenter)}`))}
      <h4>Questions pour les parties prenantes</h4>${r.questionsForStakeholders.map((q) => `<div class="question">${esc(q)}</div>`).join('')}
    </div>
    <div class="card"><h3>Livré</h3>${r.delivered.map((e) => `<p><b>${esc(e.epic)}</b> · ${e.points} pts</p>${list(e.items.map((i) => `${esc(i.key)} ${esc(i.title)}${i.goal ? ' <span class="tag brand">objectif</span>' : ''}`))}`).join('') || '<p class="empty">Rien de terminé.</p>'}
      <h3>Non livré — et pourquoi</h3>${list(r.notDelivered.map((i) => `<b>${esc(i.key)}</b> ${esc(i.title)} <span class="muted">— ${esc(i.reason)}</span>`), 'Tout est livré.')}
      ${r.feedback.length ? `<h3>Feedback reçu</h3>${list(r.feedback.map((f) => `<b>${esc(f.from)}</b> <span class="tag ${f.sentiment === 'negative' ? 'red' : f.sentiment === 'positive' ? 'green' : ''}">${f.sentiment}</span> « ${esc(f.text)} »`))}` : ''}
    </div></div>`;
}

function prepRetro(r) {
  return `${r.anticipated ? '<p class="tag orange" style="display:inline-block;margin-bottom:10px">Préparation anticipée : le sprint est encore en cours</p>' : ''}
  <div class="grid cols-2">
    <div class="card"><h3>Format suggéré : ${esc(r.format.name)}</h3><p class="muted">Parce que ${esc(r.format.why)}</p>
      <h4>Données à montrer</h4><div class="kpis">${r.dataCards.map((c) => kpi(c.label, esc(c.value))).join('')}</div>
      <h4 style="margin-top:12px">Questions pour l’équipe</h4>${r.questions.map((q) => `<div class="question">${esc(q)}</div>`).join('')}
      <h4 style="margin-top:12px">Expériences possibles</h4>${list(r.experiments.map((e) => `${esc(e.hypothesis)} <span class="muted">(${esc(e.owner)})</span>`))}
      <h4>Notes de facilitation</h4>${list(r.facilitationNotes.map(esc))}
    </div>
    <div class="card"><h3>Suivi des actions de la rétro précédente</h3>
      ${list(r.previousActions.map((a) => `${esc(a.text)} — ${esc(a.owner)} <span class="tag ${a.status === 'done' ? 'green' : a.status === 'in_progress' ? 'orange' : 'red'}">${a.status === 'done' ? 'réalisée' : a.status === 'in_progress' ? 'en cours' : 'non démarrée'}</span>`), 'Aucune action précédente.')}
      <h3>Chronologie du sprint</h3>
      ${r.timeline.length ? `<ul class="timeline">${r.timeline.map((e) => `<li class="${e.kind}">${dm(e.date)} · ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="empty">Sprint sans événement notable.</p>'}
    </div></div>`;
}

function prepPlanning(p) {
  return `<div class="grid cols-2">
    <div class="card"><h3>Capacité ${p.capacity ? `— ${esc(p.capacity.sprint)}` : ''}</h3>
      ${p.capacity ? `<p>${p.capacity.workingDays} jours ouvrés · <b>${p.capacity.personDays} jours-personne</b></p>${list(p.capacity.members.map((m) => `${esc(m.member)} : ${m.days} j${m.absences ? ` <span class="tag orange">${m.absences} j d’absence</span>` : ''}`))}` : '<p class="empty">Sprint suivant non renseigné.</p>'}
      ${p.range ? `<div class="kpis">${kpi('Fourchette réaliste', `${p.range.low}–${p.range.high}`, 'points (vélocité récente × capacité)')}${kpi('Buffer urgences', p.range.buffer, 'moyenne des ajouts')}${kpi('Engagement suggéré', `≈ ${p.range.recommended}`, 'à discuter en équipe')}</div>` : ''}
      <h4 style="margin-top:12px">Historique</h4>
      <table><thead><tr><th>Sprint</th><th class="num">Engagé</th><th class="num">Livré</th><th class="num">pt/j-p</th></tr></thead><tbody>${p.velocityHistory.map((v) => `<tr><td>${esc(v.sprint)}</td><td class="num">${v.committed}</td><td class="num">${v.done}</td><td class="num">${r2(v.perPersonDay)}</td></tr>`).join('')}</tbody></table>
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

function viewPrepare() {
  const p = state.data.prepare;
  const bodies = {
    daily: () => prepDaily(p.daily),
    review: () => prepReview(p.review),
    retro: () => prepRetro(p.retro),
    planning: () => prepPlanning(p.planning),
    report: () => `<div class="card"><div class="signal-head"><h3>Rapport de sprint (Markdown)</h3><div class="chips"><button class="btn ghost" id="copy-report">Copier</button><a class="btn" href="/api/report/${state.sprintId}.md${state.asOf ? `?asOf=${state.asOf}` : ''}" download="sobrus-copilot-${state.sprintId}.md">Télécharger .md</a></div></div><pre class="report">${esc(state.data.report)}</pre></div>`,
  };
  const aiKind = state.prep === 'report' ? null : state.prep;
  return `<div class="subtabs">${PREP.map((x) => `<button class="${x.id === state.prep ? 'active' : ''}" data-prep="${x.id}">${x.label}</button>`).join('')}</div>
    ${bodies[state.prep]()}
    ${aiKind ? aiBox(aiKind, `Rédiger la préparation « ${PREP.find((x) => x.id === aiKind).label} » avec Claude`) : ''}`;
}

// ---------------------------------------------------------------------------
// 05 — Apprendre
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
  const themes = { flow: 'Flux', dependencies: 'Dépendances', scope: 'Périmètre', predictability: 'Prévisibilité', quality: 'Qualité', team: 'Équipe', improvement: 'Amélioration', stakeholders: 'Parties prenantes' };
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
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Patterns persistants</h3>${list(l.patterns.map((p) => `<b>${esc(p.title)}</b><br><span class="muted">${esc(p.detail)}</span>`), 'Aucun pattern récurrent pour l’instant.')}</div>
      <div class="card"><h3>Mémoire d’apprentissage</h3><p class="small muted">Ce que l’équipe a jugé utile ou non : le poids de chaque type de signal s’ajuste (×0,5 à ×1,5).</p>
        ${l.learningMemory.length ? `<table><thead><tr><th>Signal</th><th class="num">👍</th><th class="num">👎</th><th class="num">Poids</th></tr></thead><tbody>${l.learningMemory.map((x) => `<tr><td><code>${esc(x.type)}</code></td><td class="num">${x.useful}</td><td class="num">${x.notUseful}</td><td class="num">×${r2(x.weight)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Aucun retour encore. Votez 👍/👎 sur les signaux de l’onglet « Comprendre ».</p>'}
      </div>
    </div>
    ${aiBox('learn', 'Analyser l’évolution de l’équipe avec Claude')}`;
}

// ---------------------------------------------------------------------------
// Couche IA générative
// ---------------------------------------------------------------------------
const aiKey = (kind) => `${state.sprintId}|${state.data.observe.asOf}|${kind}`;

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
    state.ai[key] = await api(`/api/ai/${state.sprintId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, asOf: state.asOf }) });
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
  view.querySelectorAll('[data-prep]').forEach((b) => b.addEventListener('click', () => { state.prep = b.dataset.prep; render(); }));
  view.querySelectorAll('[data-ai]').forEach((b) => b.addEventListener('click', () => runAi(b.dataset.ai)));
  view.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', async () => {
    const useful = b.dataset.vote === '1';
    await api('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signalType: b.dataset.type, useful, sprintId: state.sprintId }) });
    state.voted.add(b.dataset.type);
    await load();
  }));
  $('#copy-report')?.addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(state.data.report);
    e.target.textContent = 'Copié ✓';
  });
}

init().catch((err) => {
  $('#view').innerHTML = `<div class="card"><h2 class="error">Impossible de charger le Copilot</h2><p>${esc(err.message)}</p></div>`;
});
