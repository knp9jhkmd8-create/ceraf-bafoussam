# API sur Cloudflare Workers

Portage préparé le 2026-08-06, **pas encore déployé**.

## Pourquoi Cloudflare plutôt que Netlify

Ce n'est pas une question de performance — le coût dominant reste l'aller-retour
Cameroun → Europe pour interroger Neon (Londres), et il ne change pas. Les
raisons sont opérationnelles :

1. **Pas de « crédits de build ».** Le 2026-08-06, tous les déploiements Netlify
   ont été bloqués par *« your team has used all of its available credits for
   this billing cycle »*. Les Workers ont un quota en **requêtes**
   (100 000/jour en gratuit), sans commune mesure avec les besoins d'une équipe
   de six personnes.
2. **Cron Triggers inclus et gratuits.** C'est ce qui permet d'installer le
   report nocturne sans dépendre ni de `pg_cron` (activation console requise)
   ni d'un bridge Apps Script.
3. Le code n'utilise **que des APIs du Web** (`fetch`, `crypto.subtle`,
   `crypto.randomUUID`, `TextEncoder`) — rien de Node. Il tourne tel quel sur
   l'isolat V8 des Workers.

## Architecture

```
api/core.mjs                    ← TOUTE la logique, agnostique de l'hébergeur
cloudflare/src/worker.mjs       ← adaptateur Cloudflare (fetch + scheduled)
netlify/functions/api.mjs       ← adaptateur Netlify
netlify/functions/report-nocturne.mjs
```

Les adaptateurs ne font que **brancher la configuration** et traduire les
conventions de plateforme (l'en-tête portant l'IP client diffère). C'est ce qui
évite deux copies divergentes de 800 lignes.

Sur Cloudflare, **un seul Worker** sert l'API (`fetch`) et le report nocturne
(`scheduled`) — un seul objet à déployer et surveiller.

## Déploiement

Prérequis : un compte Cloudflare et `wrangler` (`npm i -g wrangler`, ou `npx wrangler`).

```bash
cd cloudflare
wrangler login

# La chaîne de connexion Neon est un SECRET : elle ne doit jamais entrer dans
# wrangler.toml, qui est versionné dans un dépôt PUBLIC.
wrangler secret put DATABASE_URL      # coller la chaîne, elle n'apparaît pas à l'écran

wrangler deploy
```

L'URL obtenue est de la forme `https://ceraf-bafoussam-api.<compte>.workers.dev`.

## Après le déploiement — dans cet ordre

1. **Vérifier l'API** avant de basculer quoi que ce soit :
   ```bash
   node tests/test-api-live.mjs https://<nouvelle-url>
   ```
   Attendu : 17/17. Le harnais restaure tout ce qu'il modifie.

2. **Vérifier le report nocturne** sans attendre 1h du matin :
   ```bash
   wrangler dev --test-scheduled
   curl "http://localhost:8787/__scheduled?cron=0+0+*+*+*"
   ```
   La fonction SQL est **idempotente** : la déclencher hors saison ne fait rien
   s'il n'y a aucun arriéré. Pour un vrai test, utiliser une **branche Neon**
   avec des interventions ouvertes datées d'hier (voir `db/report-nocturne.sql`).

3. **Mettre à jour `API_URL` dans `index.html`** avec la nouvelle URL, bumper
   `CACHE_VERSION` dans `sw.js`, publier. Sans le bump, les téléphones gardent
   l'ancienne version en cache et **rien n'arrive**.

4. Ne retirer Netlify qu'après une semaine sans incident.

## Pièges à connaître

- **`compatibility_flags = ["nodejs_compat"]`** est nécessaire dans
  `wrangler.toml` : sans lui, certaines APIs Web ne sont pas exposées à
  l'isolat.
- Les Cron Triggers ne tournent **que sur la version déployée**, jamais en
  `wrangler dev` sans `--test-scheduled`.
- Ne PAS déplacer le frontend sur Cloudflare Pages : ça changerait l'URL de la
  PWA déjà installée sur les téléphones et casserait l'installation de chacun.
  GitHub Pages reste le bon choix.
