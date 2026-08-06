# Tests

Il n'y a ni build, ni CI, ni environnement de préproduction sur ce projet : le
déploiement live **est** la production. Ces scripts sont le premier filet
automatisé — ils tournent avec node seul, sans dépendance à installer.

```bash
# Backend Apps Script (l'ancien)
node tests/test-auth.js
node tests/check-inline-js.js index.html

# API Neon/Netlify (le nouveau) — la chaîne de connexion est passée en
# ARGUMENT, jamais écrite dans le dépôt.
node tests/test-api-lectures.mjs  <fichier-conn> file:///<chemin>/netlify/functions/api.mjs
node tests/test-api-ecritures.mjs <fichier-conn> file:///<chemin>/netlify/functions/api.mjs
node tests/test-api-live.mjs      https://ceraf-bafoussam-api.netlify.app/api
```

⚠️ **Ne jamais tuyauter ces tests vers `head`** : le SIGPIPE interrompt le
script avant son nettoyage final, et il laisse alors des données de test en
base (PIN modifié, interventions fictives). Rediriger vers un fichier.

## `test-auth.js`

Charge le **vrai** `Code.gs` dans un contexte `vm` avec des stubs Apps Script
minimaux (`Utilities`, feuille simulée), puis rejoue les scénarios d'auth sur
les fonctions réelles — pas sur une copie qui pourrait diverger.

Couvre notamment l'incident du 2026-08-06 (boucle de réinitialisation du PIN) :
compte au PIN par défaut avec et sans `currentPin`, format de hash hérité sans
sel, compte à PIN personnel où `currentPin` reste obligatoire, mauvais
`currentPin`, rejeu du même PIN, validation de format.

Détail à connaître si tu ajoutes des cas : les `const` de `Code.gs` (comme
`PIN_SALT`) ne sont **pas** exposés sur l'objet global d'un contexte `vm`,
contrairement aux `function`. Pour y accéder, passer par
`vm.runInContext('PIN_SALT', ctx)`.

## `check-inline-js.js`

`index.html` embarque ~3000 lignes de JS inline sans aucune étape de build :
une erreur de syntaxe ne se manifeste que sur le téléphone du technicien.
Ce script extrait chaque bloc `<script>` et le passe au parseur avant
publication.

À lancer systématiquement avant un `git push` touchant `index.html`.

## `test-api-lectures.mjs` / `test-api-ecritures.mjs`

Chargent la vraie fonction `netlify/functions/api.mjs` avec un stub de l'objet
global `Netlify`, et la font tourner **contre la vraie base**. 80 assertions au
total : verrou `mustChangePin`, sessions et révocation, contrôle des rôles,
comptes clients exacts, dédoublonnage mensuel, idempotence de `saveConsistance`
et d'`updateStatus`, reclassement de service, suppression = archivage,
administration des utilisateurs, onglet Audit.

Les deux harnais **restaurent tout ce qu'ils modifient** et vérifient en fin de
parcours qu'ils n'ont laissé aucune fiche résiduelle.

## `test-api-live.mjs`

Même principe mais contre l'API **déployée**, en HTTP. Mesure aussi la latence
client et la sépare du temps serveur (`_ms` renvoyé par l'API).
