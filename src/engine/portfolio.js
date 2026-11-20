// Charge de chaque développeur sur le sprint, tous projets Sobrus confondus, EN HEURES.
//
// Règle (validée) :
//   heures estimées     = somme des estimations de ses tickets du sprint, sur tous les projets (1 point = 1 h)
//   heures disponibles  = présence sur le sprint (jours ouvrés × 8 h, congés et fériés déduits) − heures de réunion
//   occupation          = heures estimées / heures disponibles ; surcharge au-delà de 100 %
// Le nombre de tickets ne compte pas : 20 petits tickets qui tiennent dans les heures du sprint = charge normale.

import { observeSprint, HOURS_PER_DAY, HOURS_PER_POINT } from './observe.js';
import { sum, round } from '../lib/stats.js';

/** Au-delà de ce taux d'occupation (heures estimées / heures de développement disponibles), on parle de surcharge. */
export const OVERLOAD_RATIO = Number(process.env.OVERLOAD_RATIO || 1);

const pts = (i) => i.points || 0;

/**
 * @param datasets un jeu de données par équipe (sortie de la synchronisation Linear)
 * @returns la charge en heures par développeur sur les sprints en cours
 */
export function crossTeamLoad(datasets) {
  const actives = datasets
    .map((ds) => ({ ds, sprint: ds.sprints.find((s) => s.status === 'active') }))
    .filter((x) => x.sprint);
  if (!actives.length) return null;

  // 1. Les développeurs : les membres de chaque équipe, avec leurs heures disponibles sur le sprint de leur équipe
  const devs = new Map();
  const projects = [];
  const snaps = actives.map(({ ds, sprint }) => ({ ds, sprint, o: observeSprint(ds, sprint.id) }));
  for (const { ds, sprint, o } of snaps) {
    projects.push({ team: ds.meta.teamKey, product: ds.meta.product, sprint: sprint.name, start: sprint.start, end: sprint.end });
    for (const l of o.load.filter((x) => !x.outside)) {
      const dev = devs.get(l.member) || { id: l.member, name: ds.team.find((m) => m.id === l.member)?.name || l.member, home: [], projects: [], presenceHours: 0, meetingHours: null, devHours: 0 };
      // Même personne, même calendrier : on garde le plus grand nombre d'heures disponibles, sans cumuler
      if (l.devHours >= dev.devHours) Object.assign(dev, { presenceHours: l.presenceHours, meetingHours: l.meetingHours, devHours: l.devHours, days: l.capacityDays });
      dev.home.push(ds.meta.product);
      devs.set(l.member, dev);
    }
  }
  // 2. Leurs heures estimées : leurs tickets dans leur équipe ET leurs interventions sur les autres projets
  for (const { ds, o } of snaps) {
    for (const dev of devs.values()) {
      const mine = o.issues.filter((i) => i.assignee === dev.id);
      if (!mine.length && !dev.home.includes(ds.meta.product)) continue;
      dev.projects.push({
        team: ds.meta.teamKey,
        product: ds.meta.product,
        intervention: !dev.home.includes(ds.meta.product),
        points: sum(mine, pts),
        hours: sum(mine, pts) * HOURS_PER_POINT,
        remaining: sum(mine.filter((i) => !i.done), pts),
        tickets: mine.length,
        unestimated: mine.filter((i) => i.points == null).length,
      });
    }
  }

  const list = [...devs.values()].map((d) => {
    const plannedHours = sum(d.projects, (p) => p.hours);
    const ratio = d.devHours ? plannedHours / d.devHours : null;
    return {
      ...d,
      total: sum(d.projects, (p) => p.points),
      plannedHours,
      remaining: sum(d.projects, (p) => p.remaining),
      tickets: sum(d.projects, (p) => p.tickets),
      unestimated: sum(d.projects, (p) => p.unestimated),
      multiProject: d.projects.length > 1,
      ratio: round(ratio, 2),
      overloaded: ratio != null && ratio > OVERLOAD_RATIO,
    };
  });

  return {
    hoursPerDay: HOURS_PER_DAY,
    hoursPerPoint: HOURS_PER_POINT,
    overloadRatio: OVERLOAD_RATIO,
    projects,
    devs: list.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)),
  };
}
