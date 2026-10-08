# Sobrus AI Copilot — Sprint 6
*Objectif : Ouvrir le tiers payant à 3 pharmacies pilotes* — En cours (jour 6/10, au 2026-10-08)

> Sprint 6 présente trois signaux nécessitant une attention particulière : objectif du sprint menacé : 4/6 éléments clés non terminés ; 1 ticket bloqué en ce moment (dont 1 par une dépendance externe) ; 75 % du travail restant repose sur une seule personne (Yassine). 2 autres points à surveiller.

**Santé du sprint : 24/100 (En difficulté)**

## Chiffres clés
- Points terminés : 25/53 (47 %)
- Objectif : 2/6 éléments clés terminés
- Ajouts en cours de sprint : +2 pts · Jours-ticket bloqués : 5 · Tickets rouverts : 0
- Probabilité de terminer le périmètre : 7 % (~13 pts attendus sur 28 restants)

## Insights
### Prévisibilité — Critique
« Ouvrir le tiers payant à 3 pharmacies pilotes » dépend d’éléments encore ouverts, dont certains bloqués. Il reste 28 points pour 4 jours ouvrés. Au rythme observé, l’équipe devrait livrer ~13 points (fourchette 5–22). 51 points engagés pour une capacité estimée à ~33 points (vélocité récente × jours disponibles). 16 points viennent de sprints précédents. Un report répété signale souvent un ticket trop gros, mal compris ou bloqué.
- **Objectif du sprint menacé : 4/6 éléments clés non terminés** — PHA-401 — En cours — Feuille de soins électronique ; PHA-601 — En cours (bloqué) — Passage en production de l’API partenaire ; PHA-602 — En revue — Paramétrage des 3 pharmacies pilotes
- **Probabilité de terminer le périmètre : 7 %** — Simulation Monte Carlo (3000 tirages) sur le débit quotidien historique, corrigé de la capacité restante
- **Engagement 55 % au-dessus de la capacité observée** — Capacité : 46 jours-personne ; Vélocité récente : 0.72 pt/j-p
- **1 ticket « zombie » reporté(s) depuis 2 sprints ou plus** — PHA-401 — reporté 2 fois — En cours — Feuille de soins électronique ; PHA-503 — reporté 1 fois — Terminé — Règles de prise en charge des mutuelles privées
- *Question à poser :* Pouvons-nous encore atteindre l’objectif, éventuellement sous une forme réduite ?

### Dépendances & blocages — Critique
Des tickets liés à l’objectif du sprint sont bloqués depuis 5 jours au plus. Ce n’est plus un incident ponctuel : « API partenaire Tiers Payant » a déjà bloqué l’équipe en Sprint 3, Sprint 5. « API partenaire Tiers Payant » bloque 1 ticket (5 jours-ticket) : l’avancement dépend d’un acteur hors de l’équipe.
- **1 ticket bloqué en ce moment (dont 1 par une dépendance externe)** — PHA-601 — bloqué depuis 5 j : Certificat de production non délivré par le partenaire [API partenaire Tiers Payant]
- **« API partenaire Tiers Payant » bloque l’équipe pour le 3e sprint** — Sprint 3 : PHA-301, PHA-302 ; Sprint 5 : PHA-501
- **Goulot externe : « API partenaire Tiers Payant »** — PHA-601
- *Question à poser :* Quelle est la prochaine action concrète pour lever chaque blocage, et qui la porte ?

### Équipe & charge — Critique
Yassine porte 21 des 28 points restants : risque de goulot et de surcharge, et faible partage de connaissance. 4 commentaires expriment attente (4). Ce ton n’apparaît pas forcément dans les statuts. Imane sera absent(e) 4 jours et porte encore 3 points.
- **75 % du travail restant repose sur une seule personne (Yassine)** — Yassine : 21 pts restants, 5 en cours ; Salma : 2 pts restants, 1 en cours ; Omar : 0 pts restants, 0 en cours
- **Signaux faibles dans les commentaires : attente** — PHA-401 · 2026-10-06 · « Toujours pas clair pour l’ancien format, en attente de Nadia » ; PHA-601 · 2026-10-05 · « On attend toujours le certificat de prod » ; PHA-601 · 2026-10-07 · « Relancé, pas de date annoncée par le partenaire »
- **Absence à venir avec du travail non terminé** — PHA-603 (Imane) — À faire
- *Question à poser :* Qui pourrait reprendre ou faire en binôme une partie des tickets de Yassine ?

