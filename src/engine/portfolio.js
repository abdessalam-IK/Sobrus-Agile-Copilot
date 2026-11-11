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

  // Rythme de référence : points livrés par les membres des équipes, rapportés à leurs jours disponibles,
  // sur les 3 derniers sprints terminés de chaque projet. Les tickets livrés par des intervenants extérieurs
  // ne comptent pas : ils gonfleraient le rythme d'un développeur.
  let refPoints = 0;
  let refDays = 0;
  for (const { ds } of actives) {
    for (const s of ds.sprints.filter((x) => x.status === 'closed').slice(-3)) {
      const o = observeSprint(ds, s.id);
      const members = new Set(o.capacity.map((c) => c.member));
      refPoints += sum(o.issues.filter((i) => i.done && members.has(i.assignee)), pts);
      refDays += o.metrics.personDays;
    }
  }
  const rate = refDays ? refPoints / refDays : null;

  // 1. Les développeurs : les membres de chaque équipe (un développeur appartient à son équipe)
  const devs = new Map();
  const projects = [];
  const snaps = actives.map(({ ds, sprint }) => ({ ds, sprint, o: observeSprint(ds, sprint.id) }));
  for (const { ds, sprint, o } of snaps) {
    projects.push({ team: ds.meta.teamKey, product: ds.meta.product, sprint: sprint.name, start: sprint.start, end: sprint.end });
    for (const c of o.capacity) {
      const dev = devs.get(c.member) || { id: c.member, name: ds.team.find((m) => m.id === c.member)?.name || c.member, days: 0, home: [], projects: [] };
      dev.days = Math.max(dev.days, c.days); // même personne, mêmes absences : on ne cumule pas les jours
      dev.home.push(ds.meta.product);
      devs.set(c.member, dev);
    }
  }
  // 2. Leur charge : leurs tickets dans leur équipe ET leurs interventions sur les autres projets
  for (const { ds, o } of snaps) {
    for (const dev of devs.values()) {
      const mine = o.issues.filter((i) => i.assignee === dev.id);
      if (!mine.length && !dev.home.includes(ds.meta.product)) continue;
      dev.projects.push({
        team: ds.meta.teamKey,
        product: ds.meta.product,
        intervention: !dev.home.includes(ds.meta.product),
        points: sum(mine, pts),
        remaining: sum(mine.filter((i) => !i.done), pts),
        tickets: mine.length,
        unestimated: mine.filter((i) => i.points == null).length,
      });
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
