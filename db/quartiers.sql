-- ============================================================================
--  Quartiers — la liste sort du code
--
--  Elle vivait dans un tableau figé d'index.html (QUARTIERS_BAFOUSSAM). Deux
--  conséquences : l'administrateur ne pouvait ni en ajouter ni en corriger un
--  sans déploiement, et la base avait déjà dérivé — « MARCHE BANDJOUN » et
--  « NDJELEN » étaient utilisés sans y figurer.
--
--  L'amorçage part donc du CODE **et** du RÉEL : l'union des deux, pour
--  n'effacer aucun quartier déjà porté par une fiche.
--
--  Le nom EST la clé. Pas d'identifiant technique : rien ne référence un
--  quartier par clé étrangère, les trois tables qui en portent un stockent le
--  libellé. Un renommage se propage donc par un UPDATE explicite, jamais par
--  cascade — voir adminRenameQuartier dans api/core.mjs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS quartiers (
  nom      text PRIMARY KEY,
  cree_le  timestamptz NOT NULL DEFAULT now()
);

-- Recherche et unicité insensibles à la casse : « Tamdja » et « TAMDJA » sont
-- le même quartier, et deux entrées qui ne diffèrent que par la casse seraient
-- indiscernables à l'écran.
CREATE UNIQUE INDEX IF NOT EXISTS quartiers_nom_lower_idx
  ON quartiers (lower(trim(nom)));

-- 1. Les 45 du code.
INSERT INTO quartiers (nom) VALUES
  ('ENTREE DE LA VILLE'),
  ('CARREFOUR LE MAIRE'),
  ('MARCHE DES POULETS'),
  ('QUARTIER ADMINISTRATIF'),
  ('TOTAL EN BAS'),
  ('HOPITAL REGIONAL'),
  ('SAPEUR POMPIER'),
  ('BANDJOUN STATION'),
  ('QUARTIER HAOUSSA'),
  ('ECOLE NORMALE'),
  ('CAMPS SABLE'),
  ('CASA'),
  ('CAMI TOYOTA'),
  ('NDIANDAM'),
  ('MARCHE B'),
  ('MARCHE A'),
  ('TYO VILLE'),
  ('FEU ROUGE'),
  ('TOURISTIQUE'),
  ('BAMENZI'),
  ('KOUOGOUO'),
  ('DJEMOUN'),
  ('NDIANSO'),
  ('BANENGO'),
  ('SOCADA'),
  ('TAMDJA'),
  ('KAMKOP'),
  ('BALENG'),
  ('EVECHE'),
  ('COLACO'),
  ('BIPMOP'),
  ('TOCKET'),
  ('MAETUR'),
  ('BINAM'),
  ('DUBAI'),
  ('AUBERGE'),
  ('DJELENG'),
  ('ACHA'),
  ('KENA'),
  ('BIAO'),
  ('TPO'),
  ('FAMLA'),
  ('AKWA'),
  ('SENS INTERDIT'),
  ('MADELON')
ON CONFLICT DO NOTHING;

-- 2. Ceux que la base porte déjà et que le code ignorait.
INSERT INTO quartiers (nom)
SELECT DISTINCT upper(trim(q)) FROM (
  SELECT quartier q FROM interventions WHERE supprime_le IS NULL
  UNION ALL SELECT quartier FROM clients     WHERE supprime_le IS NULL
  UNION ALL SELECT quartier FROM clients_ls  WHERE supprime_le IS NULL
) x
WHERE NULLIF(trim(q),'') IS NOT NULL
ON CONFLICT DO NOTHING;
