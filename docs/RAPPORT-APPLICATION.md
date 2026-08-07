# CERAF Bafoussam — Rapport descriptif de l'application

*Réécrit le 2026-08-07 à partir d'une lecture du code réellement en production :
`api/core.mjs`, `db/schema.sql`, `db/report-nocturne.sql`, `cloudflare/`, `index.html`, `sw.js`.
Remplace la version du 2026-08-05, qui décrivait le backend Apps Script aujourd'hui hors circuit.*

> `Code.gs` est **conservé dans le dépôt mais plus appelé par personne** depuis la bascule du
> 2026-08-06. Il reste une référence utile (règles métier d'origine, historique des
> corrections) et un chemin de retour arrière théorique. Ne pas s'y fier pour comprendre le
> comportement actuel.

---

## 0. Journal des changements

### 2026-08-07 — Correctifs API et Terrain (Worker `d7b38709`, SW v19)

Détail et arbitrages dans [AMELIORATIONS-API.md](AMELIORATIONS-API.md).

- **Historique client réparé** : `getClientHistory` renvoyait `historique` alors que le
  frontend lit `res.history` → `undefined.length` levait avant tout rendu, et le modal
  tournait indéfiniment.
- **Onglet Résiliés réparé** : clé `clients` → `clientsResilies`.
- **Historique LS discriminé par (nom, ville, quartier)**, la clé d'identité réelle d'une
  fiche LS.
- **`sql()` : timeout 15 s + seconde tentative** sur erreur transitoire uniquement.
- **`invId` en `crypto.randomUUID()`** : deux publications simultanées pouvaient produire le
  même identifiant et lever une violation de clé primaire non absorbée par `ON CONFLICT`.
- **Erreurs internes non divulguées** au client ; détail dans les logs et `audit_log`.
- **Rate-limit de login par IP** (20 / 15 min) en plus du compteur par matricule.
- **Vue Terrain** : icône 📞 retirée des lignes d'intervention (numéro toujours cliquable).

### 2026-08-06 — Migration Neon + Cloudflare

Bascule du backend d'Apps Script/Google Sheets vers PostgreSQL (Neon) et Cloudflare Workers.
Contrat frontend/backend conservé à l'octet près, ce qui a permis une bascule par simple
changement d'URL.

---

## 1. Architecture

PWA de gestion des interventions terrain (FTTH / LS / Cuivre) pour une équipe télécom.
Trois morceaux, aucun outil de build nulle part :

| Morceau | Fichier | Hébergement |
|---|---|---|
| Frontend | `index.html` (SPA vanilla, CSS + i18n FR/EN + logique dans un seul fichier) | GitHub Pages |
| API | `api/core.mjs` (cœur, ~1000 lignes) + `cloudflare/src/worker.mjs` (adaptateur) | Cloudflare Workers |
| Base | `db/schema.sql` | Neon PostgreSQL (projet *Camtel CERAF*, Londres) |

**Le cœur est séparé de l'adaptateur** volontairement : `api/core.mjs` n'utilise que des APIs
Web standard (`fetch`, `crypto.subtle`, `crypto.randomUUID`, `TextEncoder`) et ne connaît ni
Cloudflare ni Netlify. L'adaptateur ne fait que brancher l'environnement et traduire les
conventions de la plateforme. `netlify/functions/` existe encore pour la même raison — Netlify
a été abandonné le 06/08 (crédits de build épuisés), mais l'adaptateur documente la
portabilité et sert de cible aux harnais de test hors ligne.

**Zéro dépendance** : la base est interrogée via le point d'entrée SQL-sur-HTTP de Neon avec
le `fetch` natif. Pas de bundler, pas de `node_modules`, démarrage à froid minimal.

L'URL de l'API est **codée en dur** (`index.html:1599`) avec une migration automatique de
l'ancienne valeur stockée dans `localStorage['ceraf_url']` (`migrerUrlBackend()`) : les
téléphones déjà configurés sur Apps Script basculent tout seuls.

---

## 2. Authentification et sécurité

