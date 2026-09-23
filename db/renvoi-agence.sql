-- ============================================================================
--  Statut « Renvoyé à l'agence » (2026-09-24)
--
--  Cas d'origine : une installation prévue, le client a déménagé entre l'étude
--  et le passage de l'équipe. L'entreprise renvoie alors la fiche à l'agence
--  commerciale. Aucun des quatre statuts ne convenait :
--    - En attente / Injoignable / Problème : reportés chaque nuit, sans fin ;
--    - Réalisé : faux, et gonfle le taux de réalisation ;
--    - supprimer : efface la trace du déplacement.
--
--  Le nouveau statut est un statut CLOS, au même titre que « Réalisé » : le
--  report nocturne ne le déplace plus et sa durée s'arrête. Mais il n'est PAS
--  une réalisation — il est compté à part. D'où `statut_clos()` : un seul
--  endroit qui dit « cette intervention est terminée », au lieu de répéter
--  `statut <> 'Réalisé'` dans chaque fonction.
--
--  Le motif (Client a déménagé / Refus du client / Adresse introuvable / Autre)
--  a sa propre colonne : il est obligatoire, et doit survivre aux éditions de la
--  remarque libre.
--
--  ⚠️ À exécuter INSTRUCTION PAR INSTRUCTION, pas en une transaction : une
--  valeur ajoutée à un enum n'est utilisable qu'après validation de la
--  transaction qui l'a créée.
-- ============================================================================

ALTER TYPE statut_t ADD VALUE IF NOT EXISTS 'Renvoyé à l''agence';

ALTER TABLE interventions ADD COLUMN IF NOT EXISTS motif_renvoi text;

CREATE OR REPLACE FUNCTION statut_clos(s statut_t)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT s IN ('Réalisé'::statut_t, 'Renvoyé à l''agence'::statut_t);
$$;

CREATE OR REPLACE FUNCTION duree_intervention(reporte_depuis date, date_ligne date, statut statut_t)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT greatest(jours_ouvres(coalesce(reporte_depuis, date_ligne),
    CASE WHEN statut_clos(statut) THEN date_ligne ELSE date_locale() END) - 1, 0);
$$;

CREATE OR REPLACE FUNCTION duree_dans_mois(reporte_depuis date, date_ligne date, statut statut_t, mois date)
RETURNS integer LANGUAGE sql STABLE AS $$
  -- Durée RAMENÉE AU MOIS demandé (voir schema.sql). Arrêtée à la date de la
  -- ligne pour tout statut clos, pas seulement « Réalisé ».
  SELECT greatest(
    jours_ouvres(
      greatest(coalesce(reporte_depuis, date_ligne), mois),
      least(
        CASE WHEN statut_clos(statut) THEN date_ligne ELSE date_locale() END,
        (mois + interval '1 month' - interval '1 day')::date
      )
    ) - 1,
  0);
$$;

CREATE OR REPLACE FUNCTION reporter_interventions()
RETURNS TABLE(reportees integer, vers date) LANGUAGE plpgsql AS $fn$
DECLARE
  n integer := 0;
  cible_min date;
  aujourdhui date := date_locale();
BEGIN
  INSERT INTO consistances (id, date)
  SELECT DISTINCT 'C_' || to_char(c.cible, 'YYYYMMDD'), c.cible
    FROM (SELECT GREATEST(prochain_jour_ouvre(i.date), jour_ouvre_ou_suivant(aujourdhui)) AS cible
            FROM interventions i
           WHERE i.supprime_le IS NULL AND NOT statut_clos(i.statut) AND i.date < aujourdhui) c
  ON CONFLICT (date) DO NOTHING;

  WITH a AS (
    SELECT i.id,
           GREATEST(prochain_jour_ouvre(i.date), jour_ouvre_ou_suivant(aujourdhui)) AS cible,
           COALESCE(i.reporte_depuis, i.date) AS origine
      FROM interventions i
     WHERE i.supprime_le IS NULL AND NOT statut_clos(i.statut) AND i.date < aujourdhui
  ), maj AS (
    UPDATE interventions i
       SET date           = a.cible,
           consistance_id = c.id,
           statut         = CASE WHEN i.statut = 'Problème'::statut_t
                                 THEN 'Problème'::statut_t
                                 ELSE 'En attente'::statut_t END,
           reporte_depuis = a.origine,
           mis_a_jour_le  = now()
      FROM a JOIN consistances c ON c.date = a.cible
     WHERE i.id = a.id
     RETURNING a.cible AS cible
  )
  SELECT count(*)::integer, min(cible) INTO n, cible_min FROM maj;

  RETURN QUERY SELECT COALESCE(n, 0), cible_min;
END;
$fn$;

-- Colonnes AJOUTÉES EN FIN de liste uniquement (CREATE OR REPLACE VIEW refuse
-- tout autre changement). `instances` = ce qui reste à faire : un renvoi n'en
-- fait plus partie.
CREATE OR REPLACE VIEW v_consistances AS
SELECT c.id,
       c.date,
       c.publie_par,
       count(i.id) FILTER (WHERE i.supprime_le IS NULL)                                   AS nb_interventions,
       count(i.id) FILTER (WHERE i.supprime_le IS NULL AND i.statut = 'Réalisé')          AS realisees,
       count(i.id) FILTER (WHERE i.supprime_le IS NULL AND NOT statut_clos(i.statut))     AS instances,
       count(i.id) FILTER (WHERE i.supprime_le IS NULL AND i.statut = 'Renvoyé à l''agence') AS renvoyees
  FROM consistances c
  LEFT JOIN interventions i ON i.consistance_id = c.id
 WHERE c.supprime_le IS NULL
 GROUP BY c.id, c.date, c.publie_par;

CREATE OR REPLACE VIEW v_interventions AS
SELECT i.id, i.consistance_id, i.date, i.type, i.service, i.numero_ligne, i.nom_client,
       i.statut, i.panne, i.remarque, i.reporte_depuis, i.ville, i.quartier, i.publie_par,
       i.statut_par, i.mis_a_jour_le, i.client_request_id, i.supprime_le,
       duree_intervention(i.reporte_depuis, i.date, i.statut) AS duree,
       coalesce(cl.gps, '')             AS gps,
       coalesce(cl.telephone, '')       AS tel,
       coalesce(cl.tel_secondaire, '')  AS tel_sec,
       cl.fdt,
       cl.fat,
       i.motif_renvoi
  FROM interventions i
  LEFT JOIN clients cl ON cl.numero = i.numero_ligne AND cl.supprime_le IS NULL
 WHERE i.supprime_le IS NULL;
