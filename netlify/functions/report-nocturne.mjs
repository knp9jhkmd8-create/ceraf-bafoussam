// ============================================================================
//  Report nocturne des interventions non résolues
//
//  Remplace le déclencheur Apps Script de 1h du matin. Une intervention encore
//  ouverte à la fin d'une journée passe au jour ouvré suivant ; les « Réalisé »
//  sont figées.
//
//  Toute la logique métier vit dans la fonction SQL `reporter_interventions()`
//  (voir db/report-nocturne.sql) : elle est ATOMIQUE et IDEMPOTENTE. Cette
//  fonction planifiée ne fait que la déclencher — c'est aussi pour ça que le
//  filet de sécurité dans api.mjs peut l'appeler sans précaution particulière.
//
//  ⚠️ Les fonctions planifiées Netlify ne tournent QUE sur un déploiement
//  publié — jamais sur une préversion.
// ============================================================================

async function sql(requete) {
  const conn = Netlify.env.get('DATABASE_URL');
  if (!conn) throw new Error('DATABASE_URL absent de la configuration');
  const hote = conn.replace(/^.*@([^/]+)\/.*$/, '$1');
  const rep = await fetch(`https://${hote}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': conn },
    body: JSON.stringify({ query: requete, params: [] })
  });
  if (!rep.ok) throw new Error('SQL: ' + (await rep.text()).slice(0, 300));
  return (await rep.json()).rows || [];
}

export default async () => {
  const t0 = Date.now();
  try {
    const [r] = await sql('SELECT * FROM reporter_interventions()');
    const n = r ? Number(r.reportees) : 0;
    console.log(`[report] ${n} intervention(s) reportée(s)`
      + (r && r.vers ? ` vers le ${String(r.vers).slice(0, 10)}` : '')
      + ` en ${Date.now() - t0} ms`);
  } catch (e) {
    // On journalise et on laisse remonter : un report silencieusement raté
    // ferait disparaître les interventions en attente de la fiche du jour, et
    // personne ne s'en apercevrait avant que le terrain ne le signale.
    console.error('[report] ECHEC —', e.message);
    throw e;
  }
};

// 00:00 UTC = 1h du matin au Cameroun (UTC+1), même horaire que l'ancien
// déclencheur Apps Script.
export const config = { schedule: '0 0 * * *' };