- **Connexion par matricule + PIN.** PIN haché SHA-256 avec sel par utilisateur, stocké
  `<hash>:<sel>` ; les comptes antérieurs à la migration du sel retombent sur `PIN_SALT`
  (`api/core.mjs:23`), qui doit rester identique à celui d'Apps Script sous peine d'invalider
  tous les PIN existants.
- **Sessions** : token = double UUID, valable 7 jours (`SESSION_DUREE_JOURS`), **stocké haché**
  (`token_hash`). Une fuite de la base ne donne aucune session utilisable. La table `sessions`
  distingue les appareils : la révocation est individuelle et l'admin voit les sessions
  ouvertes.
- **Rate-limit de login**, lu depuis `audit_log` (aucun cache externe) : 5 échecs par matricule
  et 20 par IP sur une fenêtre de 15 min, comptés dans **une seule requête** par agrégat
  conditionnel.
- **Multi-rôles** : un compte cumule `admin` / `chef` / `technicien`. Le rôle actif
  (`actingRole`) est **revérifié serveur-side** contre les rôles réels à chaque requête.
- **Contrôle d'accès au point de dispatch** (`api/core.mjs:864-866`), jamais seulement dans
  l'UI :

  | Classe | Actions |
  |---|---|
  | `CHEF_ONLY` | `deleteClient`, `deleteIntervention`, `saveClient`, `saveClientLs`, `mergeClientsLs` |
  | `CHEF_READ` | `getAll`, `getClientHistory`, `getClientsResilies` |
  | `ADMIN_ONLY` | gestion utilisateurs, sessions, audit |

  `getClients` reste ouvert à tous les rôles : la vue Terrain s'en sert pour l'autofill et la
  fusion GPS.
- **Verrou `mustChangePin`** : tant qu'un compte est au PIN par défaut (`0000`), **aucune
  action** n'est possible hors `changePin` et `logout`. Contrôlé serveur-side.
- **Erreurs internes non divulguées** : le client reçoit `Erreur serveur (réf. xxxxxxxx)` ; la
  stack part dans les logs Cloudflare et le message complet dans `audit_log`, lisible du seul
  super admin.
- **Échappement HTML systématique** côté frontend sur toute donnée utilisateur rendue. Point
  d'attention permanent : dans `lienTel()` (`index.html:2604`), l'échappement doit rester
  **avant** la détection des numéros — l'ordre inverse rouvrirait une XSS stockée.
- L'anti-injection de formule Sheets (`protegerCellule_`) a disparu avec le Sheet : sans objet
  sur PostgreSQL.

> **Incident du 2026-08-06 — boucle de réinitialisation du PIN.** Le backend exigeait
> `currentPin` sur `changePin` alors que le frontend **publié** ne l'envoyait pas : le PIN
> restait `0000`, et l'utilisateur repassait indéfiniment par l'écran de personnalisation
> tout en étant bloqué en écriture. **Leçon : un durcissement backend qui rend un champ
> obligatoire est un changement cassant** — il doit partir avec son frontend, ou rester
> tolérant à l'ancien format.

---

## 3. Modèle de données (PostgreSQL)

Trois types énumérés (`service_t`, `statut_t`, `role_t`) contraignent les valeurs au niveau de
la base, là où le Sheet acceptait n'importe quelle chaîne.

| Table | Clé | Notes |
|---|---|---|
| `utilisateurs` | `matricule` | `pin_hash`, `roles[]`, `pin_reinitialise_par` |
| `sessions` | `token_hash` | `expire_le`, `revoquee_le`, `appareil`, `dernier_acces` |
| `consistances` | `id` (`C_YYYYMMDD`) | La fiche du jour |
| `interventions` | `id` | `client_request_id` **unique** = clé d'idempotence de publication |
| `clients` | `numero` | FTTH et Cuivre dans **une seule table**, distingués par `service` |
| `clients_ls` | `cle_normalisee` | Colonne **générée** : `nom\|ville\|quartier` normalisés, index unique |
| `clients_resilies` | — | Archive à la résiliation, avec `motif`, `date_resiliation`, `resilie_par` |
| `audit_log` | `id` | Alimenté au **point de dispatch**, avec `est_test` pour exclure les harnais |

