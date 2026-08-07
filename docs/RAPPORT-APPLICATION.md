# CERAF Bafoussam — Rapport descriptif de l'application

*Généré le 2026-08-05 à partir d'une lecture intégrale de `index.html` et `Code.gs`. Mis à jour le 2026-08-06 (passe de durcissement sécurité v114 + correction des 3 anomalies relevées par les tests + correctif `changePin` v115 déployé).*

> ⚠️ **Ce document décrit encore majoritairement le backend Apps Script**, hors circuit depuis
> le 2026-08-06. Les sections 1, 2, 5 et 7 (Google Sheet, `LockService`, `clasp`,
> `withEcritureLock_`, triggers Apps Script) sont **périmées** : l'API tourne désormais sur
> Cloudflare Workers + Neon (`api/core.mjs`, `cloudflare/src/worker.mjs`), le verrouillage
> est assuré par les contraintes et transactions Postgres, et le report nocturne est un Cron
> Trigger Cloudflare appelant `reporter_interventions()`. Une réécriture complète reste à
> faire. Les sections 3, 4 et 6 (frontend, vues, PWA) restent valables.

## 0. Journal des changements

### 2026-08-07 — Correctifs API et Terrain (Worker `d7b38709`, SW v19)

Détail et arbitrages complets dans [AMELIORATIONS-API.md](AMELIORATIONS-API.md).

- **Historique client réparé** : `getClientHistory` renvoyait `historique` alors que le
  frontend lit `res.history` → `undefined.length` levait avant tout rendu, et le modal
  tournait indéfiniment. Symptôme visible n°1 pour l'équipe.
