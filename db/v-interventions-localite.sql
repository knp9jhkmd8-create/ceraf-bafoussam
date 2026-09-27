-- ============================================================================
--  v_interventions : localité de la fiche client (2026-09-27)
--
--  L'écran admin « Corriger une intervention » corrige aussi la localité, qui
--  vit sur la fiche client (FTTH/Cuivre ou LS). La vue ne la renvoyait pas.
--  Colonne AJOUTÉE EN FIN (seule évolution que CREATE OR REPLACE VIEW permet).
--  Reprend db/splitter-port.sql à l'identique pour le reste.
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
       i.motif_renvoi,
       cl.splitter,
       cl.port,
       coalesce(cl.localite, nullif(ls.localite, ''), '')              AS localite_fiche
  FROM interventions i
  LEFT JOIN clients cl ON cl.numero = i.numero_ligne AND cl.supprime_le IS NULL
  LEFT JOIN clients_ls ls
         ON i.service = 'LS' AND ls.supprime_le IS NULL
        AND ls.cle_normalisee = lower(trim(i.nom_client)) || '|'
                             || lower(trim(coalesce(i.ville, ''))) || '|'
                             || lower(trim(coalesce(i.quartier, '')))
 WHERE i.supprime_le IS NULL;
