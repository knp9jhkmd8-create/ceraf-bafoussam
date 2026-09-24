-- ============================================================================
--  Splitter et port d'un client FTTH (2026-09-24)
--
--  À l'installation, le client est validé sur un splitter (1 ou 2) et un port
--  (1 à 8) du FAT. Comme FDT/FAT, c'est une propriété de la LIGNE, pas de la
--  visite : colonnes de `clients`. Facultatives (NULL = pas encore relevé).
--  Affichage « S2/P4 » construit par le frontend, jamais stocké tel quel.
--
--  v_interventions : colonnes AJOUTÉES EN FIN (CREATE OR REPLACE VIEW n'autorise
--  que cela). Reprend la jointure clients_ls de db/v-interventions-ls.sql.
-- ============================================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS splitter smallint CHECK (splitter BETWEEN 1 AND 2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS port     smallint CHECK (port BETWEEN 1 AND 8);

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
       cl.port
  FROM interventions i
  LEFT JOIN clients cl ON cl.numero = i.numero_ligne AND cl.supprime_le IS NULL
  LEFT JOIN clients_ls ls
         ON i.service = 'LS' AND ls.supprime_le IS NULL
        AND ls.cle_normalisee = lower(trim(i.nom_client)) || '|'
                             || lower(trim(coalesce(i.ville, ''))) || '|'
                             || lower(trim(coalesce(i.quartier, '')))
 WHERE i.supprime_le IS NULL;
