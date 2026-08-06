#!/usr/bin/env node
// ============================================================================
//  Migration Google Sheets -> Neon (Phase 3)
//
//  Lit les exports JSON produits par l'action temporaire `_export` de Code.gs
//  et génère les instructions SQL d'insertion, plus un rapport d'anomalies.
//
//  Ne se contente PAS de recopier : il faut réparer ce que la feuille tolérait
//  et que Postgres refuse. Les quatre cas rencontrés sur les données réelles :
//
//   1. `Publié_par` / `Statut_par` contiennent des NOMS d'affichage, pas des
//      matricules — or ce sont des clés étrangères. On les résout via la
//      feuille Utilisateurs ; un nom inconnu devient NULL plutôt que de faire
//      échouer toute la migration.
//   2. Les dates héritées ont DEUX formats corrompus : le `Date.toString()`
//      documenté dans CLAUDE.md, et un « JJ/MM/AAAA hh:mm:ss (report auto) »
//      que `new Date()` ne sait pas lire du tout.
//   3. Un numéro de ligne en doublon, alors que c'est la clé primaire.
//   4. Des fiches clients sans nom.
//
//  Usage :  node db/migrate-from-sheets.js <dossier-export> [--sql <sortie>]
// ============================================================================

const fs = require('fs');
const path = require('path');

const dossier = process.argv[2];
if (!dossier) { console.error('Usage: node db/migrate-from-sheets.js <dossier-export>'); process.exit(1); }
const idxSql = process.argv.indexOf('--sql');
const fichierSql = idxSql > -1 ? process.argv[idxSql + 1] : null;

const lire = f => JSON.parse(fs.readFileSync(path.join(dossier, f + '.json'), 'utf8')).lignes || [];

const anomalies = [];
const noter = (categorie, detail) => anomalies.push({ categorie, detail });

// ── Échappement SQL ────────────────────────────────────────────────────────
const S = v => (v === null || v === undefined || v === '') ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";
// Variante pour les colonnes NOT NULL : une valeur absente devient la chaîne
// vide, PAS NULL. Sans ça, les deux fiches clients sans nom faisaient échouer
// toute la migration sur la contrainte NOT NULL de `nom`.
const SNN = v => "'" + String(v === null || v === undefined ? '' : v).replace(/'/g, "''") + "'";
const B = v => v ? 'true' : 'false';

// ── Dates ──────────────────────────────────────────────────────────────────
// Trois formats à absorber, dont deux hérités et corrompus.
function horodatage(v) {
  if (!v) return 'NULL';
  const s = String(v).trim();
  // « 23/06/2026 01:01:05 (report auto) » — JJ/MM/AAAA, invisible pour Date()
  const fr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T]+(\d{2}):(\d{2}):(\d{2})/);
  if (fr) return S(`${fr[3]}-${fr[2]}-${fr[1]}T${fr[4]}:${fr[5]}:${fr[6]}Z`) + '::timestamptz';
  // « Fri Jun 19 2026 23:25:04 GMT+0100 (…) » — Date.toString() stocké en texte
  const d = new Date(s);
  if (!isNaN(d.getTime())) return S(d.toISOString()) + '::timestamptz';
  noter('date-illisible', s);
  return 'NULL';
}
function jour(v) {
  if (!v) return 'NULL';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return S(s) + '::date';
  const d = new Date(s);
  if (!isNaN(d.getTime())) return S(d.toISOString().slice(0, 10)) + '::date';
  noter('date-jour-illisible', s);
  return 'NULL';
}

// ── Service déduit du type d'intervention (reprise de typeToService) ───────
function service(type) {
  const t = String(type).toLowerCase();
  if (t.includes('ftth')) return 'FTTH';
  if (t.includes(' ls') || t.endsWith('ls')) return 'LS';
  if (t.includes('cuivre')) return 'CUIVRE';
  noter('type-non-reconnu', type + ' -> FTTH par défaut');
  return 'FTTH';
}

