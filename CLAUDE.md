# Sobrus AI Copilot — consignes pour Claude Code

Copilote Agile des équipes Sobrus : il observe Linear (et le Google Sheet « Taux d'Occupation Sobrus »), relie les signaux et prépare les cérémonies (Daily, Sprint Review, Rétrospective, Planning). **L'IA ne remplace ni le Scrum Master, ni le Product Owner, ni l'équipe** : elle prépare la discussion, elle ne décide pas.

Toute l'interface et les textes sont **en français**. Les utilisateurs sont des responsables Sobrus : lisibilité maximale, phrases courtes, pas de jargon.

## Architecture

- Node ≥ 20, modules ESM, **aucun framework** (`node:http`, interface en JS/CSS vanilla dans `public/`). Ne pas ajouter de framework ni de dépendance sans raison forte.
- `src/adapters/` : Linear (GraphQL, lecture seule, pages de 8 à cause de la limite de complexité), Google Sheet (`sheets.js`).
- `src/engine/` : `observe` (mesures du sprint) → `understand` (signaux) → `think` (insights, santé) → `prepare` (Daily, Review, Rétro, Planning, rapport) → `learn` (tendances). `portfolio.js` = charge multi-projets, `sobrus.js` = Vue Sobrus.
- `src/http.js` : application HTTP partagée par `server.js` (local) et `api/index.js` (Vercel).
- `src/sync.js` : synchronisation Linear de toutes les équipes (3 à la fois).
- Données privées **jamais dans Git** : `.env`, `data/private/` (équipes, données Linear, exports Sheets, script Apps Script avec son code secret).

## Règles métier validées (ne pas les changer sans accord explicite)

**Les calculs sont tout** : chaque nombre affiché doit correspondre exactement à la liste de tickets qu'il annonce, et chaque ticket listé indique son statut (à faire, en cours, bloqué, terminé).

- **Statuts Linear** : type `completed` = terminé, y compris « Done à tester ». « Todo for Dev » = à faire. « Stuck » = bloqué. Tout label commençant par « Besoin… », « En Standby », « à discuter », « Testing/Manque de détails » = attente / blocage (comparaison insensible à la casse). Label « commitment prod » = élément clé.
- **Tickets parents** : un parent est terminé quand **tous** ses sous-tickets le sont ; les parents suivis par leurs sous-tickets ne sont pas comptés en double.
- **Report** : un ticket est reporté s'il a séjourné au moins 24 h dans un cycle précédent distinct (`previousCycles`).
- **Équipes** : déclarées par projet dans `data/private/equipe.json` (membres avec rôle, `hors_equipe`). Un développeur d'une autre équipe = « intervention » (visible, hors capacité du projet) ; PM, PO, design = hors équipe. Sans équipe déclarée : développeurs du Sheet, sauf ceux déclarés ailleurs.
- **Charge = en heures sur la durée du sprint** (règle du Sheet) : heures estimées = estimations des tickets du sprint, tous projets confondus, **1 point = 1 h** ; heures disponibles = jours ouvrés × 8 h − congés − fériés − réunions (Sheet, projetées sur tout le sprint en cours) ; occupation = estimées / disponibles ; **surcharge au-delà de 100 %**. Le nombre de tickets et la part du sprint portée par une personne **ne comptent pas** (un seul développeur back peut porter tout le back). Ne jamais réintroduire de « jours-personne ».
- **Sprint Review** :
  - sous-ticket livré = « Done à tester », « Vérifié par QA », « Vérifié en OVH » ou « Vérifié en PROD » ;
  - parents classés selon leur propre statut : **Atteint en PROD** (« Vérifié en PROD »), **Atteint en OVH** (« Done à tester », « Vérifié par QA », « Vérifié en OVH »), **Non atteint** (tout autre statut) ;
  - chaque parent affiche « X tickets livrés sur Y » ; tous livrés = vert, en tête ; partiel = orange, en bas ;
  - messages clés : une phrase par message, tickets **repliés par défaut** (liste déroulante), jamais affichés en clair.
- **Rétrospective** : chaque question part d'un fait chiffré du sprint (à garder, à améliorer, à comprendre, actions passées, conclusion). La question sur le Planning tenu n'apparaît qu'en fin de sprint.
- **Daily** : « ce qui a bougé » liste chaque changement de statut (statut d'origine → nouveau, heure locale) depuis le dernier jour ouvré.
- **Heures** : fuseau `COPILOT_TZ` (UTC, l'heure des postes Sobrus) ; l'interface reçoit le décalage du serveur.
- **Navigation** : Accueil = modules (Développement, Infrastructure, Refonte & Fusions) → module Développement = cartes des équipes (2 par ligne) puis « Ce qui change d'un sprint à l'autre », sans bloc « À décider » → page équipe. Adresses : `#developpement`, `#SUPP`… ; fil d'Ariane en haut.
- **IA générative** (Claude Code / API) : uniquement en local, jamais en ligne.

## Travailler sur le projet

```bash
npm install
npm test            # 18 tests (node --test) : doivent toujours passer
npm run sync        # importe Linear (+ Sheet) dans data/private
npm start           # http://localhost:4300
```

- Après une modification visible, vérifier dans le navigateur sur les **vraies données** (Supply et Central au minimum) et comparer les nombres aux listes affichées.
- Commits en français, descriptifs. Travailler sur une **branche** et ouvrir une **pull request** vers `main` : la fusion sur `main` publie automatiquement la version en ligne.

## Mise en ligne (Vercel)

- Lien : https://sobrus-agile-copilot.vercel.app — chaque fusion sur `main` déclenche le déploiement (1 à 2 min).
- Le déploiement ne contient **aucune donnée** : tout vient du store privé Vercel Blob (données Linear, équipes, Sheet), rafraîchi par la synchronisation automatique (toutes les 30 min) et par l'Apps Script du Sheet (toutes les 30 min).
- Les aperçus de pull request ne peuvent pas écrire dans le store (seule la production le peut).
- Quand `data/private/equipe.json` change : `npm run cloud:push` (envoie la composition des équipes au store).
- Ne jamais lire, afficher ni commiter les secrets (`.env`, clés, jetons).