**Deux vues portent la logique de lecture :**

- `v_consistances` : agrégats (`nb_interventions`, `realisees`, `instances`) **calculés à la
  lecture** par `count(…) FILTER`. Ils ne sont plus stockés — c'est ce qui rend inutile tout
  le dispositif `recalculerAgregatsMois` d'Apps Script, qui existait uniquement parce que des
  compteurs stockés divergeaient.
- `v_interventions` : GPS joint depuis la fiche client (le GPS vit sur le client, pas sur
  l'intervention) et **durée calculée** par `duree_intervention()`. Ce JOIN remplace les deux
  lectures de feuilles entières que faisait chaque `getByDate`.

**Suppressions = archivage** (`supprime_le`), jamais de `DELETE` sec. Tous les index sont
partiels sur `WHERE supprime_le IS NULL`.

**Durée** : `jours_ouvres(origine, fin) - 1`, où `fin` = aujourd'hui si l'intervention est
encore ouverte, sinon la date de sa propre ligne. Jamais stockée — c'est la leçon du compteur
`Duree_Jours` qui divergeait silencieusement dès que le déclencheur nocturne sautait.

---

## 4. Écrans frontend

### Chef — saisie consistance
8 types d'intervention, formulaires indépendants câblés à la main (`f1*`…`f8*`) : Étude FTTH,
Installation FTTH, Dérangement FTTH, Dérangement Cuivre, Étude LS, Dérangement LS,
Installation LS, **Résiliation** (formulaire unique pour les 3 réseaux, service auto-détecté
par `detecterServiceResil()` depuis le numéro ou depuis nom+ville+quartier en LS).

- Autofill instantané depuis un cache client en mémoire (`onNumInput` → `lookupClientLocal`).
- Détection de quartier tolérante aux fautes (Levenshtein, 1-2 fautes selon la longueur)
  contre ~40 quartiers de Bafoussam — l'orthographe terrain est instable, un menu déroulant
  fixe ne tiendrait pas.
- Détection de doublon (numéro déjà actif) et de changement de fiche client avant publication.
- Publication du lot en **un seul appel** `saveConsistance`, avec `clientRequestId` : un
  double-post réseau ne crée pas de doublons (`ON CONFLICT (client_request_id) DO NOTHING`).

### Terrain
Fiche du jour, vue par type ou par quartier, 3 filtres croisés cumulables (quartier / statut /
type) dont les compteurs se recalculent en ignorant leur propre filtre, plus recherche texte.
Champs structurés obligatoires avant passage à « Réalisé » (FDT/FAT/distance/conclusion en
Étude FTTH, nature de panne en Dérangement). Capture GPS native écrite sur la **fiche client**.

### Historique
Consomme `getAll` (dédupliqué mensuellement), sélecteur de mois, statistiques, mêmes filtres
croisés, cache localStorage par mois.

### Clients
4 onglets (FTTH / Cuivre / LS / Résiliés — ce dernier chef-only), recherche, historique par
client en modale, fusion de fiches LS en doublon *(cassée — voir §8)*.

### Admin
Gestion des utilisateurs, ajout direct d'un client, **onglet Audit** (sessions ouvertes,
révocation, journal des mutations) — ce dernier sans équivalent dans le backend Sheets, rendu
possible par `audit_log`.

---

## 5. Logique métier

- **Idempotence plutôt que verrous.** Apps Script sérialisait toutes les écritures avec
  `LockService` (`withEcritureLock_`) parce qu'un Sheet ne sait pas faire mieux. Postgres rend
  ce dispositif inutile : les contraintes d'unicité et `ON CONFLICT` remplacent le verrou, et
  chaque publication porte un `client_request_id` qui rend le rejeu inoffensif.
