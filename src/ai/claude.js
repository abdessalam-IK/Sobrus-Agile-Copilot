// Couche IA générative (optionnelle) : Claude reformule et approfondit l'analyse déterministe.
// Le moteur (OBSERVE → LEARN) fonctionne sans IA ; Claude ajoute la lecture fine, la synthèse
// et la formulation. Il ne reçoit que des données agrégées, pseudonymisées par défaut.

const MODEL = process.env.SOBRUS_AI_MODEL || 'claude-opus-5-5';
const PSEUDONYMIZE = process.env.SOBRUS_AI_PSEUDONYMIZE !== 'false';

const SYSTEM = `Tu es « Sobrus AI Copilot », une couche d'intelligence autour du processus Agile des équipes produit de Sobrus (éditeur de logiciels de santé au Maroc).

Ton rôle : observer un sprint, relier des signaux faibles et préparer l'équipe. Tu ne remplaces ni le Scrum Master, ni le Product Owner, ni l'équipe : tu les aides à mieux voir et à mieux se poser des questions.

Principes :
- Appuie-toi uniquement sur les données JSON fournies. Cite les preuves (clés de tickets, chiffres, dates).
- Distingue clairement les faits, les hypothèses et les questions ouvertes.
- Ne désigne jamais de coupable individuel ; parle de système, de flux et de conditions de travail.
- Propose, n'impose pas : chaque recommandation est une option que l'équipe peut refuser.
- Privilégie l'essentiel : 3 points forts valent mieux que 10 points moyens.
- Écris en français professionnel, clair et chaleureux, au format Markdown, sans préambule.`;

const TASKS = {
  insights: 'Rédige la synthèse « Insights » du sprint : un paragraphe d’ouverture (« Ce sprint présente N signaux… »), puis pour chaque signal majeur : ce qu’on observe (faits), ce que cela pourrait signifier (hypothèses), et la question à poser à l’équipe. Termine par la lecture transverse : ce que ces signaux racontent ensemble.',
  daily: 'Prépare une note de 5 lignes maximum pour le Scrum Master avant le Daily : ce qui a bougé, ce qui menace l’objectif, et 2 questions à poser. Le Daily doit rester centré sur l’objectif du sprint.',
  review: 'Prépare le déroulé de la Sprint Review (45 min) : messages clés, ordre de démo, manière d’annoncer ce qui n’est pas livré sans langue de bois, et questions à poser aux parties prenantes.',
  retro: 'Prépare la rétrospective : format recommandé et pourquoi, déroulé minuté (60 min), données à montrer, questions puissantes, et 2 expériences d’amélioration SMART possibles. Rappelle le suivi des actions précédentes.',
  planning: 'Prépare le prochain Sprint Planning : capacité, fourchette d’engagement réaliste, éléments à challenger avec la raison, préconditions, et une proposition d’objectif de sprint. Sois explicite sur les risques de sur-engagement.',
  learn: 'Analyse l’évolution sur plusieurs sprints : qu’est-ce qui est en train de changer dans la manière de travailler de l’équipe ? Identifie les dynamiques (causes probables, boucles de renforcement), ce qui s’améliore, et ce que l’équipe devrait observer dans les prochains sprints.',
};

function payloadFor(kind, analysis) {
  const { observe: o, think: t, prepare: p, learn: l } = analysis;
  const base = {
    sprint: o.sprint,
    asOf: o.asOf,
    closed: o.closed,
    day: `${o.dayIndex}/${o.totalDays}`,
    metrics: o.metrics,
    forecast: o.forecast || null,
    headline: t.headline,
    health: t.health,
  };
  const signals = t.signals.map(({ type, theme, severity, title, narrative, evidence, question, hypotheses }) => ({ type, theme, severity, title, narrative, evidence, question, hypotheses }));
  switch (kind) {
    case 'insights': return { ...base, signals, crossReadings: t.crossReadings, recommendations: t.recommendations };
    case 'daily': return { ...base, daily: p.daily };
    case 'review': return { ...base, review: p.review, insights: t.insights.map((i) => ({ label: i.label, headline: i.headline, level: i.level.label })) };
    case 'retro': return { ...base, retro: p.retro, signals, crossReadings: t.crossReadings };
    case 'planning': return { ...base, planning: p.planning, risks: p.risks, patterns: l.patterns };
    case 'learn': return { sprint: o.sprint, learn: { headline: l.headline, series: l.series, trend: l.trend, shifts: l.shifts, patterns: l.patterns, dominant: l.dominant } };
    default: throw new Error(`Type de préparation inconnu : ${kind}`);
  }
}

function pseudonymizer(team) {
  const pairs = team.map((m, i) => [m.name, `Membre ${String.fromCharCode(65 + i)}`]);
  const swap = (text, from, to) => pairs.reduce((s, p) => s.replaceAll(p[from], p[to]), text);
  return { hide: (s) => swap(s, 0, 1), reveal: (s) => swap(s, 1, 0) };
}

export const AI_KINDS = Object.keys(TASKS);

export async function generate(kind, analysis, dataset) {
  if (!TASKS[kind]) throw new Error(`Type de préparation inconnu : ${kind}`);
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw Object.assign(new Error('SDK Anthropic non installé : exécutez « npm install ».'), { status: 503 });
  }
  const privacy = PSEUDONYMIZE ? pseudonymizer(dataset.team) : { hide: (s) => s, reveal: (s) => s };
  const data = privacy.hide(JSON.stringify(payloadFor(kind, analysis), null, 1));

  const client = new Anthropic();
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `${TASKS[kind]}\n\n<donnees_sprint>\n${data}\n</donnees_sprint>` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || /api key|credentials|auth/i.test(err.message)) {
      throw Object.assign(new Error('Aucune clé API Anthropic valide : définissez ANTHROPIC_API_KEY avant de lancer le serveur.'), { status: 503 });
    }
    if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Limite de requêtes atteinte, réessayez dans un instant.'), { status: 429 });
    if (err instanceof Anthropic.APIError) throw Object.assign(new Error(`Erreur de l’API Claude (${err.status}) : ${err.message}`), { status: 502 });
    throw err;
  }
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new Error('La génération a été refusée par le modèle.'), { status: 422 });
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { kind, model: response.model, markdown: privacy.reveal(text), pseudonymized: PSEUDONYMIZE };
}

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
export const aiModel = MODEL;
