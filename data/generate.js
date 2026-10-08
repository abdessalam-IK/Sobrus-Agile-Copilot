// Génère un jeu de données de démonstration (fictif) : 6 sprints d'une squad Sobrus Pharma.
// Le scénario est volontairement construit pour faire émerger des signaux faibles :
//   S1–S2 sains → S3 arrivée d'une dépendance externe → S4 urgences support & besoin instable
//   → S5 blocages récurrents, WIP élevé, livraison en fin de sprint → S6 (en cours) zombie, goulot, concentration.
// Usage : node data/generate.js

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { workingDays } from '../src/lib/calendar.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const HOLIDAYS = ['2026-07-30', '2026-08-14', '2026-08-20', '2026-08-21'];
const REFERENCE_DATE = '2026-10-08';
const PARTNER = 'API partenaire Tiers Payant';
const RECETTE = 'Environnement de recette';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261008);
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

const TEAM = [
  { id: 'yassine', name: 'Yassine', role: 'Développeur back-end' },
  { id: 'salma', name: 'Salma', role: 'Développeuse front-end' },
  { id: 'omar', name: 'Omar', role: 'Développeur full-stack' },
  { id: 'imane', name: 'Imane', role: 'Développeuse mobile' },
  { id: 'karim', name: 'Karim', role: 'QA' },
  { id: 'nadia', name: 'Nadia', role: 'Product Owner', delivery: false },
  { id: 'hamza', name: 'Hamza', role: 'Scrum Master', delivery: false },
];
const DEVS = ['yassine', 'salma', 'omar', 'imane', 'karim'];

const POOL = {
  'Ventes comptoir': ['Recherche produit par code-barres', 'Remise automatique sur promotions', 'Ticket de caisse personnalisé', 'Retour client et avoir', 'Vente en attente (mise de côté)', 'Raccourcis clavier en caisse', 'Affichage prix TTC/HT au comptoir', 'Historique des ventes par vendeur'],
  'Stock & inventaire': ['Alertes de péremption à 90 jours', 'Inventaire tournant par rayon', 'Seuils de réapprovisionnement', 'Import du référentiel produits', 'Mouvements de stock par lot', 'Ajustement d’inventaire avec motif'],
  'Commandes grossistes': ['Bon de commande automatique', 'Réception de commande avec écarts', 'Suivi des reliquats grossiste', 'Comparatif des prix grossistes'],
  'Tiers payant': ['Paramétrage des organismes (AMO, mutuelles)', 'Contrôle des droits de l’assuré', 'Édition du bordereau de facturation', 'Suivi des rejets organisme'],
  'Reporting pharmacien': ['Tableau de bord du chiffre d’affaires', 'Marge par famille de produits', 'Export mensuel pour le comptable', 'Top 20 des produits vendus'],
  'Support & maintenance': ['Correctif : arrondi TVA sur ticket', 'Correctif : lenteur de la recherche produit', 'Mise à jour des dépendances front', 'Correctif : doublon client à l’import'],
};
const used = new Set();
function title(epic) {
  const free = POOL[epic].filter((t) => !used.has(t));
  const t = free.length ? pick(free) : `${pick(POOL[epic])} (v2)`;
  used.add(t);
  return t;
}

const NOISE = ['PR ouverte', 'Revue de code OK', 'Testé en recette, RAS', 'Maquette validée avec Nadia', 'Déployé en préprod'];

/** Plan de transitions [jour, statut] pour un ticket « de fond ». */
function fillerPlan(n, p) {
  if (rng() < p.completion) {
    let ip = int(0, Math.floor(n * p.startMax));
    let rv = ip + int(1, p.cycleMax);
    let dn = rv + 1;
    if (p.late) dn = Math.max(dn, n - 1 - int(0, 2));
    dn = Math.min(dn, n - 1);
    rv = Math.min(rv, dn - 1);
    ip = Math.max(0, Math.min(ip, rv - 1));
    return [[ip, 'in_progress'], [rv, 'review'], [dn, 'done']];
  }
  const r = rng();
  if (r < 0.25) return [];
  const ip = int(Math.floor(n * 0.3), n - 3);
  if (r < 0.7) return [[ip, 'in_progress']];
  return [[ip, 'in_progress'], [Math.min(ip + int(1, 3), n - 1), 'review']];
}