- **Report nocturne** (`db/report-nocturne.sql`, fonction `reporter_interventions()`) : toute
  intervention encore ouverte (`En attente` / `Injoignable` / `Problème`) à une date passée
  passe au jour ouvré suivant. `reporte_depuis` porte la date d'origine et ne bouge jamais.
  Deux écarts assumés avec Apps Script :
  1. la ligne est **déplacée en gardant son ID** au lieu d'être recréée — l'ancien
     comportement cassait la file d'attente hors ligne du frontend, dont les items
     référencent un `invId` qui n'existait plus le lendemain (saisie du technicien perdue) ;
  2. aucune fiche n'est jamais créée un samedi ou un dimanche.

  **Idempotente par construction** : seules les interventions ouvertes à une date *passée*
  sont candidates ; une fois reportées elles ne le sont plus. D'où l'absence du marqueur de
  throttle que l'ancien code devait maintenir dans `_Config!B4`.
- **Double déclenchement du report** : Cron Trigger Cloudflare à `0 23 * * *` **UTC** = minuit
  au Cameroun (UTC+1 — les crons Cloudflare sont toujours en UTC, écrire `0 0` déclencherait
  à 1 h locale), plus un filet de sécurité appelé par `getByDate` sur la date du jour. Si le
  déclencheur saute, l'arriéré remonte dès qu'un technicien ouvre sa fiche.
- **Dédoublonnage mensuel** (`getAll`) : la même intervention logique apparaît une fois par
  jour de report. Clé `nom|num|type`, survivant choisi par statut le plus avancé
  (Réalisé > Problème > Injoignable > En attente), départagé par date la plus récente ; le
  `reporte_depuis` le plus ancien est conservé pour que la durée reste juste.
- **Identité d'un client LS** = `(nom, ville, quartier)` normalisés. Ce n'est pas une
  convention applicative mais la définition de `clients_ls.cle_normalisee` et de son index
  unique : une orthographe différente crée une **autre** fiche. Toute requête sur un client LS
  doit reprendre cette clé — c'est ce qui a été corrigé le 07/08 sur `getClientHistory`.
- **Reclassement de service** : un numéro vit dans une seule ligne `clients` ; le re-saisir
  sous l'autre service met à jour la colonne `service`, il ne crée pas de doublon.
- **Résiliation** : publiée directement en `Réalisé`, la fiche est archivée vers
  `clients_resilies` avec son motif, sans toucher aux interventions passées.
- **Journal d'audit au point de dispatch** : toutes les mutations passent par le même endroit,
  il est donc impossible d'en oublier une. Un échec d'écriture du journal ne fait jamais
  échouer l'action métier.

---

## 6. PWA / offline

- Cache localStorage *stale-while-revalidate* pour Terrain, Historique (par mois) et Clients :
  affichage instantané puis rafraîchissement réseau silencieux. Fraîcheur visée 10 min sur les
  clients (`CLIENTS_REFRESH_INTERVAL`, `index.html:2120`). **C'est le cache qui compte** — il
  supprime l'aller-retour réseau, qui est le seul coût réel (~800 ms, contre 0,2 ms de SQL).
- File d'attente offline (`ceraf_status_queue`) pour les changements de statut faits sans
  réseau, rejouée au retour en ligne. C'est elle qui impose que le report nocturne **déplace**
  les lignes sans changer leur ID.
- Pull-to-refresh tactile, désactivé sur l'écran de saisie chef (ne pas perdre les
  interventions non publiées) et pendant qu'une modale est ouverte.
- Service worker **network-first** sur le HTML (`sw.js`, `ceraf-v19`) : la version la plus
  récente s'affiche dès qu'il y a du réseau, le cache ne sert que de secours hors ligne. Pas
  de rechargement automatique sur `controllerchange` (boucle infinie déjà rencontrée).
- `warmupBackend()` subsiste (`index.html:1710`) : hérité du cold start Apps Script (10-30 s),
  il n'a plus grand intérêt face au démarrage d'un isolat Workers (~4 ms).

---

## 7. Déploiement

Deux cibles **indépendantes**. Rien n'est automatisé : pas de CI, pas de préproduction — le
live **est** la production.