const sql = [];

// ════════════════════════════════════════════════════════════════════════════
//  UTILISATEURS — les PIN sont repris TELS QUELS. Ne jamais réinitialiser.
// ════════════════════════════════════════════════════════════════════════════
const utilisateurs = lire('utilisateurs');
const parNom = new Map();          // nom d'affichage -> matricule
const matricules = new Set();

utilisateurs.forEach(u => {
  if (!u.matricule) { noter('utilisateur-sans-matricule', JSON.stringify(u)); return; }
  matricules.add(u.matricule);
  if (u.nom) parNom.set(u.nom.trim().toLowerCase(), u.matricule);
  if (!u.pinHash) noter('utilisateur-sans-pin', u.matricule);
  if (!u.pinHash.includes(':')) noter('pin-format-herite', u.matricule + ' (sel fixe — sera migré au prochain changement de PIN)');

  const roles = String(u.roles || '').split(',').map(r => r.trim()).filter(Boolean);
  const valides = roles.filter(r => ['admin', 'chef', 'technicien'].includes(r));
  if (valides.length !== roles.length) noter('role-invalide', u.matricule + ' : ' + u.roles);
  if (!valides.length) { noter('utilisateur-sans-role', u.matricule + ' -> technicien par défaut'); valides.push('technicien'); }

  sql.push(`INSERT INTO utilisateurs (matricule, nom, pin_hash, roles, actif, derniere_connexion) VALUES (`
    + `${S(u.matricule)}, ${SNN(u.nom)}, ${SNN(u.pinHash)}, `
    + `ARRAY[${valides.map(r => S(r)).join(',')}]::role_t[], ${B(u.actif)}, ${jour(u.derniereConnexion)})`);
});

