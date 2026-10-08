# Sobrus AI Copilot — Vision, principes et feuille de route

## 1. Intention

Construire, au sein de Sobrus et pour les projets Sobrus, un système capable :

1. **d'observer** un sprint en continu ;
2. **d'identifier des signaux faibles** avant qu'ils ne deviennent des problèmes ;
3. **de préparer** l'équipe pour chaque cérémonie et pour le sprint suivant ;
4. **d'apprendre** de sprint en sprint, et de rendre visible ce qui change dans la manière de travailler.

La question centrale n'est plus seulement *« Qu'avons-nous livré ? »* mais
*« Qu'est-ce qui est en train de changer dans notre manière de travailler ? »*

## 2. Principes non négociables

| Principe | Traduction dans le produit |
|----------|----------------------------|
| **L'IA assiste, l'humain décide** | Le Copilot produit des signaux, des hypothèses et des questions — jamais des décisions. Chaque recommandation est marquée « à valider par l'équipe ». |
| **Pas de surveillance individuelle** | Les signaux portent sur le système (flux, dépendances, charge). Un prénom n'apparaît que pour rendre une charge ou une absence actionnable, jamais pour évaluer une performance. Aucun classement de personnes. |
| **Explicabilité** | Chaque signal affiche ses preuves (tickets, dates, chiffres) et le détecteur qui l'a produit. Le moteur est déterministe et testé ; l'IA générative ne vient qu'après. |
| **L'essentiel d'abord** | Trois signaux prioritaires au maximum dans le titre. Un copilote qui alerte sur tout n'aide personne. |
| **Questions plutôt que verdicts** | Chaque signal est associé à une question à poser à l'équipe. |
| **Confidentialité** | Claude ne reçoit que l'analyse agrégée, avec des prénoms pseudonymisés par défaut. Les données brutes restent sur l'infrastructure Sobrus. |
| **Boucle de feedback** | Les 👍/👎 de l'équipe ajustent le poids des signaux : le Copilot apprend ce qui est utile *pour cette équipe*. |

## 3. Architecture

```
          Sources                      Moteur déterministe (src/engine)                    Sorties
┌──────────────────────┐   ┌──────────────────────────────────────────────────────┐   ┌────────────────────┐
│ Jira (adaptateur)     │   │ 01 OBSERVE    instantané à une date (rejouable)       │   │ Interface web       │
│ JSON (démo / enrichi) │──▶│ 02 UNDERSTAND 17 détecteurs → signaux + preuves       │──▶│ Rapport Markdown    │
│ Rétro, Review, congés │   │ 03 THINK      insights, lecture transverse, santé     │   │ CLI                 │
└──────────────────────┘   │ 04 PREPARE    Daily, Review, Rétro, Planning, risques │   │ API JSON            │
                           │ 05 LEARN      tendances, glissements, patterns        │   └────────────────────┘
                           └───────────────┬──────────────────────────────▲───────┘
                                           │ analyse agrégée               │ 👍/👎 (data/feedback.json)
                                           ▼ (pseudonymisée)               │
                           ┌──────────────────────────────────────┐       │
                           │ Couche IA générative (Claude)         │       │
                           │ rédaction, synthèse, approfondissement │───────┘
                           └──────────────────────────────────────┘
```

**Pourquoi un moteur déterministe sous l'IA ?** Parce que les signaux doivent être reproductibles, auditables et testables. Claude apporte la nuance, la synthèse et la qualité rédactionnelle ; il ne « découvre » pas les faits, il les reçoit avec leurs preuves.

## 4. Ce que le Copilot détecte (brique UNDERSTAND)

| Thème | Détecteurs |
|-------|-----------|
| Flux | tickets immobiles (blocage non dit), WIP élevé, livraison en fin de sprint, écart à la trajectoire |
| Dépendances | blocages actifs, temps perdu en blocage, goulot externe, **dépendance récurrente** (signal faible devenu structurel) |
| Périmètre | ajouts en cours de sprint, besoin instable (estimations / critères modifiés) |
| Prévisibilité | baisse de productivité (corrigée des congés et jours fériés), sur-engagement, **prévision Monte Carlo**, objectif menacé, tickets reportés / « zombies » |
| Qualité | tickets rouverts, part des bugs en hausse |
| Équipe | concentration de la charge, absences à venir avec du travail en cours, **signaux faibles dans le langage des commentaires** (attente, flou, pression, surcharge) |
| Amélioration continue | actions de rétro non réalisées, **actions récurrentes jamais appliquées** |
| Parties prenantes | inquiétude exprimée en Review |

## 5. Le scénario de démonstration

Le jeu de données fictif raconte une histoire réaliste en 6 sprints :

