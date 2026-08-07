// Adaptateur Netlify du report nocturne — la logique vit dans api/core.mjs.
//
// ⚠️ Les fonctions planifiées Netlify ne tournent QUE sur un déploiement
// publié, jamais sur une préversion.
import { configurerEnv, reporterNocturne } from '../../api/core.mjs';

export default async () => {
  configurerEnv({ DATABASE_URL: Netlify.env.get('DATABASE_URL') });
  try {
    await reporterNocturne();
  } catch (e) {
    // On laisse remonter : un report silencieusement raté ferait disparaître
    // les interventions en attente de la fiche du jour, et personne ne s'en
    // apercevrait avant que le terrain ne le signale.
    console.error('[report] ECHEC —', e.message);
    throw e;
  }
};

// 23:00 UTC = 00h00 au Cameroun (UTC+1) : le report se fait au changement
// de jour. Les crons Netlify sont aussi exprimes en UTC.
export const config = { schedule: '0 23 * * *' };
