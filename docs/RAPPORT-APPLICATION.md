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
- **`findClient` et `mergeClientsLs` rétablies** dans le routeur `ACTIONS` — voir §9bis.
- **Sauvegarde de la base** : téléchargement manuel depuis l'onglet Admin (`adminExport`) et
  copie nocturne automatique vers Workers KV, conservée 30 jours (`adminBackups`) — voir §10.

### 2026-08-07 (nuit) — Métier : études, statistiques, corrections admin

- **Une étude ne crée plus de fiche client.** `saveConsistance` utilisait le **Customer ID**
  comme clé de fiche quand le numéro de ligne était vide : `AA10473363`, `1`, `81`, `82` sont
  ainsi devenus des « clients ». Une étude est une demande à l'instruction, pas un client.
  Elle reste dans l'historique et ne crée plus rien, ni en FTTH/Cuivre ni en LS. 8 fiches
  existantes archivées, **interventions intactes**.
- **« Durée moy. sur le mois »** couvre **toutes** les interventions du mois — enregistrées
  dans le mois comme héritées du mois précédent — et le compteur d'un dossier hérité **repart
  au 1er du mois** (fonction `duree_dans_mois`, exposée par `getAll` sous `dureeMois`).
  Résultat comparable d'un mois à l'autre : août 3,0 j / juillet 3,7 j / juin 1,8 j.
  ⚠️ La durée propre à **chaque** intervention reste la VRAIE, comptée depuis son origine
  réelle : seul l'agrégat change. Une intervention née le 09/07 affiche toujours ses 21 j sur
  sa ligne tout en comptant 4 j dans la statistique d'août.
- **Filtre par panne** retiré de l'Historique ; **icône ☎** retirée partout (le paramètre
  `avecIcone` de `lienTel` est supprimé, plus aucun appelant ne le demandait).
- **L'admin peut corriger les dates d'une intervention** — voir §5bis.
- **Les utilisateurs sont archivés, jamais supprimés.** Le backend le faisait déjà ;
  c'est le libellé qui mentait (« Supprimer » → « Archiver »).

### 2026-08-07 (soir) — ⚠️ Suppression accidentelle du projet Neon, restauré

Le projet Neon `damp-leaf-40846298` a été **supprimé en entier** (l'intention était de
supprimer une branche de test). L'application est restée hors service ~35 minutes.

**Restauré intégralement** via la fenêtre de récupération de 7 jours de Neon :
```bash
npx neon projects list --recoverable-only --org-id <org>
npx neon projects recover damp-leaf-40846298 --org-id <org>
```
Aucune perte : 281 clients, 5 fiches LS, 135 interventions, 8 comptes, 286 entrées d'audit —
dernière activité enregistrée à 19:28 UTC pour une suppression à 19:38. **Les chaînes de
connexion font partie de ce qui est restauré**, donc le secret `DATABASE_URL` du Worker a
refonctionné tel quel, sans redéploiement.

Conséquences retenues en §10.

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

Depuis le 2026-08-12 :
- les libellés `FDT-`, `FAT-`, `Distance =` sont affichés **en dur devant le champ** au lieu
  d'être des placeholders : ils restent lisibles une fois la valeur saisie, et le technicien
  ne tape que le numéro (`sansPrefixe()` retire le libellé répété des valeurs héritées) ;
- le bouton « Ouvrir sur Maps » sous chaque ligne a été retiré : le badge `📌 GPS` en tête de
  ligne fait déjà le lien, et il reçoit désormais le GPS **résolu** (ligne d'intervention ou,
  à défaut, fiche client), ce qui n'était pas le cas avant ;
- le contact d'une intervention **sans fiche client** (les études n'en créent aucune) est
  porté par la remarque (`Tel: … • Tel2: … • Localité: …`), relu par le backend
  (`contactDeRemarque()`) et réémis à chaque recomposition côté terrain — sans quoi le
  téléphone d'une Étude FTTH n'était affiché nulle part, ou effacé à la première saisie
  FDT/FAT ;
- correctif : `updStatut` lisait `.remark-inp` en premier dans la ligne, c'est-à-dire le champ
  **GPS**, et écrivait donc les coordonnées à la place de la remarque (constaté en base). La
  lecture se fait maintenant par `#rem-<invId>`.