function makeSprint(cfg) {
  const days = workingDays(cfg.start, cfg.end, HOLIDAYS);
  const active = cfg.status === 'active';
  const refIdx = active ? days.filter((d) => d <= REFERENCE_DATE).length - 1 : days.length - 1;
  const n = days.length;
  const d = (i) => days[Math.max(0, Math.min(i, n - 1))];
  const visible = (i) => i <= refIdx;

  const build = (spec) => {
    if (!visible(spec.addedDay || 0)) return null;
    return {
      key: spec.key,
      title: spec.title,
      type: spec.type || 'story',
      points: spec.points,
      epic: spec.epic,
      assignee: spec.assignee,
      goal: !!spec.goal,
      addedDate: d(spec.addedDay || 0),
      carriedOver: spec.carriedOver || 0,
      history: (spec.plan || []).filter(([i]) => visible(i)).map(([i, to]) => ({ date: d(i), to })),
      blocks: (spec.blocks || []).filter((b) => visible(b.from)).map((b) => ({
        from: d(b.from),
        to: b.to == null || !visible(b.to) ? null : d(b.to),
        reason: b.reason,
        dependency: b.dependency || null,
      })),
      changes: (spec.changes || []).filter(([i]) => visible(i)).map(([i, field, from, to]) => ({ date: d(i), field, from, to })),
      comments: (spec.comments || []).filter(([i]) => visible(i)).map(([i, author, text]) => ({ date: d(i), author, text })),
    };
  };

  const issues = cfg.scripted.map(build).filter(Boolean);
  let seq = cfg.firstFillerKey;
  for (let k = 0; k < cfg.fillers; k++) {
    const epic = pick(cfg.epics);
    const type = epic === 'Support & maintenance' ? 'bug' : rng() < 0.15 ? 'bug' : 'story';
    const assignee = cfg.bias && rng() < 0.45 ? cfg.bias : pick(DEVS);
    const plan = fillerPlan(n, cfg.profile);
    const comments = plan.length && rng() < 0.5 ? [[plan[plan.length - 1][0], assignee, pick(NOISE)]] : [];
    const issue = build({
      key: `PHA-${seq++}`, title: title(epic), type, epic, assignee,
      points: type === 'bug' ? pick([1, 2, 3]) : pick([2, 3, 3, 5, 5, 8]),
      goal: cfg.goalEpics.includes(epic) && rng() < 0.5,
      plan, comments,
    });
    if (issue) issues.push(issue);
  }

  return {
    id: cfg.id,
    name: cfg.name,
    status: cfg.status,
    start: cfg.start,
    end: cfg.end,
    goal: cfg.goal,
    absences: cfg.absences || {},
    issues,
    review: active ? null : cfg.review,
    retro: active ? null : cfg.retro,
  };
}

// ---------------------------------------------------------------------------
// Scénario
// ---------------------------------------------------------------------------

const S1 = makeSprint({
  id: 'S1', name: 'Sprint 1', status: 'closed', start: '2026-07-23', end: '2026-08-05',
  goal: 'Fluidifier l’encaissement au comptoir (paiements multiples + tickets)',
  epics: ['Ventes comptoir', 'Stock & inventaire', 'Reporting pharmacien'], goalEpics: ['Ventes comptoir'],
  fillers: 8, firstFillerKey: 110, profile: { completion: 0.95, startMax: 0.35, cycleMax: 2, late: false },
  scripted: [
    { key: 'PHA-101', title: 'Encaissement multi-moyens de paiement (espèces + carte)', points: 8, epic: 'Ventes comptoir', assignee: 'yassine', goal: true,
      plan: [[0, 'in_progress'], [5, 'review'], [6, 'done']], comments: [[6, 'karim', 'Validé avec la pharmacie pilote, RAS']] },
    { key: 'PHA-102', title: 'Ticket de caisse avec QR code de fidélité', points: 3, epic: 'Ventes comptoir', assignee: 'salma', goal: true,
      plan: [[1, 'in_progress'], [3, 'review'], [4, 'done']],
      blocks: [{ from: 1, to: 2, reason: 'Attente maquette du ticket', dependency: null }] },
  ],
  review: { feedback: [
    { from: 'Pharmacie pilote (Casablanca)', sentiment: 'positive', text: 'L’encaissement mixte fait gagner un temps réel au comptoir.' },
    { from: 'Direction produit', sentiment: 'positive', text: 'Bon rythme, objectif atteint.' },
  ] },
  retro: { actions: [
    { id: 'A1', text: 'Ajouter les critères d’acceptation avant le Sprint Planning', owner: 'nadia', status: 'done' },
  ] },
});

