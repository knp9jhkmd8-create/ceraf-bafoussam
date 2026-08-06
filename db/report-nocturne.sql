-- ============================================================================
--  Report automatique des interventions non résolues
--  Portage de reporterInterventionsEnAttente() (Apps Script) vers Postgres.
--
--  Règle métier inchangée : une intervention encore ouverte (En attente /
--  Injoignable / Problème) à la fin d'une journée passe au jour ouvré suivant.
--  Les « Réalisé » sont figées. `reporte_depuis` porte la date d'ORIGINE de la
--  première occurrence et ne bouge jamais — c'est la seule source de vérité
--  pour la durée.
--
--  DEUX ÉCARTS ASSUMÉS avec l'implémentation Apps Script :
--
--  1. On DÉPLACE la ligne en gardant son ID, au lieu d'en créer une nouvelle
--     avec un ID neuf puis de supprimer l'ancienne. L'ancien comportement
--     cassait silencieusement la file d'attente hors ligne du frontend : un
--     changement de statut mis en file la veille référence un `invId` qui
--     n'existe plus le lendemain matin — l'item était alors jeté comme
--     « intervention introuvable » et la saisie du technicien perdue.
--
--  2. On ne crée jamais de fiche un samedi ou un dimanche. Apps Script
--     ramenait un arriéré ancien sur « aujourd'hui » même si aujourd'hui
--     tombait un week-end, créant une fiche un jour non travaillé.
--
--  IDEMPOTENT PAR CONSTRUCTION : la fonction ne traite que les interventions
--  ouvertes dont la date est PASSÉE. Une fois reportées, elles sont à la date
--  du jour et ne sont plus candidates. On peut donc l'appeler autant de fois
--  qu'on veut — pas besoin du marqueur de throttle que l'ancien code devait
--  maintenir dans `_Config!B4`.
-- ============================================================================

-- Prochain jour ouvré STRICTEMENT après la date fournie.
CREATE OR REPLACE FUNCTION prochain_jour_ouvre(d date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT j FROM generate_series(d + 1, d + 7, interval '1 day') AS j
   WHERE extract(isodow FROM j) < 6
   ORDER BY j LIMIT 1;
$$;

-- Premier jour ouvré à partir de (et y compris) la date fournie.
CREATE OR REPLACE FUNCTION jour_ouvre_ou_suivant(d date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT j FROM generate_series(d, d + 7, interval '1 day') AS j
   WHERE extract(isodow FROM j) < 6
   ORDER BY j LIMIT 1;
$$;

-- Note d'implémentation : surtout PAS de table temporaire ici. Une première
-- version en `CREATE TEMP TABLE … ON COMMIT DROP` faisait échouer tout SECOND
-- appel dans la même transaction (« relation _a_reporter already exists »),
-- ce qui aurait cassé le filet de sécurité appelé depuis getByDate. Les CTE
-- n'ont pas ce défaut.
CREATE OR REPLACE FUNCTION reporter_interventions()
RETURNS TABLE(reportees integer, vers date) LANGUAGE plpgsql AS $fn$
DECLARE
  n integer := 0;
  cible_min date;
BEGIN
  -- Fiches de destination manquantes. La cible est le jour ouvré suivant la
  -- date de l'intervention, jamais avant aujourd'hui, jamais un week-end.
  INSERT INTO consistances (id, date)
  SELECT DISTINCT 'C_' || to_char(c.cible, 'YYYYMMDD'), c.cible
    FROM (SELECT GREATEST(prochain_jour_ouvre(i.date), jour_ouvre_ou_suivant(current_date)) AS cible
            FROM interventions i
           WHERE i.supprime_le IS NULL AND i.statut <> 'Réalisé' AND i.date < current_date) c
  ON CONFLICT (date) DO NOTHING;

  -- Déplacer. L'ID ne change pas (voir l'écart n°1 en tête de fichier).
  -- Le statut repasse à « En attente » : comportement d'origine, un
  -- « Injoignable » de la veille ne doit pas préjuger de la tentative du jour.
  WITH a AS (
    SELECT i.id,
           GREATEST(prochain_jour_ouvre(i.date), jour_ouvre_ou_suivant(current_date)) AS cible,
           COALESCE(i.reporte_depuis, i.date) AS origine
      FROM interventions i
     WHERE i.supprime_le IS NULL AND i.statut <> 'Réalisé' AND i.date < current_date
  ), maj AS (
    UPDATE interventions i
       SET date           = a.cible,
           consistance_id = c.id,
           statut         = 'En attente',
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