### Bandeau du haut
Quatre blocs (logo, badge de rôle, état de synchro, déconnexion) pour une largeur de téléphone :
l'ordre de priorité est explicite depuis le 2026-08-12, faute de quoi le badge passait sur deux
lignes et « Synchronisé » finissait *sous* le bouton Déconnexion. Le badge se comprime avec des
points de suspension (libellé entier dans `title`), le mot « Synchronisé » disparaît sous 620 px
— la pastille colorée porte déjà l'information — et le bouton Déconnexion se réduit à son icône
sous 560 px, son libellé restant accessible par `title` (`data-i18n-title`).

### Édition manuelle (admin)
Corriger une intervention (statut, dates, remarque) ou une fiche client, tout étant journalisé.
Depuis le 2026-08-12, les champs passent par `.ed-grid`
(`repeat(auto-fit,minmax(min(100%,190px),1fr))`) : la borne `min(100%,…)` est ce qui empêche
le débordement. Mesuré sur une carte de 320 px, l'ancienne règle `minmax(150px,1fr)` produisait
**deux colonnes de 155 px** alors qu'un `input[type=date]` réclame **158 px au minimum** (plus
encore sur les widgets natifs mobiles) — les champs sortaient de la carte. Le wrapper
`overflow-x:auto`, reste de l'affichage en tableau, a été retiré : il ne corrigeait rien, il
cachait le débordement dans une barre de défilement.

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

### 5bis. Correction des dates par l'admin (`adminCorrigerIntervention`)

Deux dates, deux rôles à ne pas confondre :

| Champ | Sens | Effet |
|---|---|---|
| `reporte_depuis` | **Date d'émission** — origine de la 1re occurrence | Seule source de vérité de la **durée**, rétroactivement |
| `date` | **Date de la fiche** — jour de rattachement | Déplace la ligne d'une fiche du jour à une autre |

- Action **séparée d'`updateStatus`**, volontairement : ce dernier est appelé par le terrain
  et **rejoué depuis la file hors ligne**. Y greffer des dates exposerait l'application à des
  rejeux qui déplaceraient des interventions.
- Changer la date **crée la fiche du jour cible si elle manque**, sinon la clé étrangère
  `consistance_id` casse.
- Une date d'émission postérieure au rattachement est refusée : elle produirait une durée
  négative que rien en aval ne rattraperait.
- Les agrégats des deux fiches concernées sont comptés à la lecture (`v_consistances`) :
  rien à recalculer.
- Tracé dans `audit_log` avec avant/après.

> ⚠️ **Interaction avec le report nocturne.** Une intervention encore **ouverte** déplacée
> vers une date passée est ramenée au jour courant par `reporter_interventions()` — qui fait
> exactement son travail. Pour figer une ligne à une date passée, la passer d'abord en
> `Réalisé`, que le report exclut. C'est écrit dans l'aide de l'écran.

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
- Service worker **network-first** sur le HTML (`sw.js`) : la version la plus récente est
  téléchargée dès qu'il y a du réseau, le cache ne sert que de secours hors ligne.
- ⚠️ **Le network-first ne suffit pas.** Il garantit que le *fichier téléchargé* est à jour,
  pas que le *code exécuté* l'est : une PWA installée est **reprise** depuis l'arrière-plan
  sans nouveau chargement de page, et le JS déjà en mémoire reste l'ancien pendant des jours.
  D'où une détection de nouvelle version (`updatefound` + `statechange`, et `reg.waiting` au
  démarrage) qui affiche une **bannière « Recharger »**. On propose, on ne force jamais :
  recharger sur `controllerchange` avec `clients.claim()` boucle à l'infini.
  `reg.update()` est aussi relancé au retour au premier plan, espacé de 5 minutes.
- **Le « quoi de neuf » s'affiche APRÈS le rechargement.** Raison dirimante : avant le
  rechargement, le JS en mémoire est celui de l'ANCIENNE version — il ne contient donc pas les
  notes de celle qui arrive, et l'annonce portait en fait sur la version qu'on quitte. Les
  notes s'ouvrent au lancement suivant dans `#modal-maj` (`afficherQuoiDeNeufSiBesoin`),
  résumé puis détail derrière « Voir plus ».