const S2 = makeSprint({
  id: 'S2', name: 'Sprint 2', status: 'closed', start: '2026-08-06', end: '2026-08-19',
  goal: 'Sécuriser le stock : alertes de péremption et inventaire tournant',
  epics: ['Stock & inventaire', 'Commandes grossistes', 'Ventes comptoir'], goalEpics: ['Stock & inventaire'],
  absences: { salma: ['2026-08-17', '2026-08-18'] },
  fillers: 10, firstFillerKey: 210, profile: { completion: 0.95, startMax: 0.35, cycleMax: 2, late: false },
  scripted: [
    { key: 'PHA-201', title: 'Moteur d’alertes de péremption', points: 8, epic: 'Stock & inventaire', assignee: 'omar', goal: true,
      plan: [[0, 'in_progress'], [4, 'review'], [5, 'done']] },
  ],
  review: { feedback: [
    { from: 'Pharmacie pilote (Rabat)', sentiment: 'positive', text: 'Les alertes de péremption évitent des pertes, très attendu.' },
  ] },
  retro: { actions: [
    { id: 'A2', text: 'Pair review systématique sur les stories de plus de 5 points', owner: 'omar', status: 'done' },
  ] },
});

const S3 = makeSprint({
  id: 'S3', name: 'Sprint 3', status: 'closed', start: '2026-08-20', end: '2026-09-02',
  goal: 'Démarrer l’intégration Tiers payant AMO',
  epics: ['Tiers payant', 'Stock & inventaire', 'Commandes grossistes'], goalEpics: ['Tiers payant'],
  fillers: 7, firstFillerKey: 310, profile: { completion: 0.88, startMax: 0.45, cycleMax: 3, late: false },
  scripted: [
    { key: 'PHA-301', title: 'Connexion à l’API partenaire tiers payant (authentification)', points: 8, epic: 'Tiers payant', assignee: 'yassine', goal: true,
      plan: [[0, 'in_progress'], [6, 'review'], [7, 'done']],
      blocks: [{ from: 1, to: 4, reason: 'Accès sandbox non fourni par le partenaire', dependency: PARTNER }],
      comments: [[2, 'yassine', 'On attend toujours les identifiants sandbox du partenaire'], [4, 'hamza', 'Relancé le partenaire par mail et téléphone']] },
    { key: 'PHA-302', title: 'Calcul de la part assuré / part AMO', points: 5, epic: 'Tiers payant', assignee: 'omar', goal: true,
      plan: [[2, 'in_progress']],
      blocks: [{ from: 3, to: null, reason: 'Barèmes AMO non communiqués par le partenaire', dependency: PARTNER }],
      comments: [[5, 'omar', 'Toujours en attente des barèmes, je passe sur autre chose']] },
  ],
  review: { feedback: [
    { from: 'Direction commerciale', sentiment: 'neutral', text: 'Les pharmaciens attendent le tiers payant avant la rentrée, la date est importante.' },
  ] },
  retro: { actions: [
    { id: 'A3', text: 'Mettre en place un point hebdomadaire avec le partenaire API', owner: 'hamza', status: 'done' },
    { id: 'A4', text: 'Limiter le WIP à 2 tickets par personne', owner: 'hamza', status: 'not_started' },
  ] },
});

