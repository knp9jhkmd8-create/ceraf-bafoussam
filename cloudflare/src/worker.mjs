// ============================================================================
//  CERAF Bafoussam — Worker Cloudflare
//
//  Un seul Worker sert les DEUX besoins :
//    - `fetch`     : l'API (contrat inchangé, `{action, token, actingRole, …}`)
//    - `scheduled` : le report nocturne des interventions non résolues
//
//  Toute la logique vit dans `api/core.mjs`, partagé avec l'adaptateur Netlify.
//  Ce fichier ne fait que brancher l'environnement et traduire les conventions
//  de la plateforme — c'est ce qui évite deux copies divergentes de 800 lignes.
//
//  Le code du cœur n'utilise QUE des APIs du Web (fetch, crypto.subtle,
//  crypto.randomUUID, TextEncoder) : rien à adapter pour tourner sur l'isolat
//  V8 des Workers, qui n'a pas Node.
// ============================================================================

import { configurerEnv, traiterRequete, reporterNocturne, sauvegarderNocturne } from '../../api/core.mjs';

export default {
  async fetch(request, env, ctx) {
    configurerEnv(env);
    // Cloudflare transmet l'IP réelle du client dans cet en-tête ; Netlify
    // utilise le sien. Le cœur ne connaît ni l'un ni l'autre.
    const ip = request.headers.get('CF-Connecting-IP');
    return traiterRequete(request, { ip });
  },

  // Déclenché par les Cron Triggers déclarés dans wrangler.toml.
  // On laisse l'erreur remonter : un report silencieusement raté amputerait la
  // fiche du jour de tout l'arriéré, et personne ne s'en apercevrait avant que
  // le terrain ne le signale. Une exception ici est visible dans les logs et
  // dans les métriques du Worker.
  async scheduled(event, env, ctx) {
    configurerEnv(env);
    ctx.waitUntil(taches());
  }
};

// Le report d'abord, la sauvegarde ensuite : la copie reflète ainsi l'état que
// l'équipe verra le matin, arriéré reporté compris.
//
// Une sauvegarde en échec ne doit PAS empêcher le report, qui est la tâche
// métier : sans lui, la fiche du jour serait amputée de tout l'arriéré et
// personne ne s'en apercevrait avant que le terrain ne le signale. L'inverse
// n'est pas vrai — d'où le try/catch d'un seul côté.
async function taches() {
  await reporterNocturne();
  try {
    await sauvegarderNocturne();
  } catch (e) {
    console.error('[sauvegarde] échec —', e.message);
  }
}
