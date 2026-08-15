-- ============================================================================
--  CERAF Bafoussam — schéma PostgreSQL (Neon)
--  Migration depuis le Google Sheet à 6 onglets. Voir docs/MIGRATION-NEON.md.
--
--  Trois principes repris du backend Apps Script, et un abandon assumé :
--   1. La durée d'une intervention est CALCULÉE à la lecture, jamais stockée
--      (un compteur incrémental diverge dès qu'un déclencheur nocturne saute —
--      c'est arrivé). Voir la fonction jours_ouvres() plus bas.
--   2. Les rôles sont vérifiés côté serveur, jamais déduits du client.
--   3. Une suppression est un archivage (supprime_le), jamais un DELETE sec.
--   4. ABANDONNÉ : le découpage « Clients FTTH » / « Clients Cuivre » en deux
--      onglets n'existait que parce qu'une feuille n'a pas d'index. Ici c'est
--      une colonne `service` — ce qui supprime au passage toute la logique de
--      reclassement (trouverClientRow_, clientsSheets_, sheetForService_).
-- ============================================================================

BEGIN;

-- ── Types ──────────────────────────────────────────────────────────────────
CREATE TYPE service_t AS ENUM ('FTTH', 'CUIVRE', 'LS');
CREATE TYPE statut_t  AS ENUM ('En attente', 'Injoignable', 'Problème', 'Réalisé');
CREATE TYPE role_t    AS ENUM ('admin', 'chef', 'technicien');

-- ============================================================================
--  UTILISATEURS
--  Le PIN est repris TEL QUEL depuis la feuille : SHA-256 de (pin + ':' + sel)
--  stocké au format "<hash>:<sel>", reproductible à l'identique en Node.
--  ⚠️ NE JAMAIS réinitialiser les PIN à la migration — ce serait rejouer
--  l'incident de boucle du 2026-08-06, en pire.
-- ============================================================================
CREATE TABLE utilisateurs (
  matricule           text PRIMARY KEY,
  nom                 text NOT NULL,
  pin_hash            text NOT NULL,
  roles               role_t[] NOT NULL CHECK (cardinality(roles) > 0),
  actif               boolean NOT NULL DEFAULT true,
  derniere_connexion  timestamptz,
  cree_le             timestamptz NOT NULL DEFAULT now(),
  supprime_le         timestamptz
);
CREATE INDEX ON utilisateurs (actif) WHERE supprime_le IS NULL;

-- ============================================================================
--  SESSIONS
--  La feuille n'avait qu'UNE colonne Token par utilisateur : se connecter sur
--  un 2e appareil déconnectait le 1er, et « révoquer tous les tokens » ne
--  pouvait déconnecter que l'appelant lui-même — c'est pourquoi changePin a dû
--  renoncer à révoquer (v115). Une vraie table rend la révocation correcte.
--  On stocke un HASH du token, pas le token : une fuite de la base ne donne
--  pas de sessions utilisables.
-- ============================================================================
CREATE TABLE sessions (
  id            bigserial PRIMARY KEY,
  token_hash    text NOT NULL UNIQUE,
  matricule     text NOT NULL REFERENCES utilisateurs(matricule) ON DELETE CASCADE,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  expire_le     timestamptz NOT NULL,
  dernier_acces timestamptz NOT NULL DEFAULT now(),
  appareil      text,
  revoquee_le   timestamptz
);
CREATE INDEX ON sessions (matricule) WHERE revoquee_le IS NULL;
CREATE INDEX ON sessions (expire_le) WHERE revoquee_le IS NULL;

-- ============================================================================
--  CONSISTANCES — une ligne par jour (la « fiche du jour »)
-- ============================================================================
CREATE TABLE consistances (
  id               text PRIMARY KEY,           -- ex. « C_20260806 », repris tel quel
  date             date NOT NULL UNIQUE,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  publie_par       text REFERENCES utilisateurs(matricule),
  supprime_le      timestamptz
);
-- nb_interventions / realisees / instances étaient des AGRÉGATS STOCKÉS dans la
-- feuille, recalculés par recalculerAgregatsMois() — et donc régulièrement
-- désynchronisés (d'où les fonctions reparerAgregatsMensuels). En SQL ils se
-- comptent à la lecture : on ne les stocke plus. Voir la vue v_consistances.

-- ============================================================================
--  INTERVENTIONS
-- ============================================================================
CREATE TABLE interventions (
  id                text PRIMARY KEY,
  consistance_id    text NOT NULL REFERENCES consistances(id) ON DELETE CASCADE,
  date              date NOT NULL,
  type              text NOT NULL,
  service           service_t NOT NULL,        -- dérivé du type (typeToService)
  numero_ligne      text,                      -- NULL pour le LS : pas de numéro
  nom_client        text NOT NULL,
  statut            statut_t NOT NULL DEFAULT 'En attente',
  panne             text,
  remarque          text,
  -- Date d'ORIGINE de la 1re occurrence, portée à travers toute la chaîne de
  -- reports. C'est la seule source de vérité pour la durée.
  reporte_depuis    date,
  ville             text,
  quartier          text,
  publie_par        text REFERENCES utilisateurs(matricule),
  statut_par        text REFERENCES utilisateurs(matricule),
  mis_a_jour_le     timestamptz NOT NULL DEFAULT now(),
  -- Rend la publication IDEMPOTENTE : saveConsistance faisait des appendRow
  -- avec un ID Date.now()+idx, donc un rejeu après timeout DUPLIQUAIT la fiche
  -- du jour. Le front génère UN identifiant par publication et le conserve
  -- pendant ses retries ; le backend le suffixe par le rang de l'intervention
  -- dans le lot (« <uuid>:<idx> »). D'où `text` et non `uuid` : la valeur
  -- porte ce suffixe.
  client_request_id text UNIQUE,
  supprime_le       timestamptz
);
CREATE INDEX ON interventions (date)                WHERE supprime_le IS NULL;
CREATE INDEX ON interventions (consistance_id)      WHERE supprime_le IS NULL;
CREATE INDEX ON interventions (statut)              WHERE supprime_le IS NULL;
CREATE INDEX ON interventions (numero_ligne)        WHERE supprime_le IS NULL;
-- Pas d'index sur date_trunc('month', date) : une requête mensuelle s'écrit
-- « date >= début AND date < début + 1 mois » et utilise l'index (date)
-- ci-dessus. Un index fonctionnel serait redondant, et date_trunc sur un
-- timestamptz n'est pas IMMUTABLE (il dépend du fuseau).

-- ============================================================================
--  CLIENTS FTTH + CUIVRE — les deux onglets fusionnés
--  Le numéro de ligne est la clé : il vit dans exactement un service, et
--  changer de service est un simple UPDATE au lieu d'un déplacement de ligne.
--  Noms stockés en MAJUSCULES (convention existante, conservée).
-- ============================================================================
CREATE TABLE clients (
  numero               text PRIMARY KEY,
  service              service_t NOT NULL CHECK (service IN ('FTTH', 'CUIVRE')),
  nom                  text NOT NULL,
  telephone            text,
  tel_secondaire       text,
  localite             text,
  ville                text,
  quartier             text,
  gps                  text,                   -- « lat,lon », saisi au terrain
  -- Repère réseau FTTH, renseigné à l'Installation ou corrigé par l'admin.
  -- Sans objet pour le Cuivre (colonnes présentes mais toujours NULL).
  fdt                  text,                   -- ex. « FDT-1 »
  fat                  text,                   -- ex. « FAT-12 »
  distance_fat_client  integer,                -- mètres, saisi par l'admin uniquement
  derniere_maj         timestamptz NOT NULL DEFAULT now(),
  supprime_le          timestamptz
);
CREATE INDEX ON clients (service)  WHERE supprime_le IS NULL;
CREATE INDEX ON clients (quartier) WHERE supprime_le IS NULL;

-- ============================================================================
--  ÉTUDES FTTH — une étude ne crée volontairement aucune fiche client (pas
--  encore de ligne attribuée, décision du 2026-08-07, voir estEtude dans
--  saveConsistance). Avant cette table, tout ce qui était recueilli à
--  l'étude (téléphone, localité, FDT, FAT, distance FAT-client, conclusion)
--  ne vivait qu'en texte libre dans interventions.remarque — perdu de vue
--  dès que l'intervention sortait de l'historique actif. Cette table le
--  préserve indépendamment, sans rien présumer du lien futur vers un client
--  éventuel (numero_ligne sur interventions reste le candidat naturel pour
--  cette jointure, à construire plus tard).
--
--  intervention_id est une clé stable : le report nocturne déplace la ligne
--  en GARDANT son id (voir reporter_interventions() plus bas) — une étude
--  encore ouverte garde donc la même clé tant qu'elle n'est pas Réalisée.
--  Pas de colonnes date/nom/ville/quartier ici : déjà sur interventions,
--  les dupliquer désynchroniserait au report nocturne.
-- ============================================================================
CREATE TABLE etudes_ftth (
  intervention_id      text PRIMARY KEY REFERENCES interventions(id) ON DELETE CASCADE,
  telephone            text,
  tel_secondaire       text,
  localite             text,
  fdt                  text,
  fat                  text,
  distance_fat_client  integer,               -- mètres
  conclusion           text,                  -- FAVORABLE / DEFAVORABLE
  note                 text,
  cree_le              timestamptz NOT NULL DEFAULT now(),
  maj_le               timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
--  CLIENTS LS — pas de numéro de ligne, le nom est le seul champ obligatoire.
--  Clé métier = (nom, ville, quartier) normalisés — reprise de nomKeyLs_.
-- ============================================================================
CREATE TABLE clients_ls (
  id              bigserial PRIMARY KEY,
  nom             text NOT NULL,
  telephone       text,
  tel_secondaire  text,
  localite        text,
  ville           text,
  quartier        text,
  pop             text,
  gps             text,
  derniere_maj    timestamptz NOT NULL DEFAULT now(),
  supprime_le     timestamptz,
  -- Colonne générée : la clé de dédoublonnage est calculée par la base, elle ne
  -- peut donc pas diverger de son entrée comme le faisait nomKeyLs_ côté JS.
  cle_normalisee  text GENERATED ALWAYS AS (
    lower(trim(nom)) || '|' || lower(trim(coalesce(ville, ''))) || '|' || lower(trim(coalesce(quartier, '')))
  ) STORED
);
CREATE UNIQUE INDEX ON clients_ls (cle_normalisee) WHERE supprime_le IS NULL;

-- ============================================================================
--  CLIENTS RÉSILIÉS — archive, tous services confondus
-- ============================================================================
CREATE TABLE clients_resilies (
  id                bigserial PRIMARY KEY,
  service           service_t NOT NULL,
  numero            text,
  nom               text NOT NULL,
  telephone         text,
  tel_secondaire    text,
  localite          text,
  ville             text,
  quartier          text,
  pop               text,
  gps               text,
  motif             text,
  date_resiliation  timestamptz NOT NULL DEFAULT now(),
  resilie_par       text REFERENCES utilisateurs(matricule),
  derniere_maj      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON clients_resilies (numero);
CREATE INDEX ON clients_resilies (date_resiliation);

-- ============================================================================
--  AUDIT_LOG — alimenté au POINT DE DISPATCH, pas dans chaque action.
--  Toutes les mutations passent par le même endroit : il est donc impossible
--  d'en oublier une. C'est ce qui alimente l'onglet Audit du super admin, et
--  c'est ce que le Google Sheet ne fournissait pas (personne ne savait qui
--  avait corrigé quoi à la main).
-- ============================================================================
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  matricule   text REFERENCES utilisateurs(matricule),
  role_actif  role_t,
  action      text NOT NULL,
  entite      text,
  entite_id   text,
  avant       jsonb,
  apres       jsonb,
  succes      boolean NOT NULL,
  erreur      text,
  ip          inet
);
CREATE INDEX ON audit_log (ts DESC);
CREATE INDEX ON audit_log (matricule, ts DESC);
CREATE INDEX ON audit_log (entite, entite_id);

-- ============================================================================
--  JOURS OUVRÉS — équivalent SQL de joursOuvres() / calculerDuree().
--  La durée reste CALCULÉE, jamais stockée : c'est la leçon du compteur
--  Duree_Jours qui divergeait silencieusement.
--  Convention identique à l'existant : jours ouvrés entre origine et fin,
--  moins un. Samedi/dimanche exclus.
-- ============================================================================
CREATE OR REPLACE FUNCTION jours_ouvres(debut date, fin date)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN debut IS NULL OR fin IS NULL OR fin < debut THEN 0
    ELSE (SELECT count(*)::integer
            FROM generate_series(debut, fin, interval '1 day') AS j
           WHERE extract(isodow FROM j) < 6)
  END;
$$;

-- Postgres tourne en UTC, l'équipe est en UTC+1 : entre minuit et 1 h locale,
-- `current_date` renvoie encore la veille et la fiche du jour paraît vide.
-- D'où une date locale EXPLICITE — ne jamais revenir à `current_date` ici.
CREATE OR REPLACE FUNCTION date_locale()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Africa/Douala')::date;
$$;

CREATE OR REPLACE FUNCTION duree_intervention(reporte_depuis date, date_ligne date, statut statut_t)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT greatest(
    jours_ouvres(
      coalesce(reporte_depuis, date_ligne),
      CASE WHEN statut = 'Réalisé' THEN date_ligne ELSE date_locale() END
    ) - 1,
    0);
$$;

-- Durée RAMENÉE AU MOIS demandé, pour la statistique de l'onglet Historique :
-- le compteur d'un dossier hérité du mois précédent repart au 1er du mois, et
-- s'arrête au dernier jour du mois pour un mois déjà écoulé.
--   début = max(origine réelle, 1er du mois)
--   fin   = min(résolution si Réalisé sinon aujourd'hui, fin du mois)
--
-- Distincte de duree_intervention(), qui donne la durée VRAIE depuis l'origine
-- et reste la valeur affichée sur chaque intervention. Les deux coexistent
-- volontairement : « depuis combien de temps ce dossier traîne » et « combien
-- de temps il a occupé ce mois-ci » sont deux questions différentes, et seule
-- la seconde permet de comparer les mois entre eux.
CREATE OR REPLACE FUNCTION duree_dans_mois(reporte_depuis date, date_ligne date, statut statut_t, mois date)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT greatest(
    jours_ouvres(
      greatest(coalesce(reporte_depuis, date_ligne), mois),
      least(
        CASE WHEN statut = 'Réalisé' THEN date_ligne ELSE date_locale() END,
        (mois + interval '1 month' - interval '1 day')::date
      )
    ) - 1,
    0);
$$;

-- ============================================================================
--  VUES — les agrégats qui étaient stockés (et divergeaient) sont désormais
--  comptés à la lecture.
-- ============================================================================
CREATE VIEW v_consistances AS
SELECT c.id,
       c.date,
       c.publie_par,
       -- count(i.id) et non count(i.*) : avec un LEFT JOIN sans correspondance,
       -- la ligne composite est entièrement NULL et count(i.*) est ambigu.
       count(i.id) FILTER (WHERE i.supprime_le IS NULL)                             AS nb_interventions,
       count(i.id) FILTER (WHERE i.supprime_le IS NULL AND i.statut = 'Réalisé')    AS realisees,
       count(i.id) FILTER (WHERE i.supprime_le IS NULL AND i.statut <> 'Réalisé')   AS instances
  FROM consistances c
  LEFT JOIN interventions i ON i.consistance_id = c.id
 WHERE c.supprime_le IS NULL
 GROUP BY c.id, c.date, c.publie_par;

-- Interventions enrichies : GPS/téléphone fusionnés depuis la fiche client
-- (ces champs vivent sur le client, pas sur l'intervention — comportement
-- repris de getClientsJoinMap) et durée calculée. Ce JOIN remplace les deux
-- lectures de feuilles entières que faisait chaque getByDate.
--
-- Colonnes explicites plutôt que `i.*` : CREATE OR REPLACE VIEW refuse de
-- renommer une colonne existante en place, seul un AJOUT en fin de liste est
-- permis — toute évolution future de cette vue doit continuer à ajouter les
-- nouvelles colonnes à la fin, jamais au milieu.
CREATE VIEW v_interventions AS
SELECT i.id, i.consistance_id, i.date, i.type, i.service, i.numero_ligne, i.nom_client,
       i.statut, i.panne, i.remarque, i.reporte_depuis, i.ville, i.quartier, i.publie_par,
       i.statut_par, i.mis_a_jour_le, i.client_request_id, i.supprime_le,
       duree_intervention(i.reporte_depuis, i.date, i.statut) AS duree,
       coalesce(cl.gps, '')             AS gps,
       coalesce(cl.telephone, '')       AS tel,
       coalesce(cl.tel_secondaire, '')  AS tel_sec,
       cl.fdt,
       cl.fat
  FROM interventions i
  LEFT JOIN clients cl ON cl.numero = i.numero_ligne AND cl.supprime_le IS NULL
 WHERE i.supprime_le IS NULL;

COMMIT;
