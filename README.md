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

### Santé du sprint

**Santé = 60 % avancement + 40 % signaux**, sans double comptage :
- **avancement** : travail terminé comparé à l'attendu à ce jour du sprint (en tickets, et en points quand au moins 75 % des tickets sont estimés) ;
- **signaux** : un seul retrait par thème (le signal le plus grave) ; la prévision de fin de sprint n'y compte pas, elle est déjà dans l'avancement.

Le détail du calcul est affiché sous la jauge et dans les Précisions.

## Interface

Un seul menu, dans l'ordre où l'on en a besoin au fil du sprint. Le badge **« conseillé »** indique la page utile au moment présent.

| Groupe | Page | À quoi elle sert |
|---|---|---|
| Pendant le sprint | **Vue d'ensemble** | L'essentiel en 30 secondes : signaux prioritaires, lecture transverse, recommandations |
| | **Daily** | Ce qui a bougé, ce qui bloque, les questions à poser |
| | **Sprint** | Indicateurs, board, fonctionnalités, burndown, charge par développeur |
| | **Signaux** | Chaque signal avec ses preuves et la question à poser |
| Fin de sprint | **Sprint Review** · **Rétrospective** · **Prochain Planning** | Préparation de chaque cérémonie |
| Prendre du recul | **Tendances** | Ce qui change de sprint en sprint |
| | **Rapport** | Export Markdown |

- **Étoiles ★** dans le bandeau : chaque point renvoie aux **Précisions** en bas de page (tickets concernés, preuves, question à poser).
- **Rédaction avec Claude** : la note du Daily, et le bilan de fin de sprint (Review, Rétro et Planning en un seul document). Elle passe par Claude Code et votre siège Claude, sans clé API.

## Équipe et capacité

Toutes les personnes assignées dans Linear sont visibles, mais **seuls les développeurs comptent dans la capacité** :

1. **Référence** : la liste « Développeurs » de l'onglet *Config* de la Sheet. Les autres personnes (responsables, PO, design…) sont affichées « hors capacité ».
2. **Par sprint** : un développeur de cette liste compte dans un sprint s'il a au moins un ticket de l'équipe dans ce sprint.
3. **Congés et jours fériés** (onglet *Manual_Input*) sont déduits.

Corrections manuelles possibles dans `data/private/equipe.json` (facultatif, non versionné), prises en compte à la prochaine synchronisation :

```json
{
  "inclure": ["prenom.n@sobrus.com"],
  "exclure": ["prenom.n@sobrus.com"],
  "allocation": { "prenom.n@sobrus.com": 0.5 }
}
```

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