- **Une seule fenêtre pour toute la mise à jour** (2026-08-13). Il y en avait deux — le
  panneau de notes et une bannière « Recharger » en bas — et elles pouvaient s'afficher
  **ensemble** : au démarrage la page récupère déjà le nouveau fichier (network-first) pendant
  que le service worker finit son installation quelques instants plus tard. On lisait donc les
  nouveautés d'une version en même temps qu'on nous l'annonçait comme « à venir ». La bannière
  est supprimée ; `#modal-maj` sert aux deux usages, titre et boutons s'adaptant à la
  situation (`afficherMajDispo`, `majBoutons`).
- **Le bouton principal applique la mise à jour**, mais seulement s'il y en a une :
  `majEnAttente` (armé par `proposerMaj`) décide entre recharger et simplement fermer.
  Recharger « pour rien » ferait perdre une consistance en cours de frappe, qui ne vit qu'en
  mémoire — d'où aussi le bouton « Plus tard », visible uniquement quand une mise à jour est
  réellement en attente : on propose, on n'impose pas. `majModeDispo` évite qu'un clic en mode
  « disponible » marque comme lues des notes jamais affichées. Couvert par
  `tests/test-fenetre-maj.mjs` (26 assertions, 6 situations).
- Affichage **une seule fois par appareil** : `MAJ_ID` est mémorisé dans
  `localStorage['ceraf_maj_vue']` à la fermeture, donc un utilisateur qui a déjà lu ces
  nouveautés ne les revoit jamais — seul un `MAJ_ID` inédit rouvre le panneau. Sur un appareil
  **neuf** (ni `ceraf_url` ni `ceraf_role` en mémoire) le drapeau est posé en silence : on ne
  déroule pas les correctifs d'une version jamais utilisée.
- `NOTES_MAJ` (FR + EN) et `MAJ_ID` sont **à réécrire à chaque déploiement**, en langage
  courant — c'est lu par des techniciens, pas par des développeurs : décrire ce qui change
  *à l'écran*, jamais le code. Oublier de changer `MAJ_ID` = personne ne voit les notes.
  Et la bannière ne s'affiche que si un **nouveau service worker** s'installe : incrémenter
  `CACHE_VERSION` dans `sw.js` à chaque livraison, même quand seul `index.html` change.
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

**Automatismes Drive non portés.** Le Cron Cloudflare ne fait que le report nocturne. La
sauvegarde hebdomadaire du classeur et la génération du KPI mensuel étaient des déclencheurs
Apps Script sur le Sheet — lequel ne reçoit plus rien depuis le 06/08. Ils tournent donc dans
le vide ou sur des données figées. À débrancher, ou à porter si le KPI est encore utilisé.

**Sauvegarde de la base.** ✅ Traité le 07/08 (voir §10) : copie nocturne automatique vers
Workers KV + téléchargement manuel depuis l'onglet Admin. Reste que les copies automatiques
vivent chez Cloudflare — un téléchargement occasionnel est ce qui les met hors de portée d'un
incident de compte.

**Résidus de test.** Deux fiches `ZZ TEST FUSION` archivées dans `clients_ls` (07/08, test de
la fusion). Invisibles pour l'application ; à purger au prochain ménage.

---

## 9bis. Ce qui a été réparé le 07/08 (soir)

**Deux actions appelées par le frontend étaient absentes du routeur `ACTIONS`**, oubliées lors
du portage. Corrigées et vérifiées en live :

| Action | Symptôme avant correctif |
|---|---|
| `mergeClientsLs` | La fusion de fiches LS en doublon échouait avec « Action inconnue » — échec visible. |
| `findClient` | ⚠️ **Panne silencieuse.** Garde-fou avant `saveClient` côté Admin (`index.html:2043`) : l'action échouant, `ex.success && ex.found && !confirm(…)` tombait à faux et **une fiche existante était écrasée sans confirmation.** |

