# Sobrus AI Copilot

**Une couche d'intelligence autour du delivery Agile des équipes Sobrus.**
Il lit les sprints dans Linear et la capacité dans les Google Sheets, repère les signaux faibles et prépare les cérémonies.

> L'IA ne remplace ni le Scrum Master, ni le Product Owner, ni l'équipe.
> Elle observe le sprint, relie les signaux et prépare la discussion.

## Démarrage rapide

Prérequis : Node.js 20 ou plus récent, une clé API Linear en lecture seule.

1. Dans un fichier `.env` à la racine (jamais versionné) : `LINEAR_API_KEY=lin_api_...`
2. Exports CSV de la Sheet « Taux d'Occupation Sobrus » dans `data/private/Sheets/`.

```bash
npm install
```

```bash
npm run sync
```

```bash
npm start
```

Ouvrir http://localhost:4300 et choisir le **projet** en haut de l'écran. Ensuite, le bouton **↻ Synchroniser Linear** rafraîchit tous les projets sans passer par le terminal.

## Projets suivis

Le Copilot suit plusieurs équipes Linear, une par projet. Aujourd'hui : **Sobrus Supply (SUPP)** et **Sobrus Central V2 (CEN)**. Pour en ajouter une, ajouter sa clé Linear dans `.env` (`LINEAR_TEAMS=SUPP,CEN,PHARM`) puis lancer `npm run sync`. Chaque projet est synchronisé dans `data/private/linear-<clé>.json`.

**Charge des développeurs, tous projets** (page Sprint) : chaque projet garde sa propre capacité ; en plus, les estimations de chaque développeur sont additionnées sur tous les projets du sprint en cours. Au-delà de 1,2 fois ce qu'il peut absorber (jours disponibles × rythme de référence des 3 derniers sprints), le Copilot signale une **surcharge**.

## Comment ça marche

| Étape | Ce qu'elle fait | Code |
|---|---|---|
| **Observer** | Reconstruit chaque sprint depuis l'historique Linear : statuts, ajouts, reports, blocages, capacité, fonctionnalités et leurs sous-tickets. | [observe.js](src/engine/observe.js) |
| **Comprendre** | Détecteurs de signaux : tickets immobiles, blocages, ajouts après le Planning, reports, besoin qui change, tickets rouverts, concentration de la charge, absences, tickets non estimés, sous-tickets hors du cycle, prévision de fin de sprint… | [understand.js](src/engine/understand.js) |
| **Penser** | Regroupe les signaux par thème, produit le titre du sprint (3 priorités au plus), la lecture transverse, les recommandations et le score de santé. | [think.js](src/engine/think.js) |
| **Préparer** | Daily, Sprint Review, Rétrospective (données, chronologie, suivi des actions), prochain Planning (capacité, fourchette, tickets à challenger), rapport Markdown. | [prepare.js](src/engine/prepare.js) |
| **Apprendre** | Compare les sprints : tendances, glissements dans la manière de travailler, problèmes qui reviennent. | [learn.js](src/engine/learn.js) |

Le moteur est déterministe, explicable et testé. Claude n'intervient qu'à la fin, pour rédiger : [src/ai/claude.js](src/ai/claude.js).

### Indicateurs de flux

| Indicateur | Définition |
|---|---|
| **Tickets imprévus** | Tickets entrés dans le sprint après le premier jour, regroupés par origine grâce aux labels `Source/Customer care`, `Source/Business developer`, `Source/Tools & Benchmark` (sinon « source non précisée ») |
| **Précision du Planning** | Part des tickets planifiés (présents le premier jour) qui sont livrés, et part du travail livré qui était planifiée |
| **Cycle time par étape** | Durée médiane, en jours ouvrés, de chaque étape : attente avant développement, développement, test QA, attente OVH, attente PROD. Calculée sur les tickets terminés des 3 derniers sprints ; une étape vue sur moins de 8 tickets est marquée « données insuffisantes » |
| **Délai jusqu'en PROD** | Médiane entre le premier passage en « In Progress » et « Vérifié en PROD » |
| **Blocages** | Jours-ticket passés en « Stuck » ou avec un label d'attente, par cause |
| **Âge du travail en cours** | Jours depuis le premier « In Progress », comparés au temps habituel de l'équipe : au-delà de ce que dépassent seulement 15 % des tickets, le ticket est signalé |

### Objectifs

| Indicateur | Définition |
|---|---|
| **Objectif de sprint** | Description du cycle Linear renseignée ou non ; éléments clés (label « commitment prod ») livrés |
| **Répartition de l'effort** | Tickets terminés par catégorie : *Projets* (rattachés à un projet Linear), *Bugs & support*, *Technique* (labels Technical, Improv, infra…), *Hors projet* |
| **Projets Linear** | Pour chaque projet travaillé pendant les 4 derniers sprints : tickets restants (toutes équipes), rythme de l'équipe (tickets du projet terminés par sprint), fin prévisible, et alertes (date cible dépassée, pas de date cible, statut Linear pas à jour, projet qui n'avance presque plus). En dessous d'un ticket par sprint, aucune date n'est projetée |

### Santé du sprint