// Résout un nom d'affichage en matricule (pour publie_par / statut_par).
function versMatricule(nomOuMatricule) {
  if (!nomOuMatricule) return null;
  const v = String(nomOuMatricule).trim();
  if (matricules.has(v)) return v;
  const m = parNom.get(v.toLowerCase());
  if (m) return m;
  noter('auteur-non-resolu', v + ' -> NULL');
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
//  CONSISTANCES
// ════════════════════════════════════════════════════════════════════════════
const consistances = lire('consistances');
const idsConsistance = new Set();
consistances.forEach(c => {
  if (!c.id || !c.date) { noter('consistance-incomplete', JSON.stringify(c)); return; }
  if (idsConsistance.has(c.id)) { noter('consistance-id-double', c.id + ' — ignorée'); return; }
  idsConsistance.add(c.id);
  sql.push(`INSERT INTO consistances (id, date, cree_le) VALUES (`
    + `${S(c.id)}, ${jour(c.date)}, COALESCE(${horodatage(c.creeLe)}, now()))`);
});

// ════════════════════════════════════════════════════════════════════════════
//  CLIENTS — les deux feuilles fusionnées, `numero` devient la clé primaire.
// ════════════════════════════════════════════════════════════════════════════
const clients = [...lire('clientsFtth'), ...lire('clientsCuivre')];
const vus = new Map();
clients.forEach(c => {
  const num = String(c.numero || '').trim();
  if (!num) { noter('client-sans-numero', JSON.stringify(c)); return; }
  if (!c.nom || !c.nom.trim()) noter('client-sans-nom', num + ' (' + (c.localite || 'sans localité') + ')');

  if (vus.has(num)) {
    // `numero` est la clé primaire ET la clé métier : un même numéro de ligne
    // ne peut désigner qu'un abonné. On garde la fiche la plus renseignée et
    // on REMONTE l'autre — rien n'est perdu en silence, l'utilisateur tranche
    // ensuite dans l'onglet « Édition manuelle ».
    const garde = vus.get(num);
    const scoreA = Object.values(garde).filter(Boolean).length;
    const scoreB = Object.values(c).filter(Boolean).length;
    const rejete = scoreB > scoreA ? garde : c;
    if (scoreB > scoreA) vus.set(num, c);
    noter('client-numero-double', num + ' — conservé « ' + vus.get(num).nom + ' », ÉCARTÉ « '
      + rejete.nom + ' » (' + (rejete.quartier || 'sans quartier') + ', GPS ' + (rejete.gps || 'aucun') + ')');
    return;
  }
  vus.set(num, c);
});
vus.forEach((c, num) => {
  sql.push(`INSERT INTO clients (numero, service, nom, telephone, tel_secondaire, localite, ville, quartier, gps, derniere_maj) VALUES (`
    + `${S(num)}, ${S(c.service)}::service_t, ${SNN(c.nom)}, ${S(c.tel)}, ${S(c.telSec)}, `
    + `${S(c.localite)}, ${S(c.ville)}, ${S(c.quartier)}, ${S(c.gps)}, COALESCE(${horodatage(c.maj)}, now()))`);
});

// ════════════════════════════════════════════════════════════════════════════
//  CLIENTS LS — dédoublonnés sur (nom, ville, quartier), comme nomKeyLs_.
// ════════════════════════════════════════════════════════════════════════════
const clesLs = new Set();
lire('clientsLs').forEach(c => {
  if (!c.nom || !c.nom.trim()) { noter('client-ls-sans-nom', JSON.stringify(c)); return; }
  const cle = [c.nom, c.ville, c.quartier].map(x => String(x || '').trim().toLowerCase()).join('|');
  if (clesLs.has(cle)) { noter('client-ls-double', cle + ' — ignoré'); return; }
  clesLs.add(cle);
  sql.push(`INSERT INTO clients_ls (nom, telephone, tel_secondaire, localite, ville, quartier, pop, gps, derniere_maj) VALUES (`
    + `${SNN(c.nom)}, ${S(c.tel)}, ${S(c.telSec)}, ${S(c.localite)}, ${S(c.ville)}, ${S(c.quartier)}, `
    + `${S(c.pop)}, ${S(c.gps)}, COALESCE(${horodatage(c.maj)}, now()))`);
});

// ════════════════════════════════════════════════════════════════════════════
//  CLIENTS RÉSILIÉS
// ════════════════════════════════════════════════════════════════════════════
lire('clientsResilies').forEach(c => {
  if (!c.nom || !c.nom.trim()) { noter('resilie-sans-nom', JSON.stringify(c)); return; }
  const sv = ['FTTH', 'CUIVRE', 'LS'].includes(String(c.service).toUpperCase())
    ? String(c.service).toUpperCase() : 'FTTH';
  if (sv !== String(c.service).toUpperCase()) noter('resilie-service-inconnu', c.service + ' -> FTTH');
  sql.push(`INSERT INTO clients_resilies (service, numero, nom, telephone, tel_secondaire, localite, ville, quartier, pop, gps, motif, date_resiliation, resilie_par, derniere_maj) VALUES (`
    + `${S(sv)}::service_t, ${S(c.numero)}, ${SNN(c.nom)}, ${S(c.tel)}, ${S(c.telSec)}, ${S(c.localite)}, `
    + `${S(c.ville)}, ${S(c.quartier)}, ${S(c.pop)}, ${S(c.gps)}, ${S(c.motif)}, `
    + `COALESCE(${horodatage(c.dateRes)}, now()), ${S(versMatricule(c.par))}, COALESCE(${horodatage(c.maj)}, now()))`);
});

// ════════════════════════════════════════════════════════════════════════════
//  INTERVENTIONS — en dernier : dépendent des consistances et des utilisateurs.
// ════════════════════════════════════════════════════════════════════════════
const idsInv = new Set();
lire('interventions').forEach(i => {
  if (!i.id) { noter('intervention-sans-id', JSON.stringify(i)); return; }
  if (idsInv.has(i.id)) { noter('intervention-id-double', i.id + ' — ignorée'); return; }
  if (!idsConsistance.has(i.consistanceId)) {
    noter('intervention-orpheline', i.id + ' -> consistance « ' + i.consistanceId + ' » absente, IGNORÉE');
    return;
  }
  const statuts = ['En attente', 'Injoignable', 'Problème', 'Réalisé'];
  let st = String(i.statut || 'En attente');
  if (!statuts.includes(st)) { noter('statut-inconnu', i.id + ' : « ' + st + ' » -> En attente'); st = 'En attente'; }
  idsInv.add(i.id);

  sql.push(`INSERT INTO interventions (id, consistance_id, date, type, service, numero_ligne, nom_client, statut, panne, remarque, reporte_depuis, ville, quartier, publie_par, statut_par, mis_a_jour_le) VALUES (`
    + `${S(i.id)}, ${S(i.consistanceId)}, ${jour(i.date)}, ${SNN(i.type)}, ${S(service(i.type))}::service_t, `
    + `${S(i.numero)}, ${SNN(i.nom)}, ${S(st)}::statut_t, ${S(i.panne)}, ${S(i.remarque)}, `
    + `${jour(i.reporteDepuis)}, ${S(i.ville)}, ${S(i.quartier)}, `
    + `${S(versMatricule(i.publiePar))}, ${S(versMatricule(i.statutPar))}, `
    + `COALESCE(${horodatage(i.majLe)}, now()))`);
});

// ── Regroupement en insertions multi-lignes ────────────────────────────────
// Chaque ligne produit un INSERT complet ci-dessus, ce qui est lisible mais
// verbeux. On les regroupe par table : Postgres avale sans peine des milliers
// de tuples dans un seul INSERT, et ça évite 445 allers-retours.
// L'ORDRE DES TABLES EST CONSERVÉ — les interventions référencent les
// consistances et les utilisateurs, elles doivent passer après.
function regrouper(instructions) {
  const groupes = [];
  const index = new Map();
  instructions.forEach(st => {
    const coupe = st.indexOf(' VALUES (');
    if (coupe < 0) { groupes.push({ prefixe: null, brut: st }); return; }
    const prefixe = st.slice(0, coupe + ' VALUES '.length);
    const tuple = st.slice(coupe + ' VALUES '.length);
    if (!index.has(prefixe)) { index.set(prefixe, { prefixe, tuples: [] }); groupes.push(index.get(prefixe)); }
    index.get(prefixe).tuples.push(tuple);
  });
  return groupes.map(g => g.prefixe === null ? g.brut
    : g.prefixe + g.tuples.join(', ') + ' ON CONFLICT DO NOTHING');
}

// ── Sorties ────────────────────────────────────────────────────────────────
if (fichierSql) {
  const groupe = regrouper(sql);
  fs.writeFileSync(fichierSql, JSON.stringify(groupe, null, 1));
  console.log(sql.length + ' insertion(s) regroupees en ' + groupe.length
    + ' instruction(s), ecrites dans ' + fichierSql);
}

console.log('\n=== RESUME ===');
console.log('  utilisateurs      : ' + utilisateurs.length);
console.log('  consistances      : ' + idsConsistance.size);
console.log('  clients (fusion)  : ' + vus.size);
console.log('  clients LS        : ' + clesLs.size);
console.log('  interventions     : ' + idsInv.size);
console.log('  instructions SQL  : ' + sql.length);

console.log('\n=== ANOMALIES (' + anomalies.length + ') ===');
const parCategorie = {};
anomalies.forEach(a => (parCategorie[a.categorie] = parCategorie[a.categorie] || []).push(a.detail));
Object.keys(parCategorie).sort().forEach(k => {
  console.log('  [' + k + '] x' + parCategorie[k].length);
  parCategorie[k].forEach(d => console.log('      ' + d));
});