`mergeClientsLs` retrouve les deux fiches en laissant la **base** calculer la clé, avec
l'expression exacte de `clients_ls.cle_normalisee` — recalculer cette clé en JS est
précisément ce qui divergeait du temps d'Apps Script (`nomKeyLs_`). Elle ne complète que les
champs vides de la fiche gardée et ne touche **jamais** ville/quartier, qui composent son
identité : les modifier reviendrait à déplacer la fiche conservée.

> **Leçon** : une action absente du routeur ne provoque pas forcément une erreur visible.
> Elle peut désarmer un garde-fou en silence. Comparer périodiquement les actions appelées par
> le frontend à celles déclarées dans `ACTIONS` :
> ```bash
> grep -o "action:'[a-zA-Z]*'" index.html | sort -u
> ```

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

---

## 10. Filets de sécurité de la base

Retenus après l'incident du 07/08 (suppression accidentelle du projet Neon, restauré sans
perte). Les trois premiers sont **internes à Neon** : ils protègent d'une fausse manœuvre,
pas d'un problème de compte ou de fournisseur.

| Filet | Portée | Fenêtre |
|---|---|---|
| **Récupération de projet supprimé** | Projet entier, avec branches, réglages et **chaînes de connexion** | **7 jours** |
| **Instant restore / history window** | Données d'une branche, à un instant passé | selon l'offre |
| **Google Sheet + Apps Script** | État figé au 06/08, en lecture | tant qu'on ne les retire pas |
| **Sauvegarde nocturne → Workers KV** | Copie complète, hors base | **30 jours** glissants |
| **Téléchargement manuel** (onglet Admin) | Copie complète, hors hébergeur | ce que l'admin en fait |

### Sauvegardes

Le Cron Cloudflare (`0 23 * * *`) enchaîne **report nocturne puis sauvegarde** — dans cet
ordre, pour que la copie reflète l'état que l'équipe verra le matin, arriéré reporté compris.
Seule la sauvegarde est enveloppée dans un `try/catch` : un échec de copie ne doit pas
empêcher le report, qui est la tâche métier ; l'inverse n'est pas vrai.

- Stockage : **Workers KV** (binding `SAUVEGARDES`), offre gratuite, une écriture de ~240 Ko
  par nuit pour un plafond de 1000/jour.
- Rétention : `expirationTtl` de 30 jours **posé à l'écriture** — aucune purge à coder, donc
  aucune purge qui tombe en panne sans qu'on le voie.
- `construireExport()` est partagé entre le bouton de l'admin et le cron : une seule
  définition de ce que contient une sauvegarde, pas de dérive entre les deux copies.
- ⚠️ **`pin_hash` est volontairement exclu** — un PIN à 4 chiffres se retrouve en minutes à
  partir de son empreinte. À la restauration, les comptes repartent au PIN par défaut. La
  raison est rappelée *dans* le fichier exporté.
- `adminBackups` liste (sans paramètre) ou renvoie une copie (avec `cle`). **La clé venant du
  client est validée par motif AVANT d'atteindre le stockage**, sinon toute autre entrée du
  même espace KV deviendrait lisible.
- Le cœur ne connaît qu'un objet `get/put/list` fourni par l'hébergeur, et **le stockage est
  optionnel** : sans lui tout continue de fonctionner, seule la sauvegarde est passée.

> Les copies KV restent chez Cloudflare. **Télécharger une sauvegarde de temps en temps** est
> ce qui la met vraiment hors de portée d'un incident de compte.

**Commandes de récupération d'un projet supprimé** (à connaître AVANT d'en avoir besoin) :
```bash
npx neon@latest projects list --recoverable-only --org-id <org-id>
npx neon@latest projects recover <project-id>       --org-id <org-id>
```
`--org-id` évite un choix interactif qui bloque tout script.

**Ce qui n'est PAS restauré** avec un projet : Data API, intégrations GitHub/Vercel et
monitoring. Sans objet ici, mais à vérifier si l'une d'elles est adoptée un jour.

> **Ne pas retirer le Google Sheet ni le déploiement Apps Script** tant qu'un export
> indépendant n'existe pas. Ils sont aujourd'hui la seule copie hors de Neon, et ils ont servi
> de plan de repli le 07/08 le temps d'établir l'ampleur de l'incident.