**Santé = 60 % avancement + 40 % signaux**, sans double comptage :
- **avancement** : travail terminé comparé à l'attendu à ce jour du sprint (en tickets, et en points quand au moins 75 % des tickets sont estimés) ;
- **signaux** : un seul retrait par thème (le signal le plus grave) ; la prévision de fin de sprint n'y compte pas, elle est déjà dans l'avancement.

Le détail du calcul est affiché sous la jauge et dans les Précisions.

## Interface

Trois niveaux, du plus synthétique au plus détaillé.

**1. Vue Sobrus** (page d'accueil, sélecteur « Vue ») : tous les projets sur un seul écran, pour répondre en quelques secondes à trois questions.
- *Nos projets avancent-ils ?* Une carte par projet : statut (dans les temps / sous tension / en difficulté), tickets livrés comparés à l'attendu, point principal, trois repères (imprévu, travail rattaché à un projet, objectif de sprint écrit).
- *Qu'est-ce qui demande une décision cette semaine ?* Au plus 5 décisions, tous projets confondus. Un même problème dans plusieurs projets ne compte qu'une fois. Chacune indique l'action proposée et qui la porte.
- *Qu'est-ce qui change ?* Les évolutions de fond de chaque projet, sprint après sprint.

**2. Un projet, l'essentiel** : le badge « conseillé » indique la page utile au moment présent.

| Page | À quoi elle sert |
|---|---|
| **Résumé** | Le verdict du sprint, les points qui demandent votre attention et 3 actions proposées |
| **Daily** | Ce qui a bougé, ce qui bloque, les questions à poser |
| **Sprint Review** · **Rétrospective** · **Prochain Planning** | Préparation de chaque cérémonie |

**3. Un projet, analyses détaillées** (ligne secondaire du menu) : **Sprint** (board, fonctionnalités, burndown, charge), **Indicateurs** (imprévu, Planning, flux jusqu'en PROD, blocages, âge du travail en cours), **Objectifs** (objectif de sprint, travail rattaché aux projets, projets Linear), **Signaux**, **Tendances**, **Rapport**.

- **Étoiles ★** dans le bandeau : chaque point renvoie aux **Précisions** en bas de page (tickets concernés, preuves, question à poser).
- **Rédaction avec Claude** : la note du Daily, et le bilan de fin de sprint (Review, Rétro et Planning en un seul document). Elle passe par Claude Code et votre siège Claude, sans clé API.

## Équipe et capacité

La composition de chaque équipe est déclarée dans `data/private/equipe.json` (non versionné, pris en compte à la prochaine synchronisation) :

```json
{
  "equipes": {
    "SUPP": {
      "membres": [{ "email": "prenom.n@sobrus.com", "role": "Tech Lead & Back-end" }],
      "hors_equipe": { "prenom.n@sobrus.com": "PM" }
    }
  }
}
```

- **Membres** : ils forment l'équipe du projet (charge, rythme, Planning), même sans ticket sur la période. Congés et jours fériés (Sheet, onglet *Manual_Input*) sont déduits.
- **Interventions d'autres équipes** : un développeur membre d'une autre équipe qui prend un ou deux tickets du projet est affiché à part (tickets, points). Il ne fait pas partie de l'équipe, mais ces tickets s'ajoutent à sa charge tous projets confondus.
- **Autres personnes assignées** (PM, PO, design…) : visibles, sans effet sur la charge.

Sans composition déclarée pour une équipe, le Copilot se replie sur la liste « Développeurs » de la Sheet Config. Linear n'enregistre pas d'heures : les interventions sont mesurées en tickets et en points.

## Règles Linear appliquées

- Les statuts suivent les types Linear ; « Done à tester » compte comme terminé.
- « Todo for Dev » compte comme à faire (pas comme en cours) ; « Stuck » compte comme bloqué.
- Un ticket parent est terminé quand tous ses sous-tickets le sont.
- Labels d'attente (tout label commençant par « Besoin », « En Standby », « à discuter »…) = blocages, sans tenir compte des majuscules ; label « commitment prod » = objectif du sprint.
- Dates converties en heure du Maroc.

## Ligne de commande

```bash
node cli.js signals
```

```bash
node cli.js report --out rapport.md
```

## Configuration (`.env`)

| Variable | Rôle | Défaut |
|----------|------|--------|
| `LINEAR_API_KEY` | Clé API Linear (lecture seule) | — |
| `LINEAR_TEAMS` | Équipes Linear suivies (clés, séparées par des virgules) | `SUPP,CEN` |
| `PORT` | Port HTTP | `4300` |
| `SOBRUS_AI_PSEUDONYMIZE` | Remplace les prénoms par « Membre A, B… » avant l'envoi à Claude | `true` |

## Tests

```bash
npm test
```

Les tests utilisent un jeu de données fictif ([test/fixtures](test/fixtures)), régénérable avec `npm run generate`.

## Structure

```
src/adapters/           Linear (lecture seule) et exports Sheets
src/engine/             observer → comprendre → penser → préparer → apprendre
src/ai/claude.js        rédaction avec Claude
src/sync.js             synchronisation Linear + Sheets
server.js / public/     API + interface web (sans framework, sans build)
cli.js                  rapports en ligne de commande
test/                   tests + jeu de données fictif
data/private/           données réelles (jamais versionnées)
docs/VISION.md          vision, principes, feuille de route
```
