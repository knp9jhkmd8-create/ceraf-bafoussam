# Améliorations de l'API (Neon + Cloudflare) — état au 2026-08-07

> Périmètre : `api/core.mjs`, adaptateur Cloudflare (`cloudflare/src/worker.mjs`).
> Le backend Apps Script (`Code.gs`) est hors circuit depuis le 06/08.

Ce document listait 10 propositions. Le tri a été fait selon deux critères, dictés par
la phase du projet (essai sur une équipe de 8 comptes, données collectées pour démontrer
la valeur de l'outil à l'entreprise) :

1. **rien ne doit être visiblement cassé** ;
2. **aucune saisie ne doit se perdre**.

Tout le reste est écarté — sans dépense, et sans complexifier l'API.

## État

| # | Sujet | État |
|---|-------|------|
| 1 | `getClientHistory` : clé `historique` → `history` | ✅ fait |
| 2 | `getClientsResilies` : clé `clients` → `clientsResilies` | ✅ fait |
| 3 | Historique LS discriminé par (nom, ville, quartier) | ✅ fait |
| 6 | `sql()` : timeout + retry | ✅ fait |
| 7 | `invId` : `Date.now()` → `crypto.randomUUID()` | ✅ fait |
| 8 | Ne plus renvoyer `e.message` au client | ✅ fait |
| 5 | Rate-limit de login par IP | ✅ fait |
| 4 | PIN : SHA-256 → bcrypt | ❌ écarté |
| 9 | Rétention sur `audit_log` | ❌ écarté |
| 10 | Transaction sur `saveConsistance` | ❌ écarté |

Déployé le 2026-08-07 (version Worker `d7b38709`), vérifié par
`node tests/test-api-live.mjs` — 22 assertions au vert contre le live.

## Ce qui a été corrigé

**1-3. Régressions du portage Apps Script → Neon.** Le backend avait renommé des clés de
réponse que le frontend n'avait jamais cessé de lire sous leur ancien nom :

- `history` : `index.html` faisait `res.history.length` sur une réponse ne contenant que
  `historique`. `undefined.length` levait avant tout rendu — d'où le **modal d'historique
  client qui tournait indéfiniment**, symptôme remonté par l'utilisateur.
- `clientsResilies` : l'onglet Résiliés lisait une clé qui n'existait pas.
- L'historique LS filtrait sur le seul nom, alors que le frontend envoyait déjà `villeLs`
  et `quartierLs`. Or l'identité d'un client LS **est** `(nom, ville, quartier)` normalisés
  — c'est la définition de `cle_normalisee` (`db/schema.sql:161`) et l'index unique qui va
  avec. Le filtre reprend exactement la même expression de normalisation, ce qui le rend
  correct par construction : une orthographe différente crée une autre fiche, avec ses
  propres interventions.

> Leçon : `success: true` restait vrai pendant tout le temps où l'app était cassée. **Le nom
> de la clé fait partie du contrat** — les tests l'assertent désormais explicitement.

**6-7. Protection de la saisie.** `sql()` n'avait aucun garde-fou : sur le réseau mobile du
terrain, un `fetch` qui pend bloquait la publication jusqu'à l'abandon du technicien, et la
saisie était perdue. Désormais timeout ferme à 15 s et une seconde tentative, uniquement sur
erreur transitoire (réseau, timeout, 5xx) — jamais sur un 4xx, déterministe. Le rejeu est
sûr : lectures pures, écritures dédoublonnées par `client_request_id`.

`invId` combinait `Date.now()` et le rang : deux publications simultanées sur la même
consistance produisaient le même identifiant, et `ON CONFLICT` porte sur
`client_request_id`, pas sur `id` — la violation de clé primaire remontait donc en 500.

**8. Fuite d'informations internes.** La réponse d'erreur concaténait `e.message`, qui
contient jusqu'à 300 caractères de la réponse Neon (requête SQL, noms de tables, hôte). Le
client reçoit maintenant une référence courte ; la stack va dans les logs Cloudflare et le
message complet dans `audit_log`, lisible du seul super admin.

**5. Rate-limit par IP.** Le compteur ne portait que sur le matricule : chaque compte avait
droit à ses 5 essais indépendamment, donc un balayage `matricule × {0000, 1234, …}` passait
— l'URL du Worker est publique et les matricules sont des numéros devinables. Second
compteur par IP (plafond 20 / 15 min, plus haut car plusieurs téléphones du terrain sortent
derrière la même IP opérateur), calculé dans **la requête existante** par agrégat
conditionnel : pas de requête, ni de table, ni de cache supplémentaires.

## Ce qui a été écarté, et pourquoi

**4 — PIN en bcrypt.** Sur un PIN de 4 chiffres (10 000 combinaisons), bcrypt fait passer le
cassage d'« instantané » à ~17 minutes. Et ce scénario suppose que la base Neon a déjà fuité,
auquel cas l'attaquant détient déjà clients, interventions et historique : casser les PIN
pour se connecter et relire ce qu'il possède n'apporte rien.

S'y ajoute un effet de bord que la proposition ne voyait pas : `estPinDefaut()` détermine
« ce compte est-il au PIN par défaut » **en re-hachant** `0000`, et il est appelé à *chaque
requête authentifiée* (`api/core.mjs:107`) ainsi que par compte dans `listUsers`. Avec
bcrypt, toute l'application paierait un KDF complet à chaque appel. Il aurait fallu d'abord
stocker l'information dans une colonne — un chantier sans rapport avec le gain visé.

Le vrai levier serait un secret plus long, pas un hachage plus lent. Un PIN à 4 chiffres est
un arbitrage d'ergonomie assumé pour une saisie au doigt en intervention. **À reconsidérer
si l'outil sort du cadre d'une équipe de 8 comptes.**

**9 — Rétention sur `audit_log`.** La table fait 274 lignes, ~18 k/an au rythme réel. Si un
ralentissement apparaît un jour, il viendra d'abord de l'absence d'index couvrant le filtre
du rate-limit (`action`, `succes`, `entite_id`, `ts`), pas du volume.

**10 — Transaction sur `saveConsistance`.** L'endpoint HTTP `/sql` de Neon n'exécute qu'une
requête à la fois, et le cœur n'utilise pas le driver `@neondatabase/serverless` qui sait
faire du batch transactionnel. L'idempotence par `client_request_id` rattrape déjà un lot
partiel au retry.

**Cache serveur sur `getClients`** (proposé par ailleurs, hors des 10 points). Mesuré : la
requête la plus lourde s'exécute en **0,20 ms** sur 258 clients, quand l'aller-retour réseau
coûte **~800 ms**. Un cache serveur économiserait 1 ms sur 800. Le cache qui compte existe
déjà côté client (`index.html:2120-2142`, fraîcheur 10 min), et il supprime réellement
l'aller-retour. Un TTL serveur ferait en outre courir un risque sur `activeInterventions`,
qui sert à détecter les doublons **avant publication**.

## Reste à surveiller

- `tests/test-api-live.mjs` ne peut pas exercer le verrou `mustChangePin` (il faudrait un
  compte au PIN par défaut, qu'une interruption laisserait cassé). C'est le harnais hors
  ligne qui le couvre.
- Les assertions live ne doivent pas figer de date ni de compte : le report nocturne déplace
  les interventions encore ouvertes, donc une fiche passée se vide toute seule.
