# Sobrus AI Copilot

**Une couche d'intelligence autour du delivery Agile des équipes Sobrus.**
Prototype expérimental qui accompagne un sprint de bout en bout :

```
Backlog → Sprint Planning → Sprint → Daily → Metrics → Risks → Sprint Review → Rétrospective → Next Sprint
                                        ↓
                                    AI LAYER
                                        ↓
       INSIGHTS → RISQUES → RECOMMANDATIONS → PRÉPARATION → APPRENTISSAGE
```

> L'IA ne remplace ni le Scrum Master, ni le Product Owner, ni l'équipe.
> Elle observe le sprint, repère les signaux faibles et prépare l'équipe pour la suite.

## Démarrage rapide

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
```

```bash
npm start
```

Ouvrir http://localhost:4300. Le jeu de données de démo (6 sprints fictifs de la *Squad Officine – Sobrus Pharma*) est déjà généré. Le sprint 6 est « en cours » au 08/10/2026.

Pour activer la couche IA générative (optionnelle), définir la clé avant de lancer le serveur :

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Le moteur d'analyse fonctionne entièrement **sans IA générative** : il est déterministe, explicable et testable. Claude intervient ensuite pour rédiger, synthétiser et approfondir.

## Les 5 briques

| # | Brique | Ce qu'elle fait | Code |
|---|--------|-----------------|------|
| 01 | **OBSERVE** | Récupère backlog, tickets, statuts, délais, blocages, capacité, commentaires, feedback, historique. Peut **rejouer** un sprint jour par jour. | [observe.js](src/engine/observe.js) |
| 02 | **UNDERSTAND** | 17 détecteurs de patterns : tickets immobiles, blocages, goulot externe, dépendance récurrente, WIP, ajouts en cours de sprint, besoin instable, baisse de vélocité, sur-engagement, prévision Monte Carlo, objectif menacé, tickets zombies, livraison en fin de sprint, qualité, concentration de charge, absences, signaux faibles dans les commentaires, actions de rétro non suivies, inquiétude des parties prenantes. | [understand.js](src/engine/understand.js) |
| 03 | **THINK** | Relie les signaux en insights par thème, produit le titre (« Ce sprint présente trois signaux… »), la lecture transverse, le score de santé et les recommandations. | [think.js](src/engine/think.js) |
| 04 | **PREPARE** | Prépare le Daily, la Sprint Review, la Rétrospective (format suggéré, chronologie, suivi des actions), le prochain Sprint Planning (capacité, fourchette, éléments à challenger), le registre des risques et un rapport Markdown. | [prepare.js](src/engine/prepare.js) |
| 05 | **LEARN** | Compare les sprints : tendances, glissements dans la manière de travailler, patterns persistants, carte de chaleur des thèmes, et **apprentissage par le feedback** (👍/👎 sur chaque signal → pondération). | [learn.js](src/engine/learn.js) |

Couche IA générative : [src/ai/claude.js](src/ai/claude.js) — reçoit uniquement l'analyse agrégée, **noms pseudonymisés par défaut**.

## Interface

Un seul menu, dans l'ordre où l'on en a besoin au fil du sprint. Le badge **« conseillé »** indique la page utile au moment présent.

| Groupe | Page | À quoi elle sert | Brique |
|---|---|---|---|
| Pendant le sprint | **Vue d'ensemble** | L'essentiel en 30 secondes : signaux prioritaires, lecture transverse, recommandations | THINK |
| | **Daily** | Ce qui a bougé, ce qui bloque, les questions à poser | PREPARE |
| | **Sprint** | Indicateurs, board, burndown, charge par personne | OBSERVE |
| | **Signaux & risques** | Chaque signal avec ses preuves (votes 👍/👎) et le registre des risques | UNDERSTAND |
| Fin de sprint | **Sprint Review** · **Rétrospective** · **Prochain Planning** | Préparation de chaque cérémonie | PREPARE |
| Prendre du recul | **Tendances** | Ce qui change de sprint en sprint | LEARN |
| | **Rapport** | Export Markdown | PREPARE |

- **↻ Synchroniser Linear** (en haut à droite) : rafraîchit Linear et les Sheets en ~20 s. La date passe en orange si les données ne sont pas du jour.
- **« Voir le sprint au jour N »** : remonter dans le temps pour voir ce que le Copilot aurait signalé ce jour-là.
- **Boutons ✦ Claude** : rédaction de chaque préparation avec votre siège Claude (Claude Code), sans clé API.

## Ligne de commande

```bash
node cli.js signals S6
```

```bash
node cli.js report S6 --out rapport-S6.md
```

```bash
node cli.js report S5 --asOf 2026-09-24
```

Exemple de rapport généré : [docs/exemple-rapport-S6.md](docs/exemple-rapport-S6.md).

## Brancher de vraies données (Jira)

Adaptateur expérimental : [src/adapters/jira.js](src/adapters/jira.js).

```bash
JIRA_BASE_URL=https://<instance>.atlassian.net JIRA_EMAIL=... JIRA_API_TOKEN=... node cli.js import-jira --board 12 --out data/jira.json
```

```bash
SOBRUS_DATA_FILE=data/jira.json npm start
```

Conventions : drapeau *Impediment* = blocage ; étiquette `dependance:<nom>` = dépendance externe ; statut contenant *review / revue / QA / test* = en revue. Le feedback de Review, les actions de rétro et les absences ne sont pas dans Jira : les ajouter dans le JSON (champs `review`, `retro`, `absences` — voir [le format](docs/VISION.md#format-des-données)).

## Configuration

| Variable | Rôle | Défaut |
|----------|------|--------|
| `PORT` | Port HTTP | `4300` |
| `SOBRUS_DATA_FILE` | Jeu de données | `data/sobrus-demo.json` |
| `ANTHROPIC_API_KEY` | Active la couche IA générative | — |
| `SOBRUS_AI_MODEL` | Modèle Claude | `claude-opus-5-5` |
| `SOBRUS_AI_PSEUDONYMIZE` | Remplace les prénoms par « Membre A, B… » avant l'envoi | `true` |

## Tests

```bash
npm test
```

## Structure

```
data/generate.js        scénario de démo (6 sprints, signaux faibles construits)
src/engine/             OBSERVE → UNDERSTAND → THINK → PREPARE → LEARN
src/ai/claude.js        couche IA générative (Claude)
src/adapters/jira.js    import Jira Cloud
server.js / public/     API + interface web (sans framework, sans build)
cli.js                  rapports en ligne de commande
docs/VISION.md          vision, principes, architecture, feuille de route
```

Voir [docs/VISION.md](docs/VISION.md) pour la vision, les principes et la feuille de route de l'expérimentation.