- **Onglet Résiliés réparé** : `getClientsResilies` renvoyait `clients`, le frontend lit
  `clientsResilies`. (La liste reste vide tant qu'aucun client n'est résilié — c'est normal.)
- **Historique LS discriminé par (nom, ville, quartier)**, la même clé que
  `clients_ls.cle_normalisee` : les homonymes LS ne se mélangent plus et les homonymes
  FTTH/Cuivre n'y remontent plus.
- **`sql()` : timeout 15 s + une seconde tentative** sur erreur transitoire uniquement
  (réseau, timeout, 5xx). Protège la saisie sur le réseau mobile du terrain.
- **`invId` en `crypto.randomUUID()`** : deux publications simultanées sur la même
  consistance pouvaient produire le même identifiant et lever une violation de clé primaire
  en 500, non absorbée par `ON CONFLICT` (qui porte sur `client_request_id`).
- **Erreurs internes non divulguées** : le client reçoit une référence courte, la stack part
  dans les logs Cloudflare et le message complet dans `audit_log`.
- **Rate-limit de login par IP** (20 / 15 min) en plus du compteur par matricule, calculé
  dans la requête existante — sans quoi un balayage de matricules disposait de 5 essais par
  compte.
- **Vue Terrain** : l'icône 📞 est retirée des lignes d'intervention (le numéro reste
  cliquable) ; le tableau Clients la conserve.
- **`tests/test-api-live.mjs`** : assertions ajoutées sur le **nom des clés** de réponse —
  `success: true` restait vrai pendant tout le temps où l'app était cassée. Les assertions
  figeant une date ou un effectif ont été retirées : le report nocturne vide une fiche passée
  toute seule, ce qui produisait des échecs fantômes masquant les vrais.

## 1. Architecture générale

PWA de gestion des interventions terrain (FTTH/LS/Cuivre) pour une équipe télécom. Deux moitiés indépendantes, aucun outil de build commun :

- **`index.html`** : SPA JS vanilla (CSS, i18n FR/EN et logique applicative dans un seul fichier), hébergé sur GitHub Pages. `manifest.json` + `sw.js` en font une PWA installable, avec cache offline, file d'attente hors-ligne et pull-to-refresh.
- **`Code.gs`** : backend Google Apps Script lié au Google Sheet `1OH566jWxL8ph7-UWscrs3ZQt0elNAnPGcNqvjC-RA_w`, exposé via `doGet`/`doPost` retournant du JSON — c'est la seule « API ».

Le frontend parle au backend via une URL de web app Apps Script saisie une fois dans l'écran de configuration (`localStorage['ceraf_url']`), jamais codée en dur.

## 2. Authentification et sécurité

- Connexion par **matricule + PIN**, hashé SHA-256 avec un **sel par utilisateur** stocké au format `<hash>:<sel>` (les comptes historiques en hex simple retombent sur `PIN_SALT` — rétro-compatible). Un token de session (double UUID) est stocké 30 jours, résolu à chaque requête via `resolveSession()`. La connexion est **rate-limitée** pour contrer le bruteforce.
- **Comptes multi-rôles** : un compte peut cumuler `chef`, `technicien`, `admin` (ex. `"chef,technicien"`). Après connexion, si plusieurs rôles sont disponibles, un écran de choix (`showRoleSwitch`) permet de sélectionner le rôle actif de la session ; le rôle choisi (`actingRole`) est **toujours revérifié côté serveur** contre les rôles réels du compte — impossible de se déclarer admin sans l'être.
- **Bootstrap** : `bootstrapAdmin` ne fonctionne que si la feuille Utilisateurs est vide (résout l'œuf-et-la-poule pour créer le premier admin). `ensureSeeded()` auto-exécute un seed one-shot au premier appel (verrouillé par `LockService` + un flag dans `PropertiesService`) qui crée/migre 6 comptes techniciens nominatifs + un compte admin `999999`.
- **PIN par défaut** `0000` : tant qu'un compte l'utilise, `mustChangePin` est renvoyé à la connexion et **`doPost` comme `doGet` bloquent toute action** (hors `changePin`/`logout`, qui sont POST-only). Le blocage est serveur-side : il ne dépend pas du frontend. *(Le contrôle manquait sur `doGet` jusqu'au 2026-08-06 — corrigé, car un ancien `index.html` encore en cache sur un téléphone lit toujours via GET, ce qui rendait le contournement réellement atteignable.)*
- **Changement de PIN (`changePin`, v115 du 2026-08-06)** : le PIN actuel n'est exigé **que si le compte a déjà un PIN personnel**. Tant qu'il est resté au défaut `0000` — valeur publique —, le redemander ne protège rien et **cassait la personnalisation du PIN** pour tout frontend publié avant l'ajout de cette exigence (voir §Incident ci-dessous). La session en cours **n'est plus révoquée** : la feuille n'ayant qu'une seule colonne `Token`, « révoquer tous les tokens » ne déconnectait que l'appelant lui-même, sans gain de sécurité — la rotation se fait naturellement à la reconnexion. Un nouveau PIN identique à l'ancien est refusé (sinon `mustChangePin` restait vrai et l'utilisateur rebouclait sans comprendre).

> **Incident du 2026-08-06 — boucle de réinitialisation du PIN.** Le backend `@114` exigeait `currentPin` sur `changePin`, alors que le frontend **publié sur GitHub Pages** ne l'envoyait pas (le correctif frontend existait en local mais n'avait jamais été publié). Conséquence en production : `changePin` répondait « PIN actuel requis », le frontend ignorait l'échec et ouvrait quand même la session, le PIN restait `0000` — et à chaque reconnexion l'utilisateur repassait par l'écran de personnalisation, sans jamais pouvoir en sortir. Ces comptes étaient de plus bloqués en écriture par le verrou `mustChangePin` de `doPost`. **Leçon : un durcissement backend qui ajoute un champ obligatoire à une requête est un changement cassant ; il doit soit être déployé avec le frontend correspondant, soit rester tolérant à l'ancien format.**
- Chaque action POST/GET est classée `CHEF_ONLY` (`deleteClient`, `deleteIntervention`, `saveClient`, `saveClientLs`, `mergeClientsLs`), `CHEF_READ` (`getAll`, `getClientHistory`, `getClientsResilies`) ou `ADMIN_ONLY` (gestion utilisateurs + réparations), vérifiée serveur-side avant exécution — jamais uniquement côté UI.
- **`getClients` est ouvert à tous les rôles**, technicien compris : la vue Terrain s'en sert pour l'autofill et la fusion GPS. `doGet` et `doPost` sont alignés sur ce point depuis le 2026-08-06 (auparavant `doGet` le bloquait pour le technicien, sans rien protéger puisque la même donnée restait accessible via POST).
- **Anti-injection de formule Sheets (CWE-1236)** : `protegerCellule_` (`= + - @`) pour les champs libres, `protegerChampStrict_` (`= @` seulement, pour préserver les téléphones `+237…`) pour les champs clients ; `depolluer_` retire le préfixe à la lecture.
- **Échappement HTML systématique** côté frontend sur toutes les données utilisateur rendues, pour fermer la XSS stockée.
- Un ping léger (`warmupBackend`, throttlé à 2 min) réveille le conteneur Apps Script dès l'affichage de l'écran de connexion, pour absorber le cold start (10-30 s) pendant que l'utilisateur tape son matricule plutôt qu'après le clic.

## 3. Modèle de données (Google Sheet)

7 feuilles, toutes indexées dynamiquement par nom d'en-tête (jamais par position) :

| Feuille | Clé | Contenu notable |
|---|---|---|
| **Consistances** | `ID_Consistance` (`C_YYYYMMDD`) | Une ligne par jour : `Nb_Interventions`, `Realisees`, `Instances` — ces deux derniers sont une **photo de fin de journée** reconstruite (pas un compteur incrémental) |
| **Interventions** | `ID_Intervention` | `Type`, `Numero_Ligne`, `Statut`, `Panne` (colonne dédiée depuis migration), `Remarque`, `Reporté_depuis`, `Ville`, `Quartier`, `Duree_Jours` (legacy), `Publié_par`/`Statut_par` (audit) |
| **Clients FTTH** / **Clients Cuivre** | `Numero` | Mêmes colonnes, service = la feuille elle-même. GPS y vit, pas sur l'intervention |
| **Clients LS** | `Nom+Ville+Quartier` normalisés (`nomKeyLs_`) | Pas de numéro de ligne ; colonne `POP` propre au LS |
| **Clients Résiliés** | archive | Superset de colonnes + `Service` d'origine, `Motif`, `Date_Resiliation`, `Resilie_Par` |
| **Utilisateurs** | `ID` (matricule) | `PIN_Hash`, `Role` (CSV), `Actif`, `Token`, `Token_Expire` |
| **_Config** (cachée) | — | 4 marqueurs anti-doublon : `B1`=dernière sauvegarde hebdo, `B2`=ID du classeur KPI converti, `B3`=dernier mois KPI généré, `B4`=throttle quotidien du report |

## 4. Écrans frontend

### Chef — saisie consistance
8 types d'intervention avec formulaires indépendants, câblés à la main (`f1*`…`f8*`) : Étude FTTH, Installation FTTH, Dérangement FTTH, Dérangement Cuivre, Étude LS, Dérangement LS, Installation LS, **Résiliation** (un seul formulaire pour les 3 réseaux : le service est **auto-détecté** — `detecterServiceResil()` — depuis le numéro saisi ou depuis nom+ville+quartier pour le LS, badge coloré affiché en temps réel).

- Autofill instantané depuis un cache client en mémoire (`onNumInput` → `lookupClientLocal`), y compris pré-remplissage du numéro secondaire.
- Détection de quartier tolérante aux fautes de frappe (Levenshtein, 1-2 fautes tolérées selon la longueur) contre une liste de ~40 quartiers de Bafoussam, avec modale de suggestion si rien ne matche.
- Détection de doublon (même numéro déjà actif) avant ajout à la liste d'attente (`pending[]`), avec confirmation.
- Détection de changement de fiche client (nom/tel/loc/ville différents de la BD) → modale de confirmation avant écrasement.
- Prévisualisation groupée par type avant publication (`renderPreview`), édition/suppression d'une ligne en attente, publication en un seul appel `saveConsistance`.

### Terrain
Fiche du jour, vue par type ou par quartier, 3 filtres croisés cumulables (quartier/statut/type) avec compteurs recalculés dynamiquement en ignorant leur propre filtre, plus une recherche texte. Champs structurés spécifiques :
- **Étude FTTH** : FDT/FAT/distance/conclusion FAVORABLE-DÉFAVORABLE, encodés dans la Remarque via un mini-format `clé: valeur • clé: valeur`.
- **Dérangement FTTH** : liste de 9 natures de panne, colonne dédiée.

Passage à "Réalisé" bloqué tant que ces champs obligatoires ne sont pas remplis. Capture GPS géoloc native, écriture directe sur la fiche Client (ou sur Clients LS par nom si pas de numéro).

### Historique
Consomme `getAll` (dédupliqué), sélecteur de mois, stats (total/réalisées/instances/taux/durée moyenne), mêmes filtres croisés + filtre par nature de panne, cache localStorage par mois (stale-while-revalidate).

### Clients
4 onglets (FTTH / Cuivre / LS / Résiliés — ce dernier chef-only), recherche texte, historique par client en modale, fusion de fiches LS en doublon (détection Levenshtein + inclusion de chaînes, restreinte à même ville+quartier).

### Admin
Gestion utilisateurs (création, rôles multiples, reset PIN, activation/désactivation, suppression — sauf soi-même), ajout direct d'un client en base sans créer d'intervention, boutons de réparation en masse (`adminRepairAgregats`, `adminRepairBase`), et une vue Terrain en lecture seule (audit : qui a publié/mis à jour quoi, bouton suppression).

## 5. Logique métier backend clé

- **`withEcritureLock_`** : toutes les écritures en lecture-modif-écriture passent par ce verrou `LockService` (échec → `{success:false, retry:true}`, le frontend réessaie). Couvre les 8 points d'entrée : `saveConsistance`, `updateStatus`, `deleteIntervention`, `deleteClient`, `fusionnerClientsLs`, `saveClient`, `saveClientLs`, `updateClientGPS` *(ces 3 derniers ajoutés le 2026-08-06)*. **Le verrou se pose au point d'entrée, jamais dans un helper interne** : `upsertClientLs_` est appelé à la fois par `saveClientLs` et par `saveConsistance` (qui détient déjà le verrou) — l'y placer ferait échouer l'acquisition, `LockService.getScriptLock()` rendant un nouvel objet `Lock` non ré-entrant à chaque appel.
- **`calculerDuree`** : jours ouvrés entre `Reporté_depuis` et (date de résolution si Réalisé, sinon aujourd'hui) − 1, recalculé à chaque lecture, jamais fait confiance à un compteur stocké.
- **`reporterInterventionsEnAttente`** (trigger 1h + filet de sécurité à chaque `getByDate`) : déplace physiquement chaque intervention non résolue vers le prochain jour ouvré, throttlé à une fois par jour via le marqueur `_Config!B4` (sinon chaque appel relisait toute la feuille — cause du ralentissement corrigée le 23/07).
- **`recalculerAgregatsMois`** : reconstruit `Nb_Interventions`/`Realisees`/`Instances` par **présence photo de fin de journée** (une intervention d'origine O réalisée le jour C est comptée en instance de O à C-1, réalisée en C) — jamais depuis les lignes physiques restantes, qui seraient faussées par les déplacements du report automatique.
- **Dédoublonnage mensuel** (`getAll`) : clé `nom|num|type`, garde le statut le plus avancé (`statutPoids` : Réalisé=4 > Problème=3 > Injoignable=2 > En attente=1), conserve la date d'origine la plus ancienne pour le calcul de durée.
- **Dédoublonnage tout-historique d'un client** (`getClientHistory`) : clé `type|origine` — deux dérangements séparés dans le temps restent deux entrées, contrairement à `getAll` qui est borné au mois.
- **Résiliation** : publiée directement `Réalisé`, archive immédiatement la fiche client vers "Clients Résiliés" (`archiverClientResilie_`) sans toucher aux interventions passées (historique préservé).
- **Sauvegarde hebdomadaire** : chaque dimanche, copie complète du classeur vers Drive (`AUTOSAVE_FOLDER_ID`), marqueur anti-doublon dans `_Config!B1`.
- **KPI mensuel** : à partir de juillet 2026, génère un onglet dans un classeur Drive dédié (converti .xlsx→Sheets au premier appel) avec répartition FTTH/Cuivre × Études/Installation/Dérangements/Résiliations × Reports/Signalés/Traités/Instances, par ville (Bafoussam/Bandjoun/Baham/Foumbot) + récapitulatif — déclenché automatiquement par le trigger nocturne au changement de mois.
- **Graveyard de fonctions `reparer*`/`migrer*`** en fin de fichier : migrations one-shot déjà exécutées (séparation Clients FTTH/Cuivre, extraction colonne Panne, suppression colonne Chef, reprise historique LS…), conservées comme preuve forensique, pas comme modèle à suivre.

## 6. PWA / offline

- Cache localStorage stale-while-revalidate pour Terrain, Historique (par mois) et Clients — affichage instantané puis rafraîchissement réseau silencieux.
- File d'attente offline (`ceraf_status_queue`) pour les mises à jour de statut faites sans réseau, rejouée automatiquement au retour en ligne.
- Pull-to-refresh tactile avec seuil et amortissement, désactivé sur l'écran de saisie chef (pour ne pas perdre les interventions non publiées) et pendant qu'une modale est ouverte.
- Service worker en network-first, sans rechargement auto sur `controllerchange` (bug de boucle infinie déjà rencontré et évité).

## 7. Déploiement

Backend géré via `clasp` : `clasp push --force` → `clasp version` → `clasp deploy -i <deploymentId>` sur le déploiement de production existant (jamais sans `-i`, ce qui créerait une nouvelle URL et casserait l'app pour tous les utilisateurs déjà configurés). Pas d'environnement de staging ni de suite de tests automatisée — vérification par `curl` direct sur l'URL live après chaque changement.
