# Tests

Il n'y a ni build, ni CI, ni environnement de préproduction sur ce projet : le
déploiement live **est** la production. Ces scripts sont le premier filet
automatisé — ils tournent avec node seul, sans dépendance à installer.

```bash
node tests/test-auth.js          # logique d'authentification (Code.gs)
node tests/check-inline-js.js index.html   # validité du JS inline du frontend
```

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