### Amélioration continue — Critique
La même décision revient de rétro en rétro sans être appliquée : la rétrospective risque de perdre sa crédibilité.
- **Action de rétro récurrente jamais réalisée : « Limiter le WIP à 2 tickets par personne »** — « Escalader les blocages partenaires sous 24h » — en cours ; « Limiter le WIP à 2 tickets par personne » — non démarrée (récurrente) ; « Stabiliser l’environnement de recette » — en cours
- *Question à poser :* Pourquoi cette action n’a-t-elle pas été mise en œuvre ? Est-elle trop vague, sans responsable, ou pas prioritaire ?

### Flux de travail — Critique
2 tickets n’ont pas changé de statut depuis plusieurs jours sans être déclaré bloqué : c’est souvent un blocage non dit. L’équipe commence plus qu’elle ne finit (WIP moyen historique : 4.9). Le multitâche allonge le cycle time et retarde la valeur.
- **2 tickets immobiles (jusqu’à 5 jours sans mouvement)** — PHA-401 — En cours depuis 5 j (yassine) ; PHA-602 — En revue depuis 3 j (yassine)
- **Travail en cours élevé : 7 tickets en parallèle pour 5 personnes** — Yassine : 5 tickets en cours
- *Question à poser :* Qu’est-ce qui empêche réellement ces tickets d’avancer ? Qui peut aider aujourd’hui ?

## Lecture transverse
- La dépendance externe n’est plus un incident : elle pilote désormais la capacité de l’équipe à tenir ses objectifs.
- Beaucoup de travail commencé, peu de travail fini : l’équipe semble compenser les blocages en ouvrant de nouveaux sujets, ce qui allonge tous les délais.
- La charge est concentrée alors qu’une absence approche : le risque porte sur les personnes autant que sur le planning.

## Recommandations (à valider par l’équipe)
- Re-focaliser toute l’équipe sur les éléments de l’objectif (swarming) avant tout nouveau démarrage. *(Équipe — parce que : Objectif du sprint menacé : 4/6 éléments clés non terminés)*
- Nommer un responsable et une échéance pour chaque blocage ; escalader au-delà de 48h. *(Scrum Master — parce que : 1 ticket bloqué en ce moment (dont 1 par une dépendance externe))*
- Négocier dès maintenant avec le PO ce qui sort du sprint, plutôt que de le constater à la Review. *(Product Owner + Équipe — parce que : Probabilité de terminer le périmètre : 7 %)*
- Traiter « API partenaire Tiers Payant » comme un risque produit : le porter au niveau management et ne plus planifier de ticket dépendant sans confirmation écrite. *(Product Owner + Management — parce que : « API partenaire Tiers Payant » bloque l’équipe pour le 3e sprint)*
- Organiser du pairing sur les sujets critiques pour répartir la charge et la connaissance. *(Équipe — parce que : 75 % du travail restant repose sur une seule personne (Yassine))*
- Limiter la rétro à 1–2 actions SMART, inscrites dans le Sprint Backlog avec un responsable. *(Scrum Master — parce que : Action de rétro récurrente jamais réalisée : « Limiter le WIP à 2 tickets par personne »)*

## Risques
- Objectif du sprint menacé : 4/6 éléments clés non terminés — probabilité Élevée, impact Fort. Mitigation : Re-focaliser toute l’équipe sur les éléments de l’objectif (swarming) avant tout nouveau démarrage.
- 1 ticket bloqué en ce moment (dont 1 par une dépendance externe) — probabilité Élevée, impact Modéré. Mitigation : Nommer un responsable et une échéance pour chaque blocage ; escalader au-delà de 48h.
- Probabilité de terminer le périmètre : 7 % — probabilité Élevée, impact Modéré. Mitigation : Négocier dès maintenant avec le PO ce qui sort du sprint, plutôt que de le constater à la Review.
- « API partenaire Tiers Payant » bloque l’équipe pour le 3e sprint — probabilité Élevée, impact Modéré. Mitigation : Traiter « API partenaire Tiers Payant » comme un risque produit : le porter au niveau management et ne plus planifier de ticket dépendant sans confirmation écrite.
- 75 % du travail restant repose sur une seule personne (Yassine) — probabilité Élevée, impact Modéré. Mitigation : Organiser du pairing sur les sujets critiques pour répartir la charge et la connaissance.
- Engagement 55 % au-dessus de la capacité observée — probabilité Moyenne, impact Modéré. Mitigation : Au Planning, afficher la capacité calculée avant de sélectionner les tickets.