const S4 = makeSprint({
  id: 'S4', name: 'Sprint 4', status: 'closed', start: '2026-09-03', end: '2026-09-16',
  goal: 'Finaliser le tiers payant AMO et la feuille de soins',
  epics: ['Tiers payant', 'Ventes comptoir', 'Reporting pharmacien'], goalEpics: ['Tiers payant'],
  fillers: 8, firstFillerKey: 410, profile: { completion: 0.78, startMax: 0.4, cycleMax: 4, late: false },
  scripted: [
    { key: 'PHA-302', title: 'Calcul de la part assuré / part AMO', points: 5, epic: 'Tiers payant', assignee: 'omar', goal: true, carriedOver: 1,
      plan: [[0, 'in_progress'], [5, 'review'], [6, 'done']] },
    { key: 'PHA-401', title: 'Feuille de soins électronique', points: 8, epic: 'Tiers payant', assignee: 'yassine', goal: true,
      plan: [[1, 'in_progress'], [8, 'review']],
      changes: [[2, 'points', 5, 8], [4, 'acceptance', 'v1', 'v2 (nouveaux champs mutuelle)']],
      comments: [[4, 'yassine', 'Les règles des mutuelles ne sont pas claires, à re-spécifier avec Nadia'], [7, 'karim', 'Critères d’acceptation modifiés, je dois refaire les cas de test']] },
    { key: 'PHA-402', title: 'Correctif : écart de stock après retour client', type: 'bug', points: 3, epic: 'Support & maintenance', assignee: 'salma', addedDay: 2,
      plan: [[2, 'in_progress'], [4, 'review'], [5, 'done']], comments: [[2, 'nadia', 'Urgent : remonté par 3 pharmacies au support']] },
    { key: 'PHA-403', title: 'Correctif : ticket non imprimé sur imprimante thermique', type: 'bug', points: 2, epic: 'Support & maintenance', assignee: 'imane', addedDay: 4,
      plan: [[4, 'in_progress'], [5, 'review'], [6, 'done']] },
    { key: 'PHA-404', title: 'Export comptable mensuel (demande client)', points: 3, epic: 'Reporting pharmacien', assignee: 'omar', addedDay: 6,
      plan: [[6, 'in_progress'], [8, 'review'], [9, 'done']], comments: [[6, 'nadia', 'Demande urgente de la direction pour un client grand compte']] },
    { key: 'PHA-405', title: 'Correctif : arrondi de la part mutuelle', type: 'bug', points: 2, epic: 'Tiers payant', assignee: 'imane',
      plan: [[1, 'in_progress'], [3, 'review'], [4, 'done'], [6, 'in_progress'], [8, 'review'], [9, 'done']],
      comments: [[6, 'karim', 'Rouvert : régression sur les remises cumulées']] },
  ],
  review: { feedback: [
    { from: 'Pharmacie pilote (Casablanca)', sentiment: 'neutral', text: 'Contents des correctifs, mais la feuille de soins n’est pas encore utilisable.' },
    { from: 'Direction produit', sentiment: 'negative', text: 'Le tiers payant glisse encore d’un sprint.' },
  ] },
  retro: { actions: [
    { id: 'A5', text: 'Réserver un buffer de 15 % de capacité pour les urgences support', owner: 'nadia', status: 'not_started' },
    { id: 'A6', text: 'Limiter le WIP à 2 tickets par personne', owner: 'hamza', status: 'not_started' },
    { id: 'A7', text: 'Clarifier la Definition of Done avec la QA', owner: 'karim', status: 'done' },
  ] },
});