- **S1–S2** : équipe saine, fiabilité 100 %, aucun signal.
- **S3** : démarrage de l'intégration Tiers payant ; première apparition de la dépendance « API partenaire ».
- **S4** : urgences support (+17 %), besoin instable sur la feuille de soins, premier ticket rouvert.
- **S5** : la dépendance revient, la recette tombe, le WIP double, 88 % de la livraison en fin de sprint, fiabilité 34 %.
- **S6 (en cours)** : ticket « zombie » reporté pour la 2e fois, blocage partenaire, 75 % du travail restant sur une seule personne qui va absorber l'absence d'une collègue, probabilité de finir ≈ 7 %.

Le Copilot fait émerger la lecture LEARN : *« d'une équipe autonome à une équipe dépendante ; de finir à commencer ; un sprint de moins en moins protégé ; vers une mini-cascade ; une boucle d'amélioration qui s'essouffle »* — et l'action de rétro « Limiter le WIP à 2 » décidée trois fois sans jamais être appliquée.

## 6. Format des données

```jsonc
{
  "meta": { "product": "...", "team": "...", "referenceDate": "2026-10-08", "holidays": ["2026-07-30"] },
  "team": [{ "id": "yassine", "name": "Yassine", "role": "Dév back", "delivery": true }],
  "sprints": [{
    "id": "S6", "name": "Sprint 6", "status": "active|closed",
    "start": "2026-10-01", "end": "2026-10-14", "goal": "...",
    "absences": { "imane": ["2026-10-09"] },
    "issues": [{
      "key": "PHA-601", "title": "...", "type": "story|bug|task", "points": 5,
      "epic": "Tiers payant", "assignee": "yassine", "goal": true,
      "addedDate": "2026-10-01", "carriedOver": 0,
      "history":  [{ "date": "2026-10-01", "to": "in_progress|review|done|todo" }],
      "blocks":   [{ "from": "2026-10-02", "to": null, "reason": "...", "dependency": "API partenaire" }],
      "changes":  [{ "date": "...", "field": "points|acceptance", "from": 3, "to": 5 }],
      "comments": [{ "date": "...", "author": "yassine", "text": "..." }]
    }],
    "review": { "feedback": [{ "from": "Pharmacie pilote", "sentiment": "positive|neutral|negative", "text": "..." }] },
    "retro":  { "actions":  [{ "id": "A9", "text": "...", "owner": "hamza", "status": "done|in_progress|not_started" }] }
  }],
  "nextSprint": { "id": "S7", "start": "...", "end": "...", "absences": {} },
  "backlog": [{ "key": "PHA-701", "title": "...", "points": 13, "priority": 1, "acceptanceCriteria": true, "dependency": "...", "dependencyConfirmed": false }]
}
```

## 7. Feuille de route de l'expérimentation

| Phase | Durée | Contenu | Critère de passage |
|-------|-------|---------|--------------------|
| **0 — Prototype** (ce dépôt) | fait | Moteur 5 briques, démo, UI, IA générative, import Jira | Démonstration aux Scrum Masters / PO |
| **1 — Pilote 1 équipe** | 3 sprints | Import Jira réel, saisie rétro/Review dans le Copilot, usage en Daily, Review et Rétro | ≥ 60 % des signaux jugés utiles (👍) ; temps de préparation des cérémonies divisé par 2 |
| **2 — Calibration** | 3 sprints | Ajuster seuils et détecteurs avec l'équipe, nouveaux détecteurs (dépendances inter-équipes, revue de code, incidents prod) | Moins de 20 % de « bruit » (👎) |
| **3 — Multi-équipes** | 1 trimestre | Plusieurs squads Sobrus, vue portefeuille (dépendances entre équipes), intégration Slack/Teams (brief du Daily, alertes) | Adoption volontaire par ≥ 3 équipes |
| **4 — Mémoire organisationnelle** | continu | Base d'apprentissage inter-équipes : quelles expériences d'amélioration ont réellement fonctionné, et dans quel contexte | Au moins 5 expériences documentées avec effet mesuré |

### Indicateurs de succès de l'expérimentation

- Utilité perçue des signaux (taux de 👍) ;
- Signaux détectés **avant** qu'ils ne soient évoqués par l'équipe (anticipation) ;
- Temps de préparation des cérémonies ;
- Taux de réalisation des actions de rétrospective ;
- Évolution de la fiabilité de l'engagement (say/do) sur les équipes pilotes.

### Gouvernance

- Le Copilot est un outil **de l'équipe**, pas un outil de reporting managérial individuel.
- Les données d'une équipe ne sont partagées qu'avec son accord.
- Toute nouvelle règle de détection est revue avec un Scrum Master avant d'être activée.
