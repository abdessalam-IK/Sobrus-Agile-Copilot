// Vue multi-projets : charge de chaque développeur, tous projets Sobrus confondus.
//
// Règle (validée) : chaque projet garde sa propre capacité ; en plus, on additionne les estimations
// d'un développeur sur tous les projets où il intervient pendant le sprint en cours, et on signale
// une surcharge quand ce total dépasse ce qu'il peut raisonnablement absorber.

import { observeSprint } from './observe.js';
import { sum, round } from '../lib/stats.js';

/** Au-delà de ce ratio (charge estimée / charge absorbable), on parle de surcharge. */
export const OVERLOAD_RATIO = 1.2;

const pts = (i) => i.points || 0;

/**
 * @param datasets un jeu de données par équipe (sortie de la synchronisation Linear)
 * @returns la charge par développeur sur les sprints en cours, et le rythme de référence utilisé
 */
export function crossTeamLoad(datasets) {
  const actives = datasets
    .map((ds) => ({ ds, sprint: ds.sprints.find((s) => s.status === 'active') }))
    .filter((x) => x.sprint);
  if (!actives.length) return null;

  // Rythme de référence : points livrés par jour-personne sur les 3 derniers sprints terminés de chaque projet
  let refPoints = 0;
  let refDays = 0;
  for (const { ds } of actives) {
    for (const s of ds.sprints.filter((x) => x.status === 'closed').slice(-3)) {
      const o = observeSprint(ds, s.id);
      refPoints += o.metrics.donePoints;
      refDays += o.metrics.personDays;
    }
  }
  const rate = refDays ? refPoints / refDays : null;

  const devs = new Map();
  const projects = [];
  for (const { ds, sprint } of actives) {
    const o = observeSprint(ds, sprint.id);
    const product = ds.meta.product;
    projects.push({ team: ds.meta.teamKey, product, sprint: sprint.name, start: sprint.start, end: sprint.end });
    for (const c of o.capacity) {
      const mine = o.issues.filter((i) => i.assignee === c.member);
      const dev = devs.get(c.member) || { id: c.member, name: ds.team.find((m) => m.id === c.member)?.name || c.member, days: 0, projects: [] };
      dev.days = Math.max(dev.days, c.days); // même personne, mêmes absences : on ne cumule pas les jours
      dev.projects.push({
        team: ds.meta.teamKey,
        product,
        points: sum(mine, pts),
        remaining: sum(mine.filter((i) => !i.done), pts),
        tickets: mine.length,
        unestimated: mine.filter((i) => i.points == null).length,
      });
      devs.set(c.member, dev);
    }
  }

  const list = [...devs.values()].map((d) => {
    const total = sum(d.projects, (p) => p.points);
    const capacityPoints = rate ? rate * d.days : null;
    const ratio = capacityPoints ? total / capacityPoints : null;
    return {
      ...d,
      total,
      remaining: sum(d.projects, (p) => p.remaining),
      tickets: sum(d.projects, (p) => p.tickets),
      unestimated: sum(d.projects, (p) => p.unestimated),
      multiProject: d.projects.length > 1,
      capacityPoints: round(capacityPoints, 1),
      ratio: round(ratio, 2),
      overloaded: ratio != null && ratio > OVERLOAD_RATIO,
    };
  });

  return {
    rate: round(rate, 2),
    overloadRatio: OVERLOAD_RATIO,
    projects,
    devs: list.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)),
  };
}