const S5 = makeSprint({
  id: 'S5', name: 'Sprint 5', status: 'closed', start: '2026-09-17', end: '2026-09-30',
  goal: 'Mise en production pilote du tiers payant',
  epics: ['Tiers payant', 'Commandes grossistes', 'Ventes comptoir', 'Support & maintenance'], goalEpics: ['Tiers payant'],
  fillers: 8, firstFillerKey: 510, profile: { completion: 0.7, startMax: 0.25, cycleMax: 5, late: true },
  scripted: [
    { key: 'PHA-401', title: 'Feuille de soins électronique', points: 8, epic: 'Tiers payant', assignee: 'yassine', goal: true, carriedOver: 1,
      plan: [[0, 'review'], [2, 'in_progress']],
      changes: [[3, 'acceptance', 'v2', 'v3 (format CNSS 2026)']],
      comments: [[2, 'karim', 'Retour en dev : le format CNSS a changé'], [6, 'yassine', 'Pas clair si on doit gérer l’ancien format en parallèle']] },
    { key: 'PHA-501', title: 'Rapprochement des remboursements AMO', points: 8, epic: 'Tiers payant', assignee: 'yassine', goal: true,
      plan: [[0, 'in_progress'], [8, 'review'], [9, 'done']],
      blocks: [{ from: 1, to: 6, reason: 'Endpoint de remboursement instable (erreurs 500)', dependency: PARTNER }],
      comments: [[3, 'yassine', 'On attend toujours le correctif du partenaire'], [5, 'hamza', 'Escaladé au responsable partenaire']] },
    { key: 'PHA-502', title: 'Tests de bout en bout du tiers payant en recette', type: 'task', points: 5, epic: 'Tiers payant', assignee: 'karim', goal: true,
      plan: [[2, 'in_progress'], [9, 'review']],
      blocks: [{ from: 3, to: 7, reason: 'Recette indisponible (base non synchronisée)', dependency: RECETTE }],
      comments: [[4, 'karim', 'Recette encore cassée, je suis bloqué']] },
    { key: 'PHA-503', title: 'Règles de prise en charge des mutuelles privées', points: 8, epic: 'Tiers payant', assignee: 'omar', goal: true,
      plan: [[1, 'in_progress'], [9, 'review']],
      changes: [[2, 'points', 3, 5], [5, 'points', 5, 8], [6, 'acceptance', 'v1', 'v2']],
      comments: [[5, 'omar', 'Le besoin a encore changé, il faut re-spécifier les plafonds']] },
    { key: 'PHA-504', title: 'Correctif : blocage caisse en fin de journée', type: 'bug', points: 3, epic: 'Support & maintenance', assignee: 'salma', addedDay: 3,
      plan: [[3, 'in_progress'], [4, 'review'], [5, 'done']], comments: [[3, 'nadia', 'Urgent : client grand compte impacté']] },
    { key: 'PHA-505', title: 'Correctif : synchronisation hors ligne', type: 'bug', points: 3, epic: 'Support & maintenance', assignee: 'imane', addedDay: 5,
      plan: [[5, 'in_progress'], [6, 'review'], [7, 'done'], [8, 'in_progress'], [9, 'done']],
      comments: [[8, 'karim', 'Rouvert : régression constatée chez un client']] },
  ],
  review: { feedback: [
    { from: 'Direction générale', sentiment: 'negative', text: 'Pilote décalé : la direction s’interroge sur la date de mise en production.' },
    { from: 'Pharmacie pilote (Rabat)', sentiment: 'neutral', text: 'Nous restons motivés mais avons besoin d’une date fiable.' },
  ] },
  retro: { actions: [
    { id: 'A8', text: 'Escalader les blocages partenaires sous 24h', owner: 'hamza', status: 'in_progress' },
    { id: 'A9', text: 'Limiter le WIP à 2 tickets par personne', owner: 'hamza', status: 'not_started' },
    { id: 'A10', text: 'Stabiliser l’environnement de recette', owner: 'omar', status: 'in_progress' },
  ] },
});

