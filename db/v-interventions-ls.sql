-- ============================================================================
--  v_interventions : GPS et téléphones des clients LS (2026-09-24)
--
--  La vue ne joignait que `clients` (FTTH/Cuivre, par numéro de ligne). Une
--  intervention LS n'a pas de numéro : son GPS, enregistré sur `clients_ls`,
--  revenait donc TOUJOURS vide à la lecture — le technicien le saisissait,
--  l'enregistrement réussissait, et il avait disparu au rechargement.
--
--  Jointure par la clé métier LS (nom|ville|quartier, identique à la colonne
--  générée clients_ls.cle_normalisee). Mêmes colonnes, même ordre : seule leur
--  source change, ce que CREATE OR REPLACE VIEW autorise.
-- ============================================================================
CREATE OR REPLACE VIEW v_interventions AS
SELECT i.id, i.consistance_id, i.date, i.type, i.service, i.numero_ligne, i.nom_client,
       i.statut, i.panne, i.remarque, i.reporte_depuis, i.ville, i.quartier, i.publie_par,
       i.statut_par, i.mis_a_jour_le, i.client_request_id, i.supprime_le,
       duree_intervention(i.reporte_depuis, i.date, i.statut) AS duree,
       coalesce(cl.gps, nullif(ls.gps, ''), '')                        AS gps,
       coalesce(cl.telephone, nullif(ls.telephone, ''), '')            AS tel,
       coalesce(cl.tel_secondaire, nullif(ls.tel_secondaire, ''), '')  AS tel_sec,
       cl.fdt,
       cl.fat,
       i.motif_renvoi
  FROM interventions i
  LEFT JOIN clients cl ON cl.numero = i.numero_ligne AND cl.supprime_le IS NULL
  LEFT JOIN clients_ls ls
         ON i.service = 'LS' AND ls.supprime_le IS NULL
        AND ls.cle_normalisee = lower(trim(i.nom_client)) || '|'
                             || lower(trim(coalesce(i.ville, ''))) || '|'
                             || lower(trim(coalesce(i.quartier, '')))
 WHERE i.supprime_le IS NULL;