**API** (Cloudflare Workers) :
```bash
node --check api/core.mjs
npx wrangler deploy --config cloudflare/wrangler.toml
node tests/test-api-live.mjs https://ceraf-bafoussam-api.knp9jhkmd8.workers.dev
```
`DATABASE_URL` n'est **pas** dans le dépôt (public) : elle est posée en secret via
`wrangler secret put DATABASE_URL`. Compter quelques secondes de propagation avant de tester —
un test lancé dans la foulée peut encore taper l'ancienne version.

**Frontend** (GitHub Pages) :
```bash
node tests/check-inline-js.js index.html     # obligatoire : ~3800 lignes de JS inline, aucun build
# bump CACHE_VERSION dans sw.js, sinon les téléphones gardent l'ancien index.html
git push origin main
```

Le frontend **reste sur GitHub Pages** délibérément : le déplacer changerait l'URL de la PWA
déjà installée sur les téléphones de l'équipe et casserait leur installation.

---

## 8. Écarts connus et dette

**Deux actions appelées par le frontend n'existent pas dans le routeur** (`ACTIONS`,
`api/core.mjs:811`) — oubliées lors du portage :

| Action | Effet réel | Gravité |
|---|---|---|
| `mergeClientsLs` | La fusion de fiches LS en doublon échoue avec « Action inconnue ». Échec visible. | Fonctionnalité perdue |
| `findClient` | ⚠️ **Panne silencieuse.** L'action sert de garde-fou avant `saveClient` côté Admin (`index.html:2043`). Comme elle échoue, `ex.success` est faux, la condition `ex.success && ex.found && !confirm(…)` tombe à faux, et **une fiche client existante est écrasée sans aucune confirmation**. | Perte de données possible |

**Automatismes Drive non portés.** Le Cron Cloudflare ne fait que le report nocturne. La
sauvegarde hebdomadaire du classeur et la génération du KPI mensuel étaient des déclencheurs
Apps Script sur le Sheet — lequel ne reçoit plus rien depuis le 06/08. Ils tournent donc dans
le vide ou sur des données figées. À débrancher, ou à porter si le KPI est encore utilisé.

**Sauvegarde de la base.** Le point précédent a un corollaire : il n'existe plus de sauvegarde
applicative. Neon assure un *point-in-time recovery* selon son offre, mais aucun export ne
sort du service. À décider consciemment plutôt que par omission.

**`Code.gs`** (137 Ko) et son tiers inférieur de fonctions `reparer*`/`corriger*`/`migrer*`
restent dans le dépôt comme preuve forensique des corruptions passées. Ce n'est pas un modèle
à étendre.

---

## 9. Tests

Aucune CI. Quatre scripts, `node` seul, aucune dépendance à installer (`tests/README.md`) :

| Script | Cible |
|---|---|
| `check-inline-js.js` | Parse le JS inline d'`index.html` — la seule protection contre une erreur de syntaxe qui ne se verrait que sur le téléphone du technicien |
| `test-api-lectures.mjs` / `test-api-ecritures.mjs` | Le vrai cœur, contre la **vraie base**. ~80 assertions. Nécessitent la chaîne de connexion en argument |
| `test-api-live.mjs` | L'API **déployée**, en HTTP. Mesure la latence client et la sépare du temps serveur (`_ms`) |

⚠️ **Les harnais d'écriture tournent contre la base de production.** Le 07/08, un test a
archivé les 26 interventions du jour (restaurées depuis). Règles : compte dédié `_T_HARNAIS`
et jamais un compte de l'équipe ; `_test: true` sur chaque appel ; **ne jamais tuyauter ces
scripts vers `head`** — le SIGPIPE interrompt le nettoyage final et laisse des données de test
en base.

Deux principes appris le 07/08 :
- **asserter le nom des clés de réponse**, pas seulement `success` — qui restait vrai pendant
  tout le temps où l'application était cassée ;
- **ne figer ni date ni effectif** dans un test live : le report nocturne vide une fiche
  passée toute seule, ce qui produit des échecs fantômes qui finissent par masquer les vrais.