const S6 = makeSprint({
  id: 'S6', name: 'Sprint 6', status: 'active', start: '2026-10-01', end: '2026-10-14',
  goal: 'Ouvrir le tiers payant à 3 pharmacies pilotes',
  epics: ['Tiers payant', 'Ventes comptoir', 'Stock & inventaire'], goalEpics: ['Tiers payant'],
  absences: { imane: ['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14'] },
  bias: 'yassine',
  fillers: 7, firstFillerKey: 610, profile: { completion: 0.75, startMax: 0.4, cycleMax: 4, late: false },
  scripted: [
    { key: 'PHA-401', title: 'Feuille de soins électronique', points: 8, epic: 'Tiers payant', assignee: 'yassine', goal: true, carriedOver: 2,
      plan: [[0, 'in_progress']], comments: [[3, 'yassine', 'Toujours pas clair pour l’ancien format, en attente de Nadia']] },
    { key: 'PHA-503', title: 'Règles de prise en charge des mutuelles privées', points: 8, epic: 'Tiers payant', assignee: 'omar', goal: true, carriedOver: 1,
      plan: [[0, 'review'], [3, 'done']] },
    { key: 'PHA-601', title: 'Passage en production de l’API partenaire', points: 5, epic: 'Tiers payant', assignee: 'yassine', goal: true,
      plan: [[0, 'in_progress']],
      blocks: [{ from: 1, to: null, reason: 'Certificat de production non délivré par le partenaire', dependency: PARTNER }],
      comments: [[2, 'yassine', 'On attend toujours le certificat de prod'], [4, 'hamza', 'Relancé, pas de date annoncée par le partenaire']] },
    { key: 'PHA-602', title: 'Paramétrage des 3 pharmacies pilotes', type: 'task', points: 3, epic: 'Tiers payant', assignee: 'yassine', goal: true,
      plan: [[0, 'in_progress'], [2, 'review']], comments: [[2, 'yassine', 'En attente de revue']] },
    { key: 'PHA-603', title: 'Formation des pharmaciens pilotes (support + guide)', type: 'task', points: 3, epic: 'Tiers payant', assignee: 'imane', goal: true,
      plan: [] },
    { key: 'PHA-604', title: 'Correctif : remise fidélité non appliquée', type: 'bug', points: 2, epic: 'Support & maintenance', assignee: 'salma', addedDay: 2,
      plan: [[2, 'in_progress'], [4, 'review']], comments: [[2, 'nadia', 'Urgent : remonté par le support']] },
  ],
});

const dataset = {
  meta: {
    product: 'Sobrus Pharma',
    team: 'Squad Officine',
    demo: true,
    description: 'Données fictives générées pour démontrer Sobrus AI Copilot.',
    referenceDate: REFERENCE_DATE,
    holidays: HOLIDAYS,
  },
  team: TEAM,
  sprints: [S1, S2, S3, S4, S5, S6],
  nextSprint: {
    id: 'S7', name: 'Sprint 7', start: '2026-10-15', end: '2026-10-28',
    absences: { omar: ['2026-10-19', '2026-10-20', '2026-10-21'], karim: ['2026-10-26'] },
  },
  backlog: [
    { key: 'PHA-701', title: 'Télétransmission des feuilles de soins AMO', epic: 'Tiers payant', points: 13, priority: 1, acceptanceCriteria: true, dependency: PARTNER, dependencyConfirmed: false },
    { key: 'PHA-702', title: 'Gestion des rejets AMO', epic: 'Tiers payant', points: 8, priority: 2, acceptanceCriteria: false, dependency: PARTNER, dependencyConfirmed: false },
    { key: 'PHA-703', title: 'Alertes de rupture grossiste', epic: 'Commandes grossistes', points: 5, priority: 3, acceptanceCriteria: true },
    { key: 'PHA-704', title: 'Refonte de l’écran d’inventaire mobile', epic: 'Stock & inventaire', points: null, priority: 4, acceptanceCriteria: false },
    { key: 'PHA-705', title: 'Performance de la recherche produit (indexation)', epic: 'Ventes comptoir', points: 5, priority: 5, acceptanceCriteria: true },
    { key: 'PHA-706', title: 'Paramétrage des mutuelles privées (vague 2)', epic: 'Tiers payant', points: 8, priority: 6, acceptanceCriteria: false, notes: 'Règles de prise en charge à confirmer avec les mutuelles' },
    { key: 'PHA-707', title: 'Export des ventes pour le comptable (CSV)', epic: 'Reporting pharmacien', points: 3, priority: 7, acceptanceCriteria: true },
  ],
};

const out = path.join(here, 'sobrus-demo.json');
writeFileSync(out, JSON.stringify(dataset, null, 2));
console.log(`Jeu de données généré : ${out}`);
