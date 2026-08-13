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
node tests/test-api-live.mjs      https://ceraf-bafoussam-api.knp9jhkmd8.workers.dev <fichier-admin>
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

## `test-fenetre-maj.mjs`

```bash
node tests/test-fenetre-maj.mjs
```

37 assertions sur 8 situations, jouées sur le **vrai** code extrait d'`index.html` (la
portion `MAJ_ID` → section PWA) avec un DOM minimal : appareil neuf, notes déjà lues,
nouveautés seules, nouveautés + mise à jour arrivant pendant la lecture, mise à jour seule
sur une app ouverte depuis longtemps, « Plus tard », retour de la fenêtre à chaque
réouverture tant que la mise à jour n'est pas installée, et absence de fenêtre quand il n'y
a rien en attente.

Deux propriétés que le harnais protège, invisibles autrement :

1. **Le bouton ne recharge que s'il y a réellement une mise à jour en attente.** Un
   rechargement gratuit ferait perdre une consistance en cours de frappe, qui ne vit qu'en
   mémoire.
2. **« Plus tard » n'éteint jamais définitivement la proposition.** Le service worker déjà
   installé n'émet plus d'événement, et une PWA reprise depuis l'arrière-plan n'est pas
   rechargée : sans le rappel à chaque ouverture, l'ancienne version tournerait des jours
   durant sans le moindre signe.

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


## Compte de test : TEMPORAIRE, jamais permanent

`test-api-live.mjs` s'appuyait sur un compte **permanent** `_T_HARNAIS` : matricule
devinable, PIN `1234`, rôle **admin**, sur une API publiquement joignable. Une porte
d'entrée ouverte en permanence. Supprimé le 2026-08-08.

Le harnais **crée son propre compte** au démarrage (matricule horodaté `_T_<base36>`, PIN
aléatoire à 6 chiffres) et l'**archive en partant** — y compris si un test échoue, si une
exception remonte, ou sur Ctrl-C. Aucun compte ne survit à l'exécution.

Il lui faut donc des identifiants d'administration, passés en **argument** et jamais écrits
dans le dépôt, même convention que la chaîne de connexion :

```bash
# fichier hors du dépôt, une seule ligne « matricule:pin »
node tests/test-api-live.mjs https://ceraf-bafoussam-api.knp9jhkmd8.workers.dev ~/ceraf-admin.txt
```

⚠️ Les comptes préfixés `_T_` sont **masqués de la gestion des utilisateurs**
(`adminListUsers`) : ce sont des outils, pas des membres de l'équipe. S'il en reste un en
base après une interruption brutale, il est invisible dans l'écran Admin — le repérer par
requête : `SELECT matricule FROM utilisateurs WHERE matricule LIKE '_T_%' AND supprime_le IS NULL`.