## Ce qui change dans notre manière de travailler
Sur les 4 derniers sprints, la manière de travailler évolue : d’une équipe autonome à une équipe dépendante ; de « finir » à « commencer » ; un sprint de moins en moins protégé ; vers une mini-cascade ; une boucle d’amélioration qui s’essouffle.
- **D’une équipe autonome à une équipe dépendante** : La baisse de livraison suit la hausse du temps bloqué : la capacité de l’équipe est de plus en plus pilotée par des acteurs externes.
- **De « finir » à « commencer »** : Le travail en parallèle augmente et chaque ticket met plus de temps à aboutir : l’équipe absorbe la pression en multipliant les sujets ouverts.
- **Un sprint de moins en moins protégé** : Les ajouts en cours de sprint progressent : le Sprint Backlog devient une liste de départ plutôt qu’un engagement.
- **Vers une mini-cascade** : La livraison se concentre de plus en plus en fin de sprint : le feedback arrive tard et la qualité sert de tampon.
- **Une boucle d’amélioration qui s’essouffle** : De moins en moins d’actions de rétro sont réalisées : l’équipe identifie les problèmes mais ne parvient plus à les traiter.
- « API partenaire Tiers Payant » bloque l’équipe de façon récurrente — Présent dans 3 sprints : Sprint 3, Sprint 5, Sprint 6.
- Action de rétro récurrente : « Limiter le WIP à 2 tickets par personne » — Décidée 3 fois (Sprint 3, Sprint 4, Sprint 5), jamais réalisée.
- Ajouts en cours de sprint récurrents — 2 sprints sur 5 ont reçu plus de 10 % d’ajouts (Sprint 4, Sprint 5).
- PHA-401 traverse les sprints sans aboutir — « Feuille de soins électronique » a été reporté 2 fois.

## Prochain Sprint Planning
- Capacité Sprint 7 : 46 jours-personne
- Fourchette réaliste : 29–33 pts, engagement suggéré ≈ 26 pts (buffer urgences 5 pts)
- À challenger : PHA-401 Feuille de soins électronique — Taille importante : envisager un découpage ; Déjà reporté 3 fois : la valeur et le découpage sont-ils toujours pertinents ?
- À challenger : PHA-601 Passage en production de l’API partenaire — Dépend de « API partenaire Tiers Payant » sans confirmation — dépendance déjà problématique ; Déjà reporté 1 fois : la valeur et le découpage sont-ils toujours pertinents ?
- À challenger : PHA-701 Télétransmission des feuilles de soins AMO — Trop gros pour un sprint : à découper ; Dépend de « API partenaire Tiers Payant » sans confirmation — dépendance déjà problématique
- À challenger : PHA-702 Gestion des rejets AMO — Taille importante : envisager un découpage ; Critères d’acceptation absents (Definition of Ready) ; Dépend de « API partenaire Tiers Payant » sans confirmation — dépendance déjà problématique
- À challenger : PHA-704 Refonte de l’écran d’inventaire mobile — Non estimé ; Critères d’acceptation absents (Definition of Ready)
- À challenger : PHA-706 Paramétrage des mutuelles privées (vague 2) — Taille importante : envisager un découpage ; Critères d’acceptation absents (Definition of Ready) ; Règles de prise en charge à confirmer avec les mutuelles

---
*Généré par Sobrus AI Copilot. Ces éléments sont des observations et des hypothèses destinées à nourrir la discussion de l’équipe ; ils ne remplacent ni le jugement du Scrum Master, ni celui du Product Owner, ni celui de l’équipe.*