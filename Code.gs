// ============================================================
//  CERAF BAFOUSSAM — Code.gs (v4.3)
// ============================================================

const SHEET_ID            = '1OH566jWxL8ph7-UWscrs3ZQt0elNAnPGcNqvjC-RA_w';
const SHEET_CONSIST       = 'Consistances';
const SHEET_INTERVENTIONS = 'Interventions';
// Clients : une feuille par service depuis le 2026-07-10 — plus de colonne
// Service, la feuille EST le classement. ('Clients' puis 'Clients FTTH/cuivre'
// étaient les anciennes feuilles uniques, migrées puis archivées.)
const SHEET_CLIENTS_FTTH   = 'Clients FTTH';
const SHEET_CLIENTS_CUIVRE = 'Clients Cuivre';
const SHEET_CLIENTS_LS     = 'Clients LS';
// Depuis le 2026-07-12 : une résiliation Réalisée déplace physiquement la fiche
// hors des feuilles actives vers cette feuille d'archive (avec motif + date),
// tout en conservant les interventions (l'historique reste consultable).
const SHEET_CLIENTS_RESILIES = 'Clients Résiliés';
const SHEET_USERS         = 'Utilisateurs';
const SESSION_DUREE_JOURS = 30; // durée de validité d'un token de session

// ============================================================
//  HELPER — obtenir/créer une feuille automatiquement
// ============================================================
function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_CONSIST) {
      sheet.appendRow(['ID_Consistance','Date','Nb_Interventions','Créé_le','Realisees','Instances']);
      sheet.getRange(1,1,1,6).setFontWeight('bold').setBackground('#1d4ed8').setFontColor('white');
    } else if (name === SHEET_INTERVENTIONS) {
      sheet.appendRow(['ID_Intervention','ID_Consistance','Date',
        'Type','Numero_Ligne','Nom_Client',
        'Statut','Panne','Remarque','Reporté_depuis','Mis_à_jour_le','Ville','Quartier','Duree_Jours','Publié_par','Statut_par']);
      sheet.getRange(1,1,1,16).setFontWeight('bold').setBackground('#1d4ed8').setFontColor('white');
    } else if (name === SHEET_CLIENTS_FTTH || name === SHEET_CLIENTS_CUIVRE) {
      sheet.appendRow(['Numero','Nom','Telephone','Tel_Secondaire','Localite','Ville','Quartier','GPS','Derniere_MAJ']);
      sheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#0891b2').setFontColor('white');
    } else if (name === SHEET_CLIENTS_LS) {
      sheet.appendRow(['Nom','Telephone','Tel_Secondaire','Localite','Ville','Quartier','POP','GPS','Derniere_MAJ']);
      sheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#0891b2').setFontColor('white');
    } else if (name === SHEET_CLIENTS_RESILIES) {
      sheet.appendRow(['Service','Numero','Nom','Telephone','Tel_Secondaire','Localite','Ville','Quartier','POP','GPS','Motif','Date_Resiliation','Resilie_Par','Derniere_MAJ']);
      sheet.getRange(1,1,1,14).setFontWeight('bold').setBackground('#b91c1c').setFontColor('white');
    } else if (name === SHEET_USERS) {
      sheet.appendRow(['ID','Nom','PIN_Hash','Role','Actif','Token','Token_Expire','Derniere_connexion']);
      sheet.getRange(1,1,1,8).setFontWeight('bold').setBackground('#7c3aed').setFontColor('white');
    }
  }
  return sheet;
}

function getSS()  { return SpreadsheetApp.openById(SHEET_ID); }

// ============================================================
//  NOTIFICATION SÛRE — affiche une alerte UI si le contexte le
//  permet (exécution depuis l'éditeur avec menu actif), sinon
//  écrit dans les logs (visible via Affichage > Journaux).
//  Évite l'erreur "Cannot call SpreadsheetApp.getUi() from this context".
// ============================================================
function notify(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}
function s1()       { return getOrCreateSheet(getSS(), SHEET_CONSIST); }
function s2()       { return getOrCreateSheet(getSS(), SHEET_INTERVENTIONS); }
function s3ftth()   { return getOrCreateSheet(getSS(), SHEET_CLIENTS_FTTH); }
function s3cuivre() { return getOrCreateSheet(getSS(), SHEET_CLIENTS_CUIVRE); }
function s3ls()     { return getOrCreateSheet(getSS(), SHEET_CLIENTS_LS); }
function s3res()    { return getOrCreateSheet(getSS(), SHEET_CLIENTS_RESILIES); }
function s4()       { return getOrCreateSheet(getSS(), SHEET_USERS); }

// Les deux feuilles clients à numéro de ligne, avec leur service dérivé.
// Toute recherche par numéro doit balayer les deux (un numéro n'existe
// que dans une seule feuille à la fois).
function clientsSheets_() {
  return [
    { sheet: s3ftth(),   service: 'FTTH'   },
    { sheet: s3cuivre(), service: 'CUIVRE' }
  ];
}
function sheetForService_(service) {
  return String(service).toUpperCase() === 'CUIVRE' ? s3cuivre() : s3ftth();
}

// Feuille Utilisateurs
function getUsersIdx(sheet) {
  const h = getColMap(sheet);
  return {
    id:      h['ID']                  !== undefined ? h['ID']                  : 0,
    nom:     h['Nom']                 !== undefined ? h['Nom']                 : 1,
    pinHash: h['PIN_Hash']            !== undefined ? h['PIN_Hash']            : 2,
    role:    h['Role']                !== undefined ? h['Role']                : 3,
    actif:   h['Actif']               !== undefined ? h['Actif']               : 4,
    token:   h['Token']               !== undefined ? h['Token']               : 5,
    tokenExp:h['Token_Expire']        !== undefined ? h['Token_Expire']        : 6,
    derniereConn:h['Derniere_connexion'] !== undefined ? h['Derniere_connexion'] : 7,
    total:   sheet.getLastColumn()
  };
}

// ============================================================
//  AUTHENTIFICATION — hachage PIN, sessions par token
// ============================================================
function hashPin(pin, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin) + ':' + salt);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}
// Sel fixe par déploiement — suffisant ici car le secret réel est le PIN
// combiné à l'accès physique au Sheet, pas le sel lui-même.
const PIN_SALT = 'ceraf-bafoussam-2026';

// PIN attribué par défaut à tout nouveau compte. La connexion signale
// mustChangePin tant que le PIN reste celui-ci, pour proposer (sans forcer)
// à l'utilisateur de le personnaliser après sa première connexion.
const DEFAULT_PIN = '0000';
function isDefaultPin(hash) {
  return hash === hashPin(DEFAULT_PIN, PIN_SALT);
}

function generateToken() {
  return Utilities.getUuid() + '-' + Utilities.getUuid();
}

// Découpe la colonne Role ("chef,technicien" ou "admin") en tableau de rôles.
function parseRoles(rawRole) {
  return String(rawRole || '').split(',').map(r => r.trim()).filter(Boolean);
}

// Résout un token de session en {id, nom, roles:[...]} ou null si invalide/expiré.
// Un compte peut avoir plusieurs rôles (ex: "chef,technicien") — le rôle actif
// pour une requête donnée est choisi côté client (voir actingRole) et vérifié
// ci-dessous dans doGet/doPost, jamais fait confiance en aveugle.
function resolveSession(token) {
  if (!token) return null;
  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  const now = new Date();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][u.token]) === String(token) && String(rows[i][u.token]) !== '') {
      const exp = rows[i][u.tokenExp];
      if (!(exp instanceof Date) || exp < now) return null; // expiré
      if (String(rows[i][u.actif]) === 'false') return null; // désactivé
      return { id: String(rows[i][u.id]), nom: String(rows[i][u.nom]), roles: parseRoles(rows[i][u.role]) };
    }
  }
  return null;
}

// Connexion par MATRICULE (= colonne ID de la feuille Utilisateurs), plus
// par nom. Le nom reste stocké et renvoyé pour l'affichage (badge), mais
// n'est jamais l'identifiant de connexion. `data.nom` est accepté en repli
// uniquement pour un ancien client encore en cache qui posterait ce champ.
function loginUser(data) {
  const matricule = String(data.matricule || data.id || data.nom || '').trim();
  const pin = String(data.pin || '').trim();
  if (!matricule || !pin) return { success: false, error: 'Matricule et PIN requis' };

  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  const hash = hashPin(pin, PIN_SALT);

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][u.id]).trim() === matricule) {
      if (String(rows[i][u.actif]) === 'false') return { success: false, error: 'Compte désactivé' };
      if (String(rows[i][u.pinHash]) !== hash) return { success: false, error: 'PIN incorrect' };

      const token = generateToken();
      const expire = new Date();
      expire.setDate(expire.getDate() + SESSION_DUREE_JOURS);
      sheet.getRange(i+1, u.token+1).setValue(token);
      sheet.getRange(i+1, u.tokenExp+1).setValue(expire);
      sheet.getRange(i+1, u.derniereConn+1).setValue(new Date().toLocaleString('fr-FR'));

      return {
        success: true, token,
        nom: String(rows[i][u.nom]),
        roles: parseRoles(rows[i][u.role]),
        mustChangePin: isDefaultPin(hash)
      };
    }
  }
  return { success: false, error: 'Matricule introuvable' };
}

function logoutUser(data) {
  const token = String(data.token || '');
  if (!token) return { success: true };
  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][u.token]) === token) {
      sheet.getRange(i+1, u.token+1).setValue('');
      sheet.getRange(i+1, u.tokenExp+1).setValue('');
      break;
    }
  }
  return { success: true };
}

// Un utilisateur change son propre PIN (self-service, tous rôles).
function changePin(data, session) {
  const newPin = String(data.newPin || '').trim();
  if (!/^\d{4,6}$/.test(newPin)) return { success: false, error: 'Le PIN doit contenir 4 à 6 chiffres' };
  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][u.id]) === session.id) {
      sheet.getRange(i+1, u.pinHash+1).setValue(hashPin(newPin, PIN_SALT));
      return { success: true };
    }
  }
  return { success: false, error: 'Utilisateur introuvable' };
}

// ============================================================
//  AMORÇAGE DU PREMIER COMPTE ADMIN
//  Ne fonctionne QUE si la feuille Utilisateurs est encore vide —
//  résout le problème de l'œuf et la poule (il faut un admin pour
//  créer des utilisateurs via adminAddUser, mais adminAddUser est
//  lui-même réservé aux admins). Se verrouille définitivement dès
//  qu'un premier utilisateur existe.
// ============================================================
function bootstrapAdmin(data) {
  const sheet = s4();
  const rows = sheet.getDataRange().getValues();
  if (rows.length > 1) return { success: false, error: 'Déjà initialisé — utilisez la page Utilisateurs' };

  const nom = String(data.nom || '').trim();
  const pin = String(data.pin || '').trim();
  if (!nom) return { success: false, error: 'Nom requis' };
  if (!/^\d{4,6}$/.test(pin)) return { success: false, error: 'Le PIN doit contenir 4 à 6 chiffres' };

  const u = getUsersIdx(sheet);
  const matricule = String(data.matricule || data.id || '').trim();
  const row = new Array(u.total).fill('');
  row[u.id]    = matricule || 'U_' + Date.now();
  row[u.nom]   = nom;
  row[u.pinHash] = hashPin(pin, PIN_SALT);
  row[u.role]  = 'admin';
  row[u.actif] = 'true';
  sheet.appendRow(row);
  return { success: true };
}

// ============================================================
//  AMORÇAGE DES MATRICULES — à exécuter UNE FOIS depuis l'éditeur
//  Apps Script (Exécuter > seedUtilisateurs).
//  Idempotent : peut être relancé sans créer de doublons.
//    - Crée/migre chaque utilisateur listé avec son MATRICULE comme ID.
//    - Un compte déjà présent (retrouvé par matricule, sinon par nom) est
//      migré : son ID devient le matricule, ses rôles/nom sont mis à jour,
//      son PIN existant est CONSERVÉ (0000 seulement s'il n'en avait pas).
//    - Le compte "admin" existant est migré vers le matricule 999999
//      (PIN conservé) ; s'il n'existe pas, il est créé avec le PIN 0000.
// ============================================================
// Auto-migration une seule fois : déclenchée par le premier appel doGet/doPost
// après déploiement, pour ne PAS dépendre d'un lancement manuel de
// seedUtilisateurs depuis l'éditeur. Verrouillée (LockService + drapeau
// ScriptProperties) pour être exécutée exactement une fois, même sous requêtes
// concurrentes. Le seed lui-même reste idempotent en second rideau.
function ensureSeeded() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SEED_MATRICULES_DONE') === '1') return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return; // un autre thread s'en charge
  try {
    if (props.getProperty('SEED_MATRICULES_DONE') === '1') return;
    seedUtilisateursCore();
    props.setProperty('SEED_MATRICULES_DONE', '1');
  } catch (e) {
    Logger.log('ensureSeeded a échoué : ' + e);
  } finally {
    lock.releaseLock();
  }
}

// Version éditeur : lance le seed puis affiche/loggue le rapport.
function seedUtilisateurs() {
  const report = seedUtilisateursCore();
  notify('✅ Seed utilisateurs terminé :\n\n- ' + report.join('\n- '));
}

function seedUtilisateursCore() {
  const sheet = s4();
  const u = getUsersIdx(sheet);
  const defaultHash = hashPin(DEFAULT_PIN, PIN_SALT);
  const report = [];

  const seeds = [
    { matricule: '401569', nom: 'MBOKI Pierre',         roles: 'chef' },
    { matricule: '103300', nom: 'Godlove NGWANGS NFOR', roles: 'technicien' },
    { matricule: '402537', nom: 'BENANA Hermann',       roles: 'chef,technicien' },
    { matricule: '400866', nom: 'SIMO Dieudonne',       roles: 'chef' },
    { matricule: '401732', nom: 'DZOUALI Joël',         roles: 'chef,technicien' },
    { matricule: '402411', nom: 'TENE Éric',            roles: 'technicien' }
  ];

  function rowByMatricule(m) {
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) if (String(rows[i][u.id]).trim() === m) return { i, rows };
    return { i: -1, rows };
  }
  function rowByNom(n) {
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) if (String(rows[i][u.nom]).trim().toLowerCase() === n.toLowerCase()) return i;
    return -1;
  }

  seeds.forEach(s => {
    let found = rowByMatricule(s.matricule);
    let idx = found.i;
    if (idx === -1) idx = rowByNom(s.nom); // migration nom → matricule
    if (idx >= 0) {
      const rows = sheet.getDataRange().getValues();
      sheet.getRange(idx+1, u.id+1).setValue(s.matricule);
      sheet.getRange(idx+1, u.nom+1).setValue(s.nom);
      sheet.getRange(idx+1, u.role+1).setValue(s.roles);
      sheet.getRange(idx+1, u.actif+1).setValue('true');
      if (!String(rows[idx][u.pinHash]).trim()) sheet.getRange(idx+1, u.pinHash+1).setValue(defaultHash);
      report.push('MAJ ' + s.matricule + ' — ' + s.nom);
    } else {
      const row = new Array(u.total).fill('');
      row[u.id] = s.matricule; row[u.nom] = s.nom; row[u.pinHash] = defaultHash;
      row[u.role] = s.roles; row[u.actif] = 'true';
      sheet.appendRow(row);
      report.push('NOUVEAU ' + s.matricule + ' — ' + s.nom);
    }
  });

  // Compte admin : migrer "admin" → 999999 (PIN conservé), sinon le créer.
  let adminIdx = rowByMatricule('999999').i;
  if (adminIdx === -1) adminIdx = rowByNom('admin');
  if (adminIdx >= 0) {
    const rows = sheet.getDataRange().getValues();
    sheet.getRange(adminIdx+1, u.id+1).setValue('999999');
    const currentRoles = parseRoles(rows[adminIdx][u.role]);
    if (!currentRoles.includes('admin')) currentRoles.push('admin');
    sheet.getRange(adminIdx+1, u.role+1).setValue(currentRoles.join(','));
    sheet.getRange(adminIdx+1, u.actif+1).setValue('true');
    if (!String(rows[adminIdx][u.pinHash]).trim()) sheet.getRange(adminIdx+1, u.pinHash+1).setValue(defaultHash);
    report.push('ADMIN → 999999 (PIN conservé)');
  } else {
    const row = new Array(u.total).fill('');
    row[u.id] = '999999'; row[u.nom] = 'admin'; row[u.pinHash] = defaultHash;
    row[u.role] = 'admin'; row[u.actif] = 'true';
    sheet.appendRow(row);
    report.push('ADMIN créé 999999 (PIN 0000)');
  }

  return report;
}

// ============================================================
//  ADMIN — gestion des comptes utilisateurs
//  Le PIN_Hash et le Token ne sont jamais renvoyés au client.
// ============================================================
function adminListUsers() {
  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < rows.length; i++) {
    if (!String(rows[i][u.id]).trim()) continue;
    users.push({
      id:    String(rows[i][u.id]),
      nom:   String(rows[i][u.nom]),
      roles: parseRoles(rows[i][u.role]),
      actif: String(rows[i][u.actif]) !== 'false',
      derniereConnexion: String(rows[i][u.derniereConn] || '')
    });
  }
  return { success: true, users };
}

// Valide et normalise une liste de rôles envoyée par le client — accepte un
// tableau (["chef","technicien"]) ou une chaîne ("chef,technicien"). Un compte
// peut cumuler plusieurs rôles (ex: chef ET technicien), sélectionnés au
// moment de la connexion côté frontend.
function validRolesString(rolesInput) {
  const list = Array.isArray(rolesInput)
    ? rolesInput
    : String(rolesInput || '').split(',');
  const roles = [...new Set(list.map(r => String(r).trim()).filter(Boolean))];
  if (roles.length === 0) return null;
  if (!roles.every(r => ['admin','chef','technicien'].includes(r))) return null;
  return roles.join(',');
}

function adminAddUser(data) {
  const nom       = String(data.nom || '').trim();
  const matricule = String(data.matricule || data.id || '').trim();
  // PIN laissé vide → attribue le PIN par défaut (0000), l'utilisateur sera
  // invité à le changer à sa première connexion (mustChangePin).
  const pin       = String(data.pin || '').trim() || DEFAULT_PIN;
  const roles = validRolesString(data.roles !== undefined ? data.roles : (data.role || 'technicien'));
  if (!nom) return { success: false, error: 'Nom requis' };
  if (!matricule) return { success: false, error: 'Matricule requis' };
  if (!/^\d{4,6}$/.test(pin)) return { success: false, error: 'Le PIN doit contenir 4 à 6 chiffres' };
  if (!roles) return { success: false, error: 'Rôle(s) invalide(s)' };

  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  // Le matricule EST l'identifiant (colonne ID) — il doit être unique.
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][u.id]).trim() === matricule) {
      return { success: false, error: 'Ce matricule existe déjà' };
    }
  }

  const row = new Array(u.total).fill('');
  row[u.id]      = matricule;
  row[u.nom]     = nom;
  row[u.pinHash] = hashPin(pin, PIN_SALT);
  row[u.role]    = roles;
  row[u.actif]   = 'true';
  sheet.appendRow(row);
  return { success: true };
}

function adminUpdateUser(data) {
  const id = String(data.id || '');
  if (!id) return { success: false, error: 'ID manquant' };
  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][u.id]) === id) {
      if (data.roles !== undefined) {
        const roles = validRolesString(data.roles);
        if (!roles) return { success: false, error: 'Rôle(s) invalide(s)' };
        sheet.getRange(i+1, u.role+1).setValue(roles);
      }
      if (data.actif !== undefined) {
        sheet.getRange(i+1, u.actif+1).setValue(data.actif ? 'true' : 'false');
        if (!data.actif) { // désactivation → invalide la session en cours
          sheet.getRange(i+1, u.token+1).setValue('');
          sheet.getRange(i+1, u.tokenExp+1).setValue('');
        }
      }
      return { success: true };
    }
  }
  return { success: false, error: 'Utilisateur introuvable' };
}

function adminDeleteUser(data, session) {
  const id = String(data.id || '');
  if (!id) return { success: false, error: 'ID manquant' };
  if (id === session.id) return { success: false, error: 'Impossible de supprimer votre propre compte' };
  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][u.id]) === id) {
      sheet.deleteRow(i+1);
      return { success: true };
    }
  }
  return { success: false, error: 'Utilisateur introuvable' };
}

function adminResetPin(data) {
  const id  = String(data.id || '');
  const pin = String(data.pin || '').trim();
  if (!id) return { success: false, error: 'ID manquant' };
  if (!/^\d{4,6}$/.test(pin)) return { success: false, error: 'Le PIN doit contenir 4 à 6 chiffres' };
  const sheet = s4();
  const u = getUsersIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][u.id]) === id) {
      sheet.getRange(i+1, u.pinHash+1).setValue(hashPin(pin, PIN_SALT));
      // Réinitialiser le PIN invalide aussi les sessions en cours par précaution
      sheet.getRange(i+1, u.token+1).setValue('');
      sheet.getRange(i+1, u.tokenExp+1).setValue('');
      return { success: true };
    }
  }
  return { success: false, error: 'Utilisateur introuvable' };
}

// ============================================================
//  ADMIN — réparations en masse, exposées depuis l'app au lieu
//  de nécessiter l'éditeur Apps Script. Enveloppent les fonctions
//  de réparation existantes en renvoyant un résumé JSON.
// ============================================================
function adminRepairAgregats() {
  const sheet1 = s1();
  const ci = getConsistIdx(sheet1);
  const cRows = sheet1.getDataRange().getValues();
  const months = new Set();
  for (let i = 1; i < cRows.length; i++) {
    const d = normDate(cRows[i][ci.date]);
    if (d) months.add(d.substring(0,7));
  }
  months.forEach(m => recalculerAgregatsMois(m));
  return { success: true, monthsRepaired: [...months] };
}

function adminRepairBase() {
  const sheet1 = s1(), sheet2 = s2();
  const ci = getConsistIdx(sheet1);
  const ii = getInvIdx(sheet2);
  const cRows = sheet1.getDataRange().getValues();
  const iRows = sheet2.getDataRange().getValues();

  const counts = {};
  for (let i = 1; i < iRows.length; i++) {
    const cid = String(iRows[i][ii.cid]);
    if (!cid) continue;
    counts[cid] = (counts[cid] || 0) + 1;
  }

  let updated = 0, removed = 0;
  for (let i = cRows.length - 1; i >= 1; i--) {
    const cid = String(cRows[i][ci.id]);
    const realCount = counts[cid] || 0;
    if (realCount === 0) { sheet1.deleteRow(i+1); removed++; }
    else if (Number(cRows[i][ci.nb]) !== realCount) { sheet1.getRange(i+1, ci.nb+1).setValue(realCount); updated++; }
  }
  return { success: true, updated, removed };
}

function normDate(rd) {
  if (rd instanceof Date) {
    return rd.getFullYear() + '-'
      + String(rd.getMonth()+1).padStart(2,'0') + '-'
      + String(rd.getDate()).padStart(2,'0');
  }
  const s = String(rd).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  // Format hérité corrompu (Date.toString() stocké comme texte par une
  // ancienne version du code, ex: "Mon Jun 22 2026 00:00:00 GMT+0100 (West Africa Time)")
  if (s) {
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return parsed.getFullYear() + '-'
        + String(parsed.getMonth()+1).padStart(2,'0') + '-'
        + String(parsed.getDate()).padStart(2,'0');
    }
  }
  return s;
}

// Déduire le service (FTTH / LS / CUIVRE) depuis le type d'intervention
function typeToService(typeLabel) {
  const t = String(typeLabel).toLowerCase();
  if (t.includes('ftth'))   return 'FTTH';
  if (t.includes(' ls') || t.endsWith('ls')) return 'LS';
  if (t.includes('cuivre')) return 'CUIVRE';
  return 'FTTH'; // défaut
}

// ============================================================
//  doGet
//  Toutes les actions exigent un token de session valide (voir
//  resolveSession). Un compte peut avoir plusieurs rôles (ex:
//  "chef,technicien") — le client précise sous quel rôle il agit
//  pour cette requête via actingRole, mais ce choix est toujours
//  vérifié contre les rôles réels du compte (session.roles) avant
//  d'être utilisé : impossible de se déclarer "admin" sans l'être.
// ============================================================
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  const token  = e && e.parameter && e.parameter.token;
  const wanted = e && e.parameter && e.parameter.actingRole;
  let result;
  try {
    // Réchauffement : appelé en arrière-plan par le front dès l'affichage de
    // l'écran de connexion, pour que le cold start Apps Script (10-30s) se
    // produise PENDANT que l'utilisateur tape son matricule et non après le
    // clic sur "Se connecter". Aucune donnée, aucune session — juste réveiller
    // le conteneur d'exécution.
    if (action === 'ping') {
      return ContentService.createTextOutput(JSON.stringify({ success: true, pong: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    ensureSeeded();
    const session = resolveSession(token);
    if (!session) {
      result = { success: false, error: 'Session invalide, reconnectez-vous', authError: true };
    } else if (!session.roles.includes(wanted)) {
      result = { success: false, error: 'Rôle non autorisé pour ce compte', authError: true };
    } else {
      const role = wanted;
      // Actions réservées au chef centre / admin
      if ((action === 'getAll' || action === 'getClients' || action === 'getClientsResilies' || action === 'getClientHistory' || action === 'genererKpi') && role === 'technicien') {
        result = { success: false, error: 'Accès réservé au chef centre' };
      }
      else if (action === 'getByDate')  result = getByDate(e.parameter);
      else if (action === 'genererKpi') result = genererRapportKpi(e.parameter.month);
      else if (action === 'getAll')     result = getAll(e.parameter);
      else if (action === 'getClients') result = getClients();
      else if (action === 'getClientsResilies') result = getClientsResilies();
      else if (action === 'findClient') result = findClient(e.parameter);
      else if (action === 'getActiveInterventions') result = getActiveInterventions();
      else if (action === 'getClientHistory') result = getClientHistory(e.parameter);
      else if (action === 'adminListUsers') {
        result = role === 'admin' ? adminListUsers() : { success: false, error: 'Réservé à l\'administrateur' };
      }
      else result = { success: false, error: 'Action inconnue' };
    }
  } catch(err) {
    result = { success: false, error: err.toString() };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  doPost
//  'login' et 'bootstrapAdmin' sont les seules actions accessibles
//  sans session valide. Toutes les autres résolvent le rôle depuis
//  le token, jamais depuis un champ envoyé par le client.
// ============================================================
function doPost(e) {
  let result;
  try {
    ensureSeeded();
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'login') {
      result = loginUser(data);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
    if (data.action === 'bootstrapAdmin') {
      result = bootstrapAdmin(data);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    const session = resolveSession(data.token);
    if (!session) {
      result = { success: false, error: 'Session invalide, reconnectez-vous', authError: true };
    } else if (!session.roles.includes(data.actingRole)) {
      result = { success: false, error: 'Rôle non autorisé pour ce compte', authError: true };
    } else {
      const role = data.actingRole;
      const CHEF_ONLY  = ['deleteClient','deleteIntervention','saveClient','saveClientLs','mergeClientsLs'];
      const ADMIN_ONLY = ['adminListUsers','adminAddUser','adminUpdateUser','adminDeleteUser','adminResetPin','adminRepairAgregats','adminRepairBase'];

      if (CHEF_ONLY.includes(data.action) && role === 'technicien') {
        result = { success: false, error: 'Action réservée au chef centre' };
      }
      else if (ADMIN_ONLY.includes(data.action) && role !== 'admin') {
        result = { success: false, error: 'Action réservée à l\'administrateur' };
      }
      else if (data.action === 'logout')             result = logoutUser(data);
      else if (data.action === 'changePin')          result = changePin(data, session);
      else if (data.action === 'saveConsistance')    result = saveConsistance(data, session);
      else if (data.action === 'updateStatus')       result = updateStatus(data, session);
      else if (data.action === 'getByDate')          result = getByDate(data);
      else if (data.action === 'getAll')             result = getAll(data);
      else if (data.action === 'getClients')         result = getClients();
      else if (data.action === 'findClient')         result = findClient(data);
      else if (data.action === 'saveClient')         result = saveClient(data);
      else if (data.action === 'saveClientLs')       result = saveClientLs(data);
      else if (data.action === 'deleteClient')       result = deleteClient(data);
      else if (data.action === 'updateClientGPS')    result = updateClientGPS(data);
      else if (data.action === 'mergeClientsLs')     result = fusionnerClientsLs(data);
      else if (data.action === 'deleteIntervention') result = deleteIntervention(data);
      else if (data.action === 'getClientHistory')   result = getClientHistory(data);
      else if (data.action === 'adminListUsers')     result = adminListUsers();
      else if (data.action === 'adminAddUser')       result = adminAddUser(data);
      else if (data.action === 'adminUpdateUser')    result = adminUpdateUser(data);
      else if (data.action === 'adminDeleteUser')    result = adminDeleteUser(data, session);
      else if (data.action === 'adminResetPin')      result = adminResetPin(data);
      else if (data.action === 'adminRepairAgregats')result = adminRepairAgregats();
      else if (data.action === 'adminRepairBase')    result = adminRepairBase();
      else result = { success: false, error: 'Action inconnue' };
    }
  } catch(err) {
    result = { success: false, error: err.toString() };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  INITIALISATION
// ============================================================
function initialiserSheets() {
  s1(); s2(); s3ftth(); s3cuivre(); s3ls(); s4();
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'reporterInterventionsEnAttente')
      ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reporterInterventionsEnAttente')
    .timeBased().atHour(1).everyDays(1).create();
  notify('✅ Toutes les feuilles sont prêtes !');
}

// ============================================================
//  INDEX DYNAMIQUES — lecture des entêtes pour chaque feuille
//  Résistant aux ajouts/déplacements de colonnes.
// ============================================================
function getColMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { map[String(h).trim()] = i; });
  return map;
}

// Feuilles Clients FTTH / Clients Cuivre (même schéma, sans colonne Service :
// la feuille elle-même porte le classement)
function getClientsIdx(sheet) {
  const h = getColMap(sheet);
  return {
    num:      h['Numero']        !== undefined ? h['Numero']        : 0,
    nom:      h['Nom']           !== undefined ? h['Nom']           : 1,
    tel:      h['Telephone']     !== undefined ? h['Telephone']     : 2,
    telSec:   h['Tel_Secondaire']!== undefined ? h['Tel_Secondaire']: 3,
    loc:      h['Localite']      !== undefined ? h['Localite']      : 4,
    ville:    h['Ville']         !== undefined ? h['Ville']         : 5,
    quartier: h['Quartier']      !== undefined ? h['Quartier']      : 6,
    gps:      h['GPS']           !== undefined ? h['GPS']           : 7,
    maj:      h['Derniere_MAJ']  !== undefined ? h['Derniere_MAJ']  : 8,
    total:    sheet.getLastColumn()
  };
}

// Feuille Clients LS — pas de numéro de ligne pour ce service : le client
// est identifié par son nom (obligatoire à la saisie, forcé en majuscules).
function getClientsLsIdx(sheet) {
  const h = getColMap(sheet);
  return {
    nom:      h['Nom']           !== undefined ? h['Nom']           : 0,
    tel:      h['Telephone']     !== undefined ? h['Telephone']     : 1,
    telSec:   h['Tel_Secondaire']!== undefined ? h['Tel_Secondaire']: 2,
    loc:      h['Localite']      !== undefined ? h['Localite']      : 3,
    ville:    h['Ville']         !== undefined ? h['Ville']         : 4,
    quartier: h['Quartier']      !== undefined ? h['Quartier']      : 5,
    pop:      h['POP']           !== undefined ? h['POP']           : 6,
    gps:      h['GPS']           !== undefined ? h['GPS']           : 7,
    maj:      h['Derniere_MAJ']  !== undefined ? h['Derniere_MAJ']  : 8,
    total:    sheet.getLastColumn()
  };
}

// Feuille Clients Résiliés — archive : superset des colonnes FTTH/Cuivre/LS,
// plus Service (l'origine), Motif, Date_Resiliation et Resilie_Par.
function getClientsResIdx(sheet) {
  const h = getColMap(sheet);
  return {
    service:  h['Service']          !== undefined ? h['Service']          : 0,
    num:      h['Numero']           !== undefined ? h['Numero']           : 1,
    nom:      h['Nom']              !== undefined ? h['Nom']              : 2,
    tel:      h['Telephone']        !== undefined ? h['Telephone']        : 3,
    telSec:   h['Tel_Secondaire']   !== undefined ? h['Tel_Secondaire']   : 4,
    loc:      h['Localite']         !== undefined ? h['Localite']         : 5,
    ville:    h['Ville']            !== undefined ? h['Ville']            : 6,
    quartier: h['Quartier']         !== undefined ? h['Quartier']         : 7,
    pop:      h['POP']              !== undefined ? h['POP']              : 8,
    gps:      h['GPS']              !== undefined ? h['GPS']              : 9,
    motif:    h['Motif']            !== undefined ? h['Motif']            : 10,
    dateRes:  h['Date_Resiliation'] !== undefined ? h['Date_Resiliation'] : 11,
    par:      h['Resilie_Par']      !== undefined ? h['Resilie_Par']      : 12,
    maj:      h['Derniere_MAJ']     !== undefined ? h['Derniere_MAJ']     : 13,
    total:    sheet.getLastColumn()
  };
}

// Clé de dédoublonnage d'un client LS : Nom + Ville + Quartier normalisés
// (majuscules, accents retirés, espaces réduits). Un même nom dans deux villes
// ou deux quartiers = deux clients LS distincts (homonymes fréquents sur le
// terrain). Ville/quartier absents (ancien cache, rétro-compat) → clé sur le
// nom seul, comportement historique.
function nomKeyLs_(nom, ville, quartier) {
  const seg = (s) => sansAccents_(String(s || '')).trim().toUpperCase().replace(/\s+/g, ' ');
  const n = seg(nom);
  if (!n) return ''; // pas de nom → pas de clé (préserve les tests `if (nomLs)`)
  return [n, seg(ville), seg(quartier)].join('|');
}

// Feuille Interventions
function getInvIdx(sheet) {
  const h = getColMap(sheet);
  return {
    id:           h['ID_Intervention']  !== undefined ? h['ID_Intervention']  : 0,
    cid:          h['ID_Consistance']   !== undefined ? h['ID_Consistance']   : 1,
    date:         h['Date']             !== undefined ? h['Date']             : 2,
    type:         h['Type']             !== undefined ? h['Type']             : 3,
    num:          h['Numero_Ligne']     !== undefined ? h['Numero_Ligne']     : 4,
    nom:          h['Nom_Client']       !== undefined ? h['Nom_Client']       : 5,
    statut:       h['Statut']           !== undefined ? h['Statut']           : 6,
    panne:        h['Panne']            !== undefined ? h['Panne']            : -1,
    remarque:     h['Remarque']         !== undefined ? h['Remarque']         : 8,
    reporteDepuis:h['Reporté_depuis']   !== undefined ? h['Reporté_depuis']   : 9,
    maj:          h['Mis_à_jour_le']    !== undefined ? h['Mis_à_jour_le']    : 10,
    ville:        h['Ville']            !== undefined ? h['Ville']            : 11,
    quartier:     h['Quartier']         !== undefined ? h['Quartier']         : 12,
    duree:        h['Duree_Jours']      !== undefined ? h['Duree_Jours']      : 13,
    // Colonnes d'audit (absentes des anciennes feuilles → -1, toujours garder
    // l'accès derrière un test >= 0). Créées au besoin par ensureInvAuditCols().
    publiePar:    h['Publié_par']       !== undefined ? h['Publié_par']       : -1,
    statutPar:    h['Statut_par']       !== undefined ? h['Statut_par']       : -1,
    total:        sheet.getLastColumn()
  };
}

// Ajoute les colonnes manquantes de la feuille Interventions : Panne
// (insérée juste après Statut) et l'audit Publié_par / Statut_par (en fin
// de feuille). Appelé sur les chemins d'écriture.
function ensureInvAuditCols(sheet) {
  let h = getColMap(sheet);
  if (h['Panne'] === undefined && h['Statut'] !== undefined) {
    sheet.insertColumnAfter(h['Statut'] + 1);
    sheet.getRange(1, h['Statut'] + 2).setValue('Panne');
    h = getColMap(sheet);
  }
  const manquantes = ['Publié_par','Statut_par'].filter(c => h[c] === undefined);
  if (manquantes.length === 0) return;
  let col = sheet.getLastColumn();
  manquantes.forEach(c => { col++; sheet.getRange(1, col).setValue(c); });
}

// Jointure Clients : numéro nettoyé → {tel, loc}, sur les DEUX feuilles
// clients (FTTH + Cuivre). Les colonnes Tel_Client et Localite ont été
// retirées de la feuille Interventions — la fiche Client est la seule
// source de ces informations à la lecture.
function getClientsJoinMap() {
  const map = {};
  clientsSheets_().forEach(({ sheet }) => {
    const c = getClientsIdx(sheet);
    const rows = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const num = String(rows[i][c.num] || '').trim().replace(/\s/g,'');
      if (!num) continue;
      map[num] = {
        tel:    String(rows[i][c.tel] || ''),
        telSec: String(rows[i][c.telSec] || ''),
        loc:    String(rows[i][c.loc] || '')
      };
    }
  });
  return map;
}

// Repli pour les interventions sans fiche Client (aucun numéro de ligne ni
// Customer ID) : le contact a été conservé dans la remarque à la publication
// ("Tel: … • Tel2: … • Localité: …") — le réextraire pour l'affichage.
function contactDepuisRemarque(remarque) {
  const r = { tel: '', telSec: '', loc: '' };
  String(remarque || '').split(' • ').forEach(function(seg) {
    const s = seg.trim();
    if (s.indexOf('Tel: ') === 0)           r.tel    = s.slice(5).trim();
    else if (s.indexOf('Tel2: ') === 0)     r.telSec = s.slice(6).trim();
    else if (s.indexOf('Localité: ') === 0) r.loc    = s.slice(10).trim();
  });
  return r;
}

// Feuille Consistances
function getConsistIdx(sheet) {
  const h = getColMap(sheet);
  return {
    id:       h['ID_Consistance']   !== undefined ? h['ID_Consistance']   : 0,
    date:     h['Date']             !== undefined ? h['Date']             : 1,
    nb:       h['Nb_Interventions'] !== undefined ? h['Nb_Interventions'] : 2,
    creeLe:   h['Créé_le']          !== undefined ? h['Créé_le']          : 3,
    realisees:h['Realisees']        !== undefined ? h['Realisees']        : 4,
    instances:h['Instances']        !== undefined ? h['Instances']        : 5,
    total:    sheet.getLastColumn()
  };
}

// ============================================================
//  INTERVENTIONS ACTIVES — liste légère (num+type+date+statut)
//  pour la détection de doublons côté front, sans latence.
//  Exclut les "Réalisé" — seules les interventions en cours
//  comptent comme doublon potentiel.
// ============================================================
function getActiveInterventions() {
  const sheet = s2();
  const ii = getInvIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const num = String(rows[i][ii.num] || '').trim();
    if (!num) continue;
    const statut = String(rows[i][ii.statut] || '');
    if (statut === 'Réalisé') continue;
    list.push({
      num:    num.replace(/\s/g,'').toLowerCase(),
      type:   String(rows[i][ii.type] || ''),
      date:   normDate(rows[i][ii.date]),
      statut: statut
    });
  }
  return { success: true, list };
}

// ============================================================
//  CLIENTS — récupérer toute la base + interventions actives
//  Les deux données sont retournées en un seul appel pour
//  garantir que le cache anti-doublons est toujours prêt.
// ============================================================
function getClients() {
  // Interventions actives (non Réalisées) — pour détection doublons côté front.
  // Au passage, on repère les numéros ayant une Résiliation Réalisée : ils sont
  // exclus des clients actifs ci-dessous. Dérivé à la lecture depuis
  // Interventions (jamais stocké sur la fiche Client), pour ne jamais diverger —
  // même logique que calculerDuree(). Résiliation = définitive (pas de
  // réactivation) : voir genererRapportKpi/categorie() pour la même détection
  // de type insensible aux accents/majuscules.
  const sheet2 = s2();
  const rows2  = sheet2.getDataRange().getValues();
  const ii     = getInvIdx(sheet2);
  const activeInterventions = [];
  const resilies = {};
  for (let i = 1; i < rows2.length; i++) {
    const num = String(rows2[i][ii.num] || '').trim();
    if (!num) continue;
    const statutInv = String(rows2[i][ii.statut]);
    const numKey = num.replace(/\s/g,'').toLowerCase();
    // Filet de sécurité : un numéro ayant une résiliation (quel que soit le
    // statut) est exclu des clients actifs. La fiche est normalement déjà
    // déplacée vers « Clients Résiliés » à la publication ; ceci couvre les
    // cas où le déplacement n'aurait pas eu lieu.
    if (sansAccents_(rows2[i][ii.type]).toLowerCase().indexOf('resiliation') !== -1) resilies[numKey] = true;
    if (statutInv === 'Réalisé') continue;
    activeInterventions.push({
      num:    numKey,
      type:   String(rows2[i][ii.type] || ''),
      date:   normDate(rows2[i][ii.date]),
      statut: statutInv
    });
  }

  // Clients FTTH et Cuivre — une feuille par service, le service est dérivé
  // de la feuille (plus de colonne Service).
  const clientsFtth = [], clientsCuivre = [];
  clientsSheets_().forEach(({ sheet, service }) => {
    const c    = getClientsIdx(sheet);
    const rows = sheet.getDataRange().getValues();
    const dest = service === 'CUIVRE' ? clientsCuivre : clientsFtth;
    for (let i = 1; i < rows.length; i++) {
      const num = String(rows[i][c.num]).trim();
      if (!num) continue;
      if (resilies[num.replace(/\s/g,'').toLowerCase()]) continue;
      dest.push({
        num:      String(rows[i][c.num]),
        nom:      String(rows[i][c.nom]      || ''),
        tel:      String(rows[i][c.tel]      || ''),
        telSec:   String(rows[i][c.telSec]   || ''),
        loc:      String(rows[i][c.loc]      || ''),
        ville:    String(rows[i][c.ville]    || ''),
        quartier: String(rows[i][c.quartier] || ''),
        service,
        gps:      String(rows[i][c.gps]      || ''),
        maj:      String(rows[i][c.maj]      || '')
      });
    }
  });

  // Clients LS — feuille séparée, identifiés par nom (pas de numéro de ligne)
  const sheetLs = s3ls();
  const rowsLs  = sheetLs.getDataRange().getValues();
  const cl      = getClientsLsIdx(sheetLs);
  const clientsLs = [];
  for (let i = 1; i < rowsLs.length; i++) {
    const nom = String(rowsLs[i][cl.nom] || '').trim();
    if (!nom) continue;
    clientsLs.push({
      nom,
      tel:      String(rowsLs[i][cl.tel]      || ''),
      telSec:   String(rowsLs[i][cl.telSec]   || ''),
      loc:      String(rowsLs[i][cl.loc]      || ''),
      ville:    String(rowsLs[i][cl.ville]    || ''),
      quartier: String(rowsLs[i][cl.quartier] || ''),
      pop:      String(rowsLs[i][cl.pop]      || ''),
      gps:      String(rowsLs[i][cl.gps]      || ''),
      maj:      String(rowsLs[i][cl.maj]      || '')
    });
  }

  // `clients` (fusion) est conservé pour les frontends encore en cache
  // (service worker) qui ne connaissent que l'ancienne forme de réponse.
  return {
    success: true,
    clients: clientsFtth.concat(clientsCuivre),
    clientsFtth, clientsCuivre, clientsLs,
    activeInterventions
  };
}

// ============================================================
//  CLIENTS RÉSILIÉS — liste d'archive (chef centre uniquement)
//  Les interventions ne sont pas supprimées : l'historique de chaque
//  résilié reste consultable via getClientHistory (par numéro pour
//  FTTH/Cuivre, par nom+ville+quartier pour LS).
// ============================================================
function getClientsResilies() {
  const sheet = s3res();
  const r     = getClientsResIdx(sheet);
  const rows  = sheet.getDataRange().getValues();
  const out   = [];
  for (let i = 1; i < rows.length; i++) {
    const service = String(rows[i][r.service] || '').trim();
    const num     = String(rows[i][r.num]     || '').trim();
    const nom     = String(rows[i][r.nom]     || '').trim();
    if (!num && !nom) continue;
    out.push({
      service,
      num,
      nom,
      tel:      String(rows[i][r.tel]      || ''),
      telSec:   String(rows[i][r.telSec]   || ''),
      loc:      String(rows[i][r.loc]      || ''),
      ville:    String(rows[i][r.ville]    || ''),
      quartier: String(rows[i][r.quartier] || ''),
      pop:      String(rows[i][r.pop]      || ''),
      gps:      String(rows[i][r.gps]      || ''),
      motif:    String(rows[i][r.motif]    || ''),
      dateRes:  normDate(rows[i][r.dateRes]) || String(rows[i][r.dateRes] || ''),
      par:      String(rows[i][r.par]      || '')
    });
  }
  return { success: true, clientsResilies: out };
}

// ============================================================
//  CLIENTS — chercher par numéro
// ============================================================
function findClient(params) {
  const num = String(params.num || '').trim().replace(/\s/g,'');
  if (!num) return { success: false, error: 'Numéro vide' };
  for (const { sheet, service } of clientsSheets_()) {
    const rows = sheet.getDataRange().getValues();
    const c    = getClientsIdx(sheet);
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][c.num]).trim().replace(/\s/g,'') === num) {
        return {
          success: true, found: true,
          client: {
            num:      String(rows[i][c.num]),
            nom:      String(rows[i][c.nom]      || ''),
            tel:      String(rows[i][c.tel]      || ''),
            telSec:   String(rows[i][c.telSec]   || ''),
            loc:      String(rows[i][c.loc]      || ''),
            ville:    String(rows[i][c.ville]    || ''),
            quartier: String(rows[i][c.quartier] || ''),
            service,
            gps:      String(rows[i][c.gps]      || '')
          }
        };
      }
    }
  }
  return { success: true, found: false };
}

// ============================================================
//  HISTORIQUE COMPLET D'UN CLIENT — toutes les interventions
//  (tous mois confondus), dédupliquées par incident réel.
//  Contrairement à getAll() (dédoublonnage par nom|num|type, borné
//  à un mois), ici la clé inclut la date D'ORIGINE (Reporté_depuis) :
//  deux dérangements FTTH séparés dans le temps pour le même client
//  restent deux entrées distinctes, alors que les multiples lignes
//  physiques d'un même report restent bien fusionnées en une seule.
// ============================================================
function getClientHistory(params) {
  const num   = String(params.num || '').trim().replace(/\s/g,'');
  // Mode LS : les interventions LS n'ont pas de numéro de ligne — le client
  // est retrouvé par nom normalisé, restreint aux types LS pour ne pas
  // capter un homonyme FTTH/Cuivre.
  const nomLs = nomKeyLs_(params.nomLs, params.villeLs, params.quartierLs);
  if (!num && !nomLs) return { success: false, error: 'Numéro manquant' };

  const sheet2 = s2();
  const ii = getInvIdx(sheet2);
  const rows = sheet2.getDataRange().getValues();

  const deduped = {};
  for (let j = 1; j < rows.length; j++) {
    if (nomLs) {
      if (typeToService(rows[j][ii.type]) !== 'LS') continue;
      if (nomKeyLs_(rows[j][ii.nom], rows[j][ii.ville], rows[j][ii.quartier]) !== nomLs) continue;
    } else {
      const rowNum = String(rows[j][ii.num] || '').trim().replace(/\s/g,'');
      if (rowNum !== num) continue;
    }
    const remarque = String(rows[j][ii.remarque] || '');
    if (remarque.startsWith('➡️ Reporté au')) continue;

    const type      = String(rows[j][ii.type] || '');
    const statut    = String(rows[j][ii.statut] || '');
    const rowDate   = normDate(rows[j][ii.date]);
    const origine   = normDate(rows[j][ii.reporteDepuis]) || rowDate;
    const cle = type + '|' + origine;

    const entry = {
      id: String(rows[j][ii.id]), type, statut, remarque, date: rowDate, origine,
      panne: ii.panne >= 0 ? String(rows[j][ii.panne] || '') : '',
      ville: String(rows[j][ii.ville] || ''), quartier: String(rows[j][ii.quartier] || '')
    };

    if (!deduped[cle]) {
      deduped[cle] = entry;
    } else {
      const ex = deduped[cle];
      const pNew = statutPoids(statut), pEx = statutPoids(ex.statut);
      const garder = pNew > pEx || (pNew === pEx && rowDate > ex.date);
      deduped[cle] = garder ? entry : ex;
    }
  }

  const history = Object.values(deduped)
    .map(inv => ({ ...inv, duree: calculerDuree(inv.origine, inv.date, inv.statut) }))
    .sort((a, b) => b.origine.localeCompare(a.origine));

  return { success: true, num: num || nomLs, history };
}

// Localise la fiche d'un numéro de ligne parmi les feuilles FTTH et Cuivre.
// Retourne { sheet, c, rowIndex (1-based feuille), service } ou null.
function trouverClientRow_(numClean) {
  for (const { sheet, service } of clientsSheets_()) {
    const rows = sheet.getDataRange().getValues();
    const c    = getClientsIdx(sheet);
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][c.num]).trim().replace(/\s/g,'') === numClean) {
        return { sheet, c, rowIndex: i+1, service, row: rows[i] };
      }
    }
  }
  return null;
}

// ============================================================
//  RÉSILIATION — archiver (déplacer) la fiche client
//  Déplace la fiche hors des feuilles actives (FTTH/Cuivre/LS) vers
//  « Clients Résiliés » avec motif/date/auteur. NE TOUCHE PAS aux
//  interventions : l'historique du client résilié reste consultable.
//  Idempotent : si la fiche est déjà absente (déjà archivée), ne fait
//  rien. Renvoie true si une fiche a été archivée.
// ============================================================
function archiverClientResilie_(info) {
  const service = String(info.service || '').toUpperCase();
  const now  = new Date().toLocaleString('fr-FR');
  const dest = s3res();
  const r    = getClientsResIdx(dest);

  function pousserArchive(f) {
    const row = new Array(r.total).fill('');
    row[r.service]  = f.service  || service || '';
    row[r.num]      = f.num      || '';
    row[r.nom]      = f.nom      || '';
    row[r.tel]      = f.tel      || '';
    row[r.telSec]   = f.telSec   || '';
    row[r.loc]      = f.loc      || '';
    row[r.ville]    = f.ville    || '';
    row[r.quartier] = f.quartier || '';
    row[r.pop]      = f.pop      || '';
    row[r.gps]      = f.gps      || '';
    row[r.motif]    = info.motif || '';
    row[r.dateRes]  = info.date  || now;
    row[r.par]      = info.par   || '';
    row[r.maj]      = now;
    dest.appendRow(row);
  }

  if (service === 'LS') {
    const key = nomKeyLs_(info.nom, info.ville, info.quartier);
    if (!key) return false;
    const sheetLs = s3ls();
    const cl = getClientsLsIdx(sheetLs);
    const rows = sheetLs.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (nomKeyLs_(rows[i][cl.nom], rows[i][cl.ville], rows[i][cl.quartier]) === key) {
        pousserArchive({
          service:  'LS',
          nom:      String(rows[i][cl.nom]      || ''),
          tel:      String(rows[i][cl.tel]      || ''),
          telSec:   String(rows[i][cl.telSec]   || ''),
          loc:      String(rows[i][cl.loc]      || ''),
          ville:    String(rows[i][cl.ville]    || ''),
          quartier: String(rows[i][cl.quartier] || ''),
          pop:      String(rows[i][cl.pop]      || ''),
          gps:      String(rows[i][cl.gps]      || '')
        });
        sheetLs.deleteRow(i+1);
        return true;
      }
    }
    return false;
  }

  // FTTH / Cuivre : retrouvés par numéro de ligne, feuille auto-détectée.
  const numClean = String(info.num || '').trim().replace(/\s/g,'');
  if (!numClean) return false;
  const cible = trouverClientRow_(numClean);
  if (!cible) return false;
  const c = cible.c;
  pousserArchive({
    service:  cible.service,
    num:      String(cible.row[c.num]      || ''),
    nom:      String(cible.row[c.nom]      || ''),
    tel:      String(cible.row[c.tel]      || ''),
    telSec:   String(cible.row[c.telSec]   || ''),
    loc:      String(cible.row[c.loc]      || ''),
    ville:    String(cible.row[c.ville]    || ''),
    quartier: String(cible.row[c.quartier] || ''),
    gps:      String(cible.row[c.gps]      || '')
  });
  cible.sheet.deleteRow(cible.rowIndex);
  return true;
}

// ============================================================
//  CLIENTS — sauvegarder
//  Le service (FTTH/CUIVRE) choisit la feuille. Si le numéro
//  existait dans l'autre feuille, la fiche y est retirée
//  (reclassement) avant l'écriture dans la feuille cible.
// ============================================================
function saveClient(data) {
  const { num, nom, tel, telSec, loc, ville, quartier, service, gps } = data;
  if (!num) return { success: false, error: 'Numéro manquant' };
  const sheet    = sheetForService_(service);
  const now      = new Date().toLocaleString('fr-FR');
  const c        = getClientsIdx(sheet);
  const numClean = String(num).trim().replace(/\s/g,'');

  function buildRow() {
    const row = new Array(c.total).fill('');
    row[c.num]      = num;
    row[c.nom]      = String(nom || '').toUpperCase();
    row[c.tel]      = tel      || '';
    row[c.telSec]   = telSec   || '';
    row[c.loc]      = loc      || '';
    row[c.ville]    = ville    || '';
    row[c.quartier] = quartier || '';
    row[c.gps]      = gps      || '';
    row[c.maj]      = now;
    return row;
  }

  const existant = trouverClientRow_(numClean);
  if (existant && existant.sheet.getName() === sheet.getName()) {
    sheet.getRange(existant.rowIndex, 1, 1, c.total).setValues([buildRow()]);
    return { success: true, action: 'updated' };
  }
  if (existant) existant.sheet.deleteRow(existant.rowIndex); // reclassement
  sheet.appendRow(buildRow());
  return { success: true, action: existant ? 'reclasse' : 'created' };
}

// ============================================================
//  CLIENTS LS — sauvegarder (ajout direct en BD, sans intervention)
//  Réutilise upsertClientLs_ : une fiche existante est complétée,
//  jamais écrasée par du vide.
// ============================================================
function saveClientLs(data) {
  if (!data.nom || !String(data.nom).trim()) return { success: false, error: 'Nom manquant' };
  const action = upsertClientLs_({
    nom: data.nom, tel: data.tel, telSec: data.telSec, loc: data.loc,
    ville: data.ville, quartier: data.quartier, pop: data.pop, gps: data.gps
  });
  return { success: true, action };
}

// ============================================================
//  CLIENTS — mettre à jour GPS uniquement
// ============================================================
function updateClientGPS(data) {
  const { num, gps } = data;
  // Mode LS : pas de numéro de ligne, la fiche est retrouvée par nom.
  if (!num && data.nomLs) {
    const sheetLs = s3ls();
    const cl      = getClientsLsIdx(sheetLs);
    const key     = nomKeyLs_(data.nomLs, data.villeLs, data.quartierLs);
    const rowsLs  = sheetLs.getDataRange().getValues();
    for (let i = 1; i < rowsLs.length; i++) {
      if (nomKeyLs_(rowsLs[i][cl.nom], rowsLs[i][cl.ville], rowsLs[i][cl.quartier]) === key) {
        sheetLs.getRange(i+1, cl.gps+1).setValue(gps || '');
        sheetLs.getRange(i+1, cl.maj+1).setValue(new Date().toLocaleString('fr-FR'));
        return { success: true };
      }
    }
    return { success: false, error: 'Client LS introuvable' };
  }
  if (!num) return { success: false, error: 'Numéro manquant' };
  const cible = trouverClientRow_(String(num).trim().replace(/\s/g,''));
  if (!cible) return { success: false, error: 'Client introuvable' };
  cible.sheet.getRange(cible.rowIndex, cible.c.gps+1).setValue(gps || '');
  cible.sheet.getRange(cible.rowIndex, cible.c.maj+1).setValue(new Date().toLocaleString('fr-FR'));
  return { success: true };
}

// ============================================================
//  CLIENTS — supprimer EN CASCADE
//  Supprime le client ET toutes ses interventions, peu importe
//  la fiche/date à laquelle elles appartiennent. Recalcule
//  ensuite les compteurs Nb_Interventions affectés.
// ============================================================
function deleteClient(data) {
  const num    = String(data.num || '').trim().replace(/\s/g,'');
  const nomLs  = nomKeyLs_(data.nomLs, data.villeLs, data.quartierLs); // mode LS : suppression par Nom+Ville+Quartier
  const sheet1 = s1(), sheet2 = s2();
  const ci = getConsistIdx(sheet1);
  const ii = getInvIdx(sheet2);
  let clientFound = false;

  if (nomLs) {
    const sheetLs = s3ls();
    const cl      = getClientsLsIdx(sheetLs);
    const rowsLs  = sheetLs.getDataRange().getValues();
    for (let i = rowsLs.length - 1; i >= 1; i--) {
      if (nomKeyLs_(rowsLs[i][cl.nom], rowsLs[i][cl.ville], rowsLs[i][cl.quartier]) === nomLs) {
        sheetLs.deleteRow(i+1);
        clientFound = true;
        break;
      }
    }
  } else {
    const cible = trouverClientRow_(num);
    if (cible) { cible.sheet.deleteRow(cible.rowIndex); clientFound = true; }
  }
  if (!clientFound) return { success: false, error: 'Client introuvable' };

  // Cascade : mode LS = mêmes nom + type LS (pour épargner un homonyme
  // FTTH/Cuivre) ; mode numéro = même Numero_Ligne.
  const estCible = (row) => nomLs
    ? (typeToService(row[ii.type]) === 'LS' && nomKeyLs_(row[ii.nom], row[ii.ville], row[ii.quartier]) === nomLs)
    : (String(row[ii.num] || '').trim().replace(/\s/g,'') === num);

  const iRows = sheet2.getDataRange().getValues();
  const affectedConsistIds = {};
  let deletedCount = 0;
  for (let i = iRows.length - 1; i >= 1; i--) {
    if (estCible(iRows[i])) {
      affectedConsistIds[String(iRows[i][ii.cid])] = true;
      sheet2.deleteRow(i+1);
      deletedCount++;
    }
  }

  const cRows = sheet1.getDataRange().getValues();
  const iRowsAfter = sheet2.getDataRange().getValues();
  Object.keys(affectedConsistIds).forEach(cid => {
    let remaining = 0;
    for (let j = 1; j < iRowsAfter.length; j++) {
      if (String(iRowsAfter[j][ii.cid]) === cid) remaining++;
    }
    for (let i = cRows.length - 1; i >= 1; i--) {
      if (String(cRows[i][ci.id]) === cid) {
        if (remaining === 0) sheet1.deleteRow(i+1);
        else sheet1.getRange(i+1, ci.nb+1).setValue(remaining);
        break;
      }
    }
  });

  return { success: true, deletedInterventions: deletedCount };
}

// ============================================================
//  CLIENTS LS — upsert par nom normalisé
//  Un champ existant n'est remplacé que par une valeur non vide :
//  une étude sans téléphone ne doit pas effacer le contact connu.
// ============================================================
function upsertClientLs_(fields) {
  const key = nomKeyLs_(fields.nom, fields.ville, fields.quartier);
  if (!key) return null;
  const sheet = s3ls();
  const c     = getClientsLsIdx(sheet);
  const now   = fields.maj || new Date().toLocaleString('fr-FR');
  const rows  = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (nomKeyLs_(rows[i][c.nom], rows[i][c.ville], rows[i][c.quartier]) !== key) continue;
    const setIfValue = (col, val) => {
      if (val && String(val).trim()) sheet.getRange(i+1, col+1).setValue(String(val).trim());
    };
    setIfValue(c.tel,      fields.tel);
    setIfValue(c.telSec,   fields.telSec);
    setIfValue(c.loc,      fields.loc);
    setIfValue(c.ville,    fields.ville);
    setIfValue(c.quartier, fields.quartier);
    setIfValue(c.pop,      fields.pop);
    setIfValue(c.gps,      fields.gps);
    sheet.getRange(i+1, c.maj+1).setValue(now);
    return 'updated';
  }

  const row = new Array(c.total).fill('');
  // Stocker le nom SIMPLE (majuscules, espaces réduits), plus la clé composite :
  // Ville/Quartier vivent dans leurs propres colonnes et forment la clé.
  row[c.nom]      = String(fields.nom || '').trim().toUpperCase().replace(/\s+/g, ' ');
  row[c.tel]      = fields.tel      || '';
  row[c.telSec]   = fields.telSec   || '';
  row[c.loc]      = fields.loc      || '';
  row[c.ville]    = fields.ville    || '';
  row[c.quartier] = fields.quartier || '';
  row[c.pop]      = fields.pop      || '';
  row[c.gps]      = fields.gps      || '';
  row[c.maj]      = now;
  sheet.appendRow(row);
  return 'created';
}

// ============================================================
//  CLIENTS LS — fusionner deux fiches (doublon d'orthographe)
//  La fiche « nomFusionne » est absorbée par « nomGarde » : les
//  champs vides de la fiche gardée sont complétés depuis la fiche
//  absorbée, les interventions LS de l'ancien nom sont renommées
//  (l'historique par nom reste complet), puis la fiche absorbée
//  est supprimée.
// ============================================================
function fusionnerClientsLs(data) {
  const keyGarde = nomKeyLs_(data.nomGarde,    data.villeGarde, data.quartierGarde);
  const keyFus   = nomKeyLs_(data.nomFusionne, data.villeFus,   data.quartierFus);
  if (!keyGarde || !keyFus) return { success: false, error: 'Deux fiches requises' };
  if (keyGarde === keyFus)  return { success: false, error: 'Les deux fiches sont identiques' };

  const sheet = s3ls();
  const c     = getClientsLsIdx(sheet);
  const rows  = sheet.getDataRange().getValues();
  let rowGarde = -1, rowFus = -1;
  for (let i = 1; i < rows.length; i++) {
    const k = nomKeyLs_(rows[i][c.nom], rows[i][c.ville], rows[i][c.quartier]);
    if (k === keyGarde) rowGarde = i;
    else if (k === keyFus) rowFus = i;
  }
  if (rowGarde < 0 || rowFus < 0) {
    return { success: false, error: 'Fiche introuvable : ' + (rowGarde < 0 ? data.nomGarde : data.nomFusionne) };
  }

  [c.tel, c.telSec, c.loc, c.ville, c.quartier, c.pop, c.gps].forEach(col => {
    const garde = String(rows[rowGarde][col] || '').trim();
    const fus   = String(rows[rowFus][col]   || '').trim();
    if (!garde && fus) sheet.getRange(rowGarde+1, col+1).setValue(fus);
  });
  sheet.getRange(rowGarde+1, c.maj+1).setValue(new Date().toLocaleString('fr-FR'));

  // Réaffecter les interventions LS de la fiche absorbée vers la fiche gardée :
  // on aligne la clé COMPLÈTE (nom + ville + quartier) sur la fiche conservée,
  // pour que l'historique et les prochains upserts pointent au bon endroit.
  const nomGardeCell   = String(rows[rowGarde][c.nom]      || '');
  const villeGardeCell = String(rows[rowGarde][c.ville]    || '');
  const quartGardeCell = String(rows[rowGarde][c.quartier] || '');
  sheet.deleteRow(rowFus+1);

  const sheet2 = s2();
  const ii = getInvIdx(sheet2);
  const iRows = sheet2.getDataRange().getValues();
  let renommees = 0;
  for (let i = 1; i < iRows.length; i++) {
    if (typeToService(iRows[i][ii.type]) !== 'LS') continue;
    if (nomKeyLs_(iRows[i][ii.nom], iRows[i][ii.ville], iRows[i][ii.quartier]) !== keyFus) continue;
    sheet2.getRange(i+1, ii.nom+1).setValue(nomGardeCell);
    if (ii.ville    >= 0) sheet2.getRange(i+1, ii.ville+1).setValue(villeGardeCell);
    if (ii.quartier >= 0) sheet2.getRange(i+1, ii.quartier+1).setValue(quartGardeCell);
    renommees++;
  }
  return { success: true, interventionsRenommees: renommees };
}

// ============================================================
//  ENREGISTRER UNE CONSISTANCE
//  Correction : upsert client même pour le premier enregistrement
// ============================================================
function saveConsistance(data, session) {
  const sheet1 = s1(), sheet2 = s2();
  const { date, interventions } = data;
  const now = new Date().toLocaleString('fr-FR');
  const ci  = getConsistIdx(sheet1);
  ensureInvAuditCols(sheet2);
  const ii  = getInvIdx(sheet2);

  // Trouver ou créer la fiche du jour
  let consistId;
  const cRows = sheet1.getDataRange().getValues();
  let existingRow = -1, existingNb = 0;
  for (let i = 1; i < cRows.length; i++) {
    if (normDate(cRows[i][ci.date]) === date) {
      existingRow = i+1;
      existingNb  = Number(cRows[i][ci.nb]) || 0;
      consistId   = String(cRows[i][ci.id]);
      break;
    }
  }
  if (existingRow > 0) {
    sheet1.getRange(existingRow, ci.nb+1).setValue(existingNb + interventions.length);
  } else {
    consistId = 'C_' + date.replace(/-/g,'');
    const row1 = new Array(ci.total).fill('');
    row1[ci.id]   = consistId;
    row1[ci.date] = date;
    row1[ci.nb]   = interventions.length;
    row1[ci.creeLe] = now;
    sheet1.appendRow(row1);
  }

  // Pour chaque intervention
  interventions.forEach((inv, idx) => {
    const invId = consistId + '_' + (Date.now() + idx) + '_' + idx;
    // Résiliation : action définitive, publiée directement « Réalisé » (pas de
    // tâche en attente côté technicien) et la fiche client est archivée
    // immédiatement (voir archiverClientResilie_ plus bas).
    const estResiliation = sansAccents_(inv.typeLabel || inv.type).toLowerCase().indexOf('resiliation') !== -1;

    // Écriture dans Interventions via index dynamiques
    const rowInv = new Array(ii.total).fill('');
    rowInv[ii.id]           = invId;
    rowInv[ii.cid]          = consistId;
    rowInv[ii.date]         = date;
    rowInv[ii.type]         = inv.typeLabel || inv.type;
    rowInv[ii.num]          = inv.customerId ? inv.customerId : (inv.num||'');
    rowInv[ii.nom]          = inv.nom  || '';
    rowInv[ii.statut]       = estResiliation ? 'Réalisé' : 'En attente';
    // Installation FTTH : le chef renseigne FDT/FAT (déterminés lors de l'étude
    // préalable) — encodés dans Remarque au même format que la fiche technicien.
    // Installation LS : GPS/chambre/remarque saisis au formulaire n'ont pas de
    // fiche Client à rejoindre (pas de numéro de ligne pour ce type) — encodés
    // ici aussi, sinon ils étaient silencieusement perdus.
    const remarqueParts = [];
    if (inv.fdt) remarqueParts.push('FDT: ' + String(inv.fdt).trim());
    if (inv.fat) remarqueParts.push('FAT: ' + String(inv.fat).trim());
    if (inv.gps) remarqueParts.push('GPS: ' + String(inv.gps).trim());
    if (inv.chambre) remarqueParts.push('Chambre: ' + String(inv.chambre).trim());
    if (inv.motif) remarqueParts.push('Motif: ' + String(inv.motif).trim());
    if (inv.extra) remarqueParts.push('Remarque: ' + String(inv.extra).trim());
    // Clé de la fiche Client : numéro de ligne, sinon Customer ID (études
    // FTTH — pas encore de ligne). La jointure de lecture retrouve le
    // contact par cette même clé (rowInv[ii.num] contient déjà customerId).
    const numKey = (inv.num && String(inv.num).trim()) ? String(inv.num).trim()
                 : (inv.customerId ? String(inv.customerId).trim() : '');
    // Sans aucune clé il n'y a pas de fiche Client pour porter le contact
    // (colonnes retirées d'Interventions) — le conserver dans la remarque.
    if (!numKey) {
      if (inv.tel)    remarqueParts.push('Tel: ' + String(inv.tel).trim());
      if (inv.numSec) remarqueParts.push('Tel2: ' + String(inv.numSec).trim());
      if (inv.loc)    remarqueParts.push('Localité: ' + String(inv.loc).trim());
    }
    rowInv[ii.remarque]     = remarqueParts.join(' • ');
    rowInv[ii.reporteDepuis]= inv.reporteDepuis || '';
    rowInv[ii.maj]          = now;
    rowInv[ii.ville]        = inv.ville    || '';
    rowInv[ii.quartier]     = inv.quartier || '';
    rowInv[ii.duree]        = 0; // 0 à la création
    if (ii.publiePar >= 0) rowInv[ii.publiePar] = session ? session.nom : '';
    sheet2.appendRow(rowInv);
    // Ligne résiliation créée « Réalisé » : la teinter en vert dès maintenant
    // (formaterFeuille ne recolore pas par statut, seul updateStatus le fait).
    if (estResiliation) {
      sheet2.getRange(sheet2.getLastRow(), 1, 1, ii.total).setBackground('#dcfce7');
    }

    // Résiliation : ne PAS ré-injecter la fiche dans les feuilles actives —
    // elle est au contraire retirée et archivée juste après.
    if (estResiliation) {
      archiverClientResilie_({
        service:  typeToService(inv.typeLabel || inv.type),
        num:      numKey,
        nom:      inv.nom,
        ville:    inv.ville,
        quartier: inv.quartier,
        motif:    inv.motif,
        date:     date,
        par:      session ? session.nom : ''
      });
      return; // intervention suivante — pas d'upsert client
    }

    // Upsert clients pour toute intervention identifiable (numéro de ligne
    // réel, ou Customer ID pour les études) — c'est la fiche Client qui
    // porte le contact affiché aux techniciens. Le service du type choisit
    // la feuille (FTTH ou Cuivre) ; une fiche trouvée dans l'autre feuille
    // est déplacée (reclassement, ex. migration cuivre → FTTH).
    if (numKey && typeToService(inv.typeLabel || inv.type) !== 'LS') {
      const numClean = numKey.replace(/\s/g,'');
      const service  = typeToService(inv.typeLabel || inv.type);
      const sheetCli = sheetForService_(service);
      const c        = getClientsIdx(sheetCli);

      function buildClientRow() {
        const row = new Array(c.total).fill('');
        row[c.num]      = numKey;
        row[c.nom]      = String(inv.nom || '').toUpperCase();
        row[c.tel]      = inv.tel    || '';
        row[c.telSec]   = inv.numSec || '';
        row[c.loc]      = inv.loc      || '';
        row[c.ville]    = inv.ville    || '';
        row[c.quartier] = inv.quartier || '';
        row[c.gps]      = '';
        row[c.maj]      = now;
        return row;
      }

      const existant = trouverClientRow_(numClean);
      if (existant && existant.sheet.getName() === sheetCli.getName()) {
        if (inv.updateClient) {
          // Préserver le GPS existant lors d'une mise à jour complète
          const row = buildClientRow();
          row[c.gps] = String(existant.row[existant.c.gps] || '');
          sheetCli.getRange(existant.rowIndex, 1, 1, c.total).setValues([row]);
        } else {
          // Le numéro secondaire saisi doit persister même sans mise à
          // jour complète de la fiche (il n'était écrit qu'à la création).
          if (inv.numSec) sheetCli.getRange(existant.rowIndex, c.telSec+1).setValue(String(inv.numSec).trim());
          sheetCli.getRange(existant.rowIndex, c.maj+1).setValue(now);
        }
      } else if (existant) {
        // Reclassement : déplacer la fiche vers la feuille du nouveau service
        // en préservant ses champs déjà connus (complétés par la saisie).
        const ec = existant.c;
        const row = buildClientRow();
        row[c.nom]      = String(inv.nom || existant.row[ec.nom] || '').toUpperCase();
        row[c.tel]      = inv.tel      || String(existant.row[ec.tel]      || '');
        row[c.telSec]   = inv.numSec   || String(existant.row[ec.telSec]   || '');
        row[c.loc]      = inv.loc      || String(existant.row[ec.loc]      || '');
        row[c.ville]    = inv.ville    || String(existant.row[ec.ville]    || '');
        row[c.quartier] = inv.quartier || String(existant.row[ec.quartier] || '');
        row[c.gps]      = String(existant.row[ec.gps] || '');
        existant.sheet.deleteRow(existant.rowIndex);
        sheetCli.appendRow(row);
      } else {
        sheetCli.appendRow(buildClientRow());
        SpreadsheetApp.flush();
      }
    }

    // Les clients LS n'ont pas de numéro de ligne : ils vivent dans leur
    // propre feuille, identifiés par nom (voir upsertClientLs_).
    if (typeToService(inv.typeLabel || inv.type) === 'LS' && inv.nom) {
      upsertClientLs_({
        nom: inv.nom, tel: inv.tel, telSec: inv.numSec, loc: inv.loc,
        ville: inv.ville, quartier: inv.quartier, pop: inv.pop, gps: inv.gps, maj: now
      });
    }
  });

  formaterFeuille(sheet2);
  recalculerAgregatsMois(date.substring(0,7));
  return { success: true, consistId };
}

// ============================================================
//  METTRE À JOUR STATUT
// ============================================================
function updateStatus(data, session) {
  const sheet = s2();
  const { invId, statut, remarque } = data;
  ensureInvAuditCols(sheet);
  const rows = sheet.getDataRange().getValues();
  const ii   = getInvIdx(sheet);

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][ii.id]) === String(invId)) {
      sheet.getRange(i+1, ii.statut+1).setValue(statut);
      sheet.getRange(i+1, ii.remarque+1).setValue(remarque||'');
      sheet.getRange(i+1, ii.maj+1).setValue(new Date().toLocaleString('fr-FR'));
      if (ii.statutPar >= 0 && session) sheet.getRange(i+1, ii.statutPar+1).setValue(session.nom);
      if (ii.panne >= 0) {
        let panne = data.panne;
        if (panne === undefined) {
          // Ancien client en cache : la panne arrive encore composée dans la
          // remarque ("Panne: X • …") — l'extraire pour remplir la colonne.
          const m = /(?:^|• )Panne: ([^•]+)/.exec(String(remarque || ''));
          panne = m ? m[1].trim() : undefined;
        }
        if (panne !== undefined) sheet.getRange(i+1, ii.panne+1).setValue(String(panne));
      }
      const colors = {'Réalisé':'#dcfce7','Injoignable':'#fee2e2','Problème':'#ede9fe','En attente':'#ffffff'};
      sheet.getRange(i+1, 1, 1, ii.total).setBackground(colors[statut]||'#ffffff');
      const dateStr = normDate(rows[i][ii.date]);
      if (dateStr) recalculerAgregatsMois(dateStr.substring(0,7));
      return { success: true };
    }
  }
  return { success: false, error: 'Intervention introuvable : '+invId };
}

// ============================================================
//  RÉCUPÉRER PAR DATE
// ============================================================
function getByDate(params) {
  try { reporterInterventionsEnAttente(); } catch(e) {}

  const date   = String(params.date||new Date().toISOString().split('T')[0]).trim();
  const sheet1 = s1(), sheet2 = s2();
  const ci     = getConsistIdx(sheet1);
  const ii     = getInvIdx(sheet2);
  const cRows  = sheet1.getDataRange().getValues();

  let consist = null;
  for (let i = 1; i < cRows.length; i++) {
    if (normDate(cRows[i][ci.date]) === date) {
      consist = { id:String(cRows[i][ci.id]), date };
      break;
    }
  }
  if (!consist) return { success:false, error:'Aucune consistance pour le '+date };

  const iRows = sheet2.getDataRange().getValues();
  const joinMap = getClientsJoinMap();
  const interventions = [];
  for (let i = 1; i < iRows.length; i++) {
    if (String(iRows[i][ii.cid]) === consist.id) {
      const remarque      = String(iRows[i][ii.remarque]);
      const reporteDepuis = normDate(iRows[i][ii.reporteDepuis]);
      const statut        = String(iRows[i][ii.statut]);
      const dateLigne      = normDate(iRows[i][ii.date]);
      const numClean      = String(iRows[i][ii.num] || '').trim().replace(/\s/g,'');
      const cli           = joinMap[numClean] || contactDepuisRemarque(remarque);
      interventions.push({
        id:           String(iRows[i][ii.id]),
        type:         String(iRows[i][ii.type]),
        num:          String(iRows[i][ii.num]),
        nom:          String(iRows[i][ii.nom]),
        tel:          cli.tel,
        telSec:       cli.telSec || '',
        loc:          cli.loc,
        statut,
        panne:        ii.panne >= 0 ? String(iRows[i][ii.panne] || '') : '',
        remarque,
        reporteDepuis,
        ville:        String(iRows[i][ii.ville]    || ''),
        quartier:     String(iRows[i][ii.quartier] || ''),
        gps:          '',
        duree:        calculerDuree(reporteDepuis, dateLigne, statut),
        estTransfere: remarque.startsWith('➡️ Reporté au'),
        publiePar:    ii.publiePar >= 0 ? String(iRows[i][ii.publiePar] || '') : '',
        statutPar:    ii.statutPar >= 0 ? String(iRows[i][ii.statutPar] || '') : ''
      });
    }
  }
  return { success:true, consist, interventions };
}

// ============================================================
//  RÉCUPÉRER L'HISTORIQUE — avec filtre optionnel par mois
//  pour accélérer le chargement (ne transfère que les données
//  du mois demandé au lieu de tout l'historique).
// ============================================================
//  POIDS DES STATUTS pour déduplication (le plus avancé gagne)
// ============================================================
function statutPoids(s) {
  if (s === 'Réalisé')    return 4;
  if (s === 'Problème')   return 3;
  if (s === 'Injoignable')return 2;
  return 1; // En attente ou autre
}

function getAll(params) {
  const monthFilter = params && params.month ? String(params.month) : null;
  const sheet1 = s1(), sheet2 = s2();
  const ci = getConsistIdx(sheet1);
  const ii = getInvIdx(sheet2);
  const cRows = sheet1.getDataRange().getValues();
  const iRows = sheet2.getDataRange().getValues();
  const availableMonths = new Set();

  const consistMap = {};
  for (let i = 1; i < cRows.length; i++) {
    const rd = normDate(cRows[i][ci.date]);
    if (rd) availableMonths.add(rd.substring(0,7));
    consistMap[String(cRows[i][ci.id])] = { date: rd };
  }

  const allInvsMois = [];
  const joinMap = getClientsJoinMap();
  for (let j = 1; j < iRows.length; j++) {
    const cid    = String(iRows[j][ii.cid]);
    const consist = consistMap[cid];
    if (!consist) continue;
    if (monthFilter && consist.date.substring(0,7) !== monthFilter) continue;
    const remarque = String(iRows[j][ii.remarque]);
    const numClean = String(iRows[j][ii.num] || '').trim().replace(/\s/g,'');
    const cli      = joinMap[numClean] || contactDepuisRemarque(remarque);
    allInvsMois.push({
      id:           String(iRows[j][ii.id]),
      cid,
      date:         consist.date,
      type:         String(iRows[j][ii.type]),
      num:          String(iRows[j][ii.num]),
      nom:          String(iRows[j][ii.nom]),
      tel:          cli.tel,
      telSec:       cli.telSec || '',
      loc:          cli.loc,
      statut:       String(iRows[j][ii.statut]),
      panne:        ii.panne >= 0 ? String(iRows[j][ii.panne] || '') : '',
      remarque,
      reporteDepuis:normDate(iRows[j][ii.reporteDepuis]),
      ville:        String(iRows[j][ii.ville]    || ''),
      quartier:     String(iRows[j][ii.quartier] || ''),
      gps:          '',
      duree:        Number(iRows[j][ii.duree]    || 0)
    });
  }

  // ── ÉTAPE 2 : déduplication sur l'ensemble du mois ──
  // Clé = nom + num + type uniquement.
  // Dans chaque groupe, on garde :
  //   1. Le statut le plus avancé (Réalisé > Problème > Injoignable > En attente)
  //   2. En cas d'égalité, la ligne la plus récente (date la plus haute)
  //   3. La durée la plus longue du groupe (couvre tout le parcours)
  // On exclut les lignes marquées comme ancien transfert (remark "➡️ Reporté au").
  const deduped = {};
  allInvsMois.forEach(inv => {
    if (inv.remarque && inv.remarque.startsWith('➡️ Reporté au')) return;

    const cle = inv.nom.trim().toUpperCase() + '|' + inv.num.trim() + '|' + inv.type;
    const origine = (inv.reporteDepuis && inv.reporteDepuis !== 'null' && inv.reporteDepuis !== '')
      ? inv.reporteDepuis : inv.date;

    if (!deduped[cle]) {
      deduped[cle] = {...inv, datePremiere: origine};
    } else {
      const ex = deduped[cle];
      const pi = statutPoids(inv.statut), pe = statutPoids(ex.statut);
      const garder = pi > pe || (pi === pe && inv.date > ex.date);
      if (garder) {
        deduped[cle] = {
          ...inv,
          datePremiere: ex.datePremiere || origine // conserver la date d'origine la plus ancienne
        };
      } else {
        // Conserver la date d'origine la plus ancienne
        deduped[cle] = {
          ...ex,
          datePremiere: (origine < ex.datePremiere) ? origine : ex.datePremiere
        };
      }
    }
  });

  // ── ÉTAPE 3 : redistribuer dans les fiches par jour ──
  // L'intervention dédupliquée est rattachée à la fiche de son dernier statut
  // (= la fiche dont elle provient après déduplication).
  const ficheMap = {};
  for (let i = 1; i < cRows.length; i++) {
    const cid = String(cRows[i][ci.id]);
    const rd  = normDate(cRows[i][ci.date]);
    if (monthFilter && rd.substring(0,7) !== monthFilter) continue;
    ficheMap[cid] = { id:cid, date:rd, interventions:[] };
  }

  Object.values(deduped).forEach(inv => {
    if (ficheMap[inv.cid]) {
      const origine = inv.datePremiere || inv.reporteDepuis;
      ficheMap[inv.cid].interventions.push({
        id:inv.id, type:inv.type, num:inv.num, nom:inv.nom,
        tel:inv.tel, loc:inv.loc, statut:inv.statut, remarque:inv.remarque,
        reporteDepuis:origine,
        ville:inv.ville, quartier:inv.quartier, gps:inv.gps,
        duree:calculerDuree(origine, inv.date, inv.statut),
        date:inv.date  // date de la ligne retenue (dernière itération)
      });
    }
  });

  // Trier les fiches par date et retourner seulement celles avec des interventions
  const result = Object.values(ficheMap)
    .filter(f => f.interventions.length > 0)
    .sort((a,b) => a.date.localeCompare(b.date));

  return { success:true, data:result, availableMonths:[...availableMonths].sort().reverse() };
}

// ============================================================
//  REPORT AUTOMATIQUE (23h)
// ============================================================
// ============================================================
//  SAUVEGARDE HEBDOMADAIRE
//  Copie complète du classeur chaque dimanche, rangée dans le dossier
//  Drive "CERAF Bafoussam/autosave". Le marqueur anti-doublon vit dans
//  une feuille cachée _Config car reporterInterventionsEnAttente est
//  appelé à chaque getByDate, pas seulement par le trigger de 1h.
//  Le déplacement DriveApp est isolé dans son propre try/catch : si le
//  scope Drive n'a pas (encore) été autorisé, la sauvegarde reste à la
//  racine du Drive au lieu d'échouer.
// ============================================================
const AUTOSAVE_FOLDER_ID = '145BjForGkB1RRaMHDqOqJHf0rACqy3lU'; // CERAF Bafoussam/autosave

function sauvegardeHebdoSiDimanche(force) {
  const now = new Date();
  if (!force && now.getDay() !== 0) return; // dimanche uniquement
  const ss = getSS();
  let cfg = ss.getSheetByName('_Config');
  if (!cfg) { cfg = ss.insertSheet('_Config'); cfg.hideSheet(); }
  const aujourd = normDate(now);
  if (String(cfg.getRange('B1').getValue()) === 'sauvegarde:' + aujourd) return; // déjà faite
  const backup = SpreadsheetApp.create('CERAF BD — sauvegarde ' + aujourd);
  ss.getSheets().forEach(function(sh) {
    if (sh.getName() === '_Config') return;
    sh.copyTo(backup).setName(sh.getName());
  });
  backup.deleteSheet(backup.getSheets()[0]); // feuille vide créée par défaut
  cfg.getRange('B1').setValue('sauvegarde:' + aujourd);
  try {
    DriveApp.getFileById(backup.getId()).moveTo(DriveApp.getFolderById(AUTOSAVE_FOLDER_ID));
  } catch(e) { Logger.log('Déplacement autosave impossible (autorisation Drive ?) : ' + e); }
  return backup.getUrl();
}

// À exécuter UNE FOIS depuis l'éditeur Apps Script (déclenche la demande
// d'autorisation Drive) : range dans "CERAF Bafoussam/autosave" les
// sauvegardes déjà créées à la racine du Drive.
function rangerSauvegardesExistantes() {
  const dossier = DriveApp.getFolderById(AUTOSAVE_FOLDER_ID);
  const fichiers = DriveApp.searchFiles("title contains 'CERAF BD — sauvegarde' and 'root' in parents");
  let n = 0;
  while (fichiers.hasNext()) { fichiers.next().moveTo(dossier); n++; }
  Logger.log(n + ' sauvegarde(s) déplacée(s) vers autosave.');
}

// ============================================================
//  RAPPORT KPI MENSUEL
//  À chaque fin de mois (à partir de juillet 2026), un onglet
//  "<MOIS> <ANNEE>" est ajouté au classeur KPI du dossier Drive
//  "CERAF Bafoussam/KPI", au même format que les onglets
//  historiques (JANVIER 2026 → JUIN 2026) :
//  réseaux FTTH et CUIVRE × (ETUDES / INSTALLATION / DERANGEMENTS /
//  RESILIATIONS) × (REPORTS / SIGNALES / TRAITES / INSTANCES),
//  par localité + ligne RECAPITULATIF.
//  Les chiffres sortent de getAll(mois) — la même déduplication que
//  l'Historique de l'app. Sémantique des colonnes :
//    REPORTS   = origine (Reporté_depuis) antérieure au 1er du mois
//    SIGNALES  = origine dans le mois
//    TRAITES   = statut Réalisé
//    INSTANCES = tout le reste (En attente / Injoignable / Problème)
//  → REPORTS + SIGNALES = TRAITES + INSTANCES.
//  Non suivis dans l'app, donc à 0 : ETUDES et INSTALLATIONS Cuivre.
//  Les types LS sont hors périmètre du fichier (« KPI des lignes FTTH
//  et Cuivre »). RESILIATIONS est alimenté depuis les interventions
//  de type Résiliation (voir categorie() ci-dessous).
// ============================================================
const KPI_FOLDER_ID = '1SafHiZpobh9TVphdtNFScFw3rSOQ0YJl'; // CERAF Bafoussam/KPI
const KPI_MOIS_FR = ['JANVIER','FEVRIER','MARS','AVRIL','MAI','JUIN',
                     'JUILLET','AOUT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DECEMBRE'];

// Le classeur KPI d'origine est un .xlsx : SpreadsheetApp ne peut pas y
// écrire. Au premier appel, il est converti en Google Sheets (l'original
// est conservé tel quel) et l'ID du classeur converti est mémorisé dans
// _Config!B2 pour les mois suivants.
function getKpiSpreadsheet_() {
  const ss = getSS();
  let cfg = ss.getSheetByName('_Config');
  if (!cfg) { cfg = ss.insertSheet('_Config'); cfg.hideSheet(); }
  const stored = String(cfg.getRange('B2').getValue() || '');
  if (stored) {
    try { return SpreadsheetApp.openById(stored); } catch(e) { /* supprimé → re-résoudre */ }
  }
  const dossier = DriveApp.getFolderById(KPI_FOLDER_ID);
  const gsheets = dossier.getFilesByType(MimeType.GOOGLE_SHEETS);
  if (gsheets.hasNext()) {
    const f = gsheets.next();
    cfg.getRange('B2').setValue(f.getId());
    return SpreadsheetApp.openById(f.getId());
  }
  const xls = dossier.getFilesByType(MimeType.MICROSOFT_EXCEL);
  if (!xls.hasNext()) throw new Error('Aucun classeur KPI (.xlsx ou Google Sheets) dans le dossier KPI');
  const src = xls.next();
  const copie = Drive.Files.copy(
    { name: src.getName().replace(/\.xlsx?$/i, ''), mimeType: MimeType.GOOGLE_SHEETS, parents: [KPI_FOLDER_ID] },
    src.getId()
  );
  cfg.getRange('B2').setValue(copie.id);
  return SpreadsheetApp.openById(copie.id);
}

function sansAccents_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function genererRapportKpi(mois) { // mois au format 'YYYY-MM'
  mois = String(mois || '');
  if (!/^\d{4}-\d{2}$/.test(mois)) return { success:false, error:'Paramètre month attendu au format YYYY-MM' };

  const all = getAll({ month: mois });
  const debut = mois + '-01';

  // Type stocké → [réseau, catégorie du tableau]. Matching insensible aux
  // accents/majuscules car les libellés historiques ont varié.
  function categorie(type) {
    const t = sansAccents_(type).toLowerCase();
    if (t.indexOf('cuivre') !== -1) {
      if (t.indexOf('resil')   !== -1) return ['CUIVRE','RESILIATIONS'];
      if (t.indexOf('derang')  !== -1) return ['CUIVRE','DERANGEMENTS'];
      if (t.indexOf('etude')   !== -1) return ['CUIVRE','ETUDES'];
      if (t.indexOf('install') !== -1) return ['CUIVRE','INSTALLATIONS'];
      return null;
    }
    if (t.indexOf('ftth') !== -1) {
      if (t.indexOf('resil')   !== -1) return ['FTTH','RESILIATIONS'];
      if (t.indexOf('etude')   !== -1) return ['FTTH','ETUDES'];
      if (t.indexOf('install') !== -1) return ['FTTH','INSTALLATION'];
      if (t.indexOf('derang')  !== -1) return ['FTTH','DERANGEMENTS'];
    }
    return null; // LS et types inconnus : hors périmètre de ce rapport
  }

  const VILLES = ['BAFOUSSAM','BANDJOUN','BAHAM','FOUMBOT'];
  const CATS = [['FTTH','ETUDES'],['FTTH','INSTALLATION'],['FTTH','DERANGEMENTS'],['FTTH','RESILIATIONS'],
                ['CUIVRE','ETUDES'],['CUIVRE','INSTALLATIONS'],['CUIVRE','DERANGEMENTS'],['CUIVRE','RESILIATIONS']];
  const compte = {};
  VILLES.forEach(v => {
    compte[v] = {};
    CATS.forEach(c => { compte[v][c.join('|')] = { rep:0, sig:0, tra:0, inst:0 }; });
  });

  let nb = 0;
  (all.data || []).forEach(fiche => fiche.interventions.forEach(inv => {
    const cat = categorie(inv.type);
    if (!cat) return;
    let ville = sansAccents_(inv.ville).toUpperCase().trim();
    if (VILLES.indexOf(ville) === -1) ville = 'BAFOUSSAM';
    const c = compte[ville][cat.join('|')];
    const origine = (inv.reporteDepuis && inv.reporteDepuis !== 'null' && inv.reporteDepuis !== '')
      ? inv.reporteDepuis : inv.date;
    if (origine < debut) c.rep++; else c.sig++;
    if (inv.statut === 'Réalisé') c.tra++; else c.inst++;
    nb++;
  }));

  // ── Écriture de l'onglet (régénération idempotente) ──
  const annee   = Number(mois.substring(0,4));
  const moisNum = Number(mois.substring(5,7));
  const nomOnglet = KPI_MOIS_FR[moisNum-1] + ' ' + annee;
  const kss = getKpiSpreadsheet_();
  const ancien = kss.getSheetByName(nomOnglet);
  if (ancien) kss.deleteSheet(ancien);
  const sh = kss.insertSheet(nomOnglet, kss.getSheets().length);

  const NC = 33; // colonne A + 8 catégories × 4 indicateurs
  function ligneVide() { return new Array(NC).fill(''); }

  const l1 = ligneVide(); l1[0] = nomOnglet + ' KPI DES LIGNES FTTH ET CUIVRE';
  const l2 = ligneVide(); l2[0] = 'ANNEE ' + annee; l2[8] = 'MOIS ' + nomOnglet;
  const l3 = ligneVide(); l3[0] = 'CERAF / LOCALITE'; l3[1] = 'RESEAU : FTTH'; l3[17] = 'RESEAU : CUIVRE';
  const l4 = ligneVide();
  CATS.forEach((c,i) => { l4[1 + i*4] = c[1]; });
  const l5 = ligneVide();
  CATS.forEach((c,i) => {
    l5[1 + i*4] = 'REPORTS'; l5[2 + i*4] = 'SIGNALES'; l5[3 + i*4] = 'TRAITES'; l5[4 + i*4] = 'INSTANCES';
  });

  const lignesVilles = VILLES.map(v => {
    const l = ligneVide(); l[0] = v;
    CATS.forEach((c,i) => {
      const x = compte[v][c.join('|')];
      l[1+i*4] = x.rep; l[2+i*4] = x.sig; l[3+i*4] = x.tra; l[4+i*4] = x.inst;
    });
    return l;
  });
  const lRecap = ligneVide(); lRecap[0] = 'RECAPITULATIF';
  for (let col = 1; col < NC; col++) {
    lRecap[col] = lignesVilles.reduce((s,l) => s + (Number(l[col]) || 0), 0);
  }

  const donnees = [l1, l2, l3, l4, l5].concat(lignesVilles).concat([lRecap]);
  sh.getRange(1, 1, donnees.length, NC).setValues(donnees);

  // ── Mise en forme ──
  const nbLignes = donnees.length;
  sh.getRange(1,1,1,NC).merge().setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center').setBackground('#1e3a8a').setFontColor('#ffffff');
  sh.getRange(3,1,3,1).merge();
  sh.getRange(3,2,1,16).merge().setBackground('#dbeafe');
  sh.getRange(3,18,1,16).merge().setBackground('#ffedd5');
  CATS.forEach((c,i) => { sh.getRange(4, 2+i*4, 1, 4).merge(); });
  sh.getRange(3,1,3,NC).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(5,2,1,NC-1).setFontSize(8);
  sh.getRange(4,2,1,16).setBackground('#eff6ff');
  sh.getRange(4,18,1,16).setBackground('#fff7ed');
  sh.getRange(6,1,VILLES.length+1,1).setFontWeight('bold');
  sh.getRange(nbLignes,1,1,NC).setFontWeight('bold').setBackground('#e2e8f0');
  sh.getRange(3,1,nbLignes-2,NC).setBorder(true,true,true,true,true,true);
  sh.getRange(6,2,VILLES.length+1,NC-1).setHorizontalAlignment('center');
  sh.setColumnWidth(1, 130);
  for (let col = 2; col <= NC; col++) sh.setColumnWidth(col, 58);
  sh.setFrozenRows(5);

  return { success:true, mois:mois, onglet:nomOnglet, interventions:nb, url:kss.getUrl() };
}

// Appelée par le trigger nocturne : au premier passage dans un nouveau
// mois, génère l'onglet KPI du mois qui vient de se terminer.
// Marqueur anti-doublon dans _Config!B3. Premier rapport : juillet 2026.
function genererKpiMoisPrecedentSiBesoin_() {
  const now = new Date();
  const prec = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mois = normDate(prec).substring(0,7);
  if (mois < '2026-07') return;
  const ss = getSS();
  let cfg = ss.getSheetByName('_Config');
  if (!cfg) { cfg = ss.insertSheet('_Config'); cfg.hideSheet(); }
  if (String(cfg.getRange('B3').getValue()) === 'kpi:' + mois) return;
  genererRapportKpi(mois);
  cfg.getRange('B3').setValue('kpi:' + mois);
}

function reporterInterventionsEnAttente() {
  // Throttle : ce balayage (report + agrégats + sauvegarde/KPI) n'a de sens
  // qu'UNE fois par jour. Il est déclenché par le trigger de 1h ET par chaque
  // getByDate (filet de sécurité au cas où le trigger n'aurait pas tourné).
  // Sans throttle, chaque lancement d'app relisait TOUTE la feuille
  // Interventions une fois par jour d'historique (boucle sur pastConsists),
  // d'où un getByDate à ~5 s ressenti « lent / hors ligne ». Un marqueur
  // "report:YYYY-MM-DD" dans _Config!B4 (B1=sauvegarde, B2=KPI sheet id,
  // B3=marqueur KPI) sert de chemin rapide : une fois posé (par le trigger de
  // nuit ou le 1er getByDate du jour), les appels suivants sortent
  // immédiatement, sans lock ni relecture de feuille.
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = normDate(today);
  try {
    const cfg0 = getSS().getSheetByName('_Config');
    if (cfg0 && String(cfg0.getRange('B4').getValue()) === 'report:' + todayStr) return;
  } catch(e) {}

  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(3000);
  if (!gotLock) return;

  try {
    // Re-vérification sous le lock : une requête concurrente a pu poser le
    // marqueur pendant qu'on attendait le lock (matinée : toute l'équipe ouvre
    // l'app en même temps).
    let cfg = getSS().getSheetByName('_Config');
    if (cfg && String(cfg.getRange('B4').getValue()) === 'report:' + todayStr) return;

    try { sauvegardeHebdoSiDimanche(); } catch(e) { Logger.log('Sauvegarde: ' + e); }
    try { genererKpiMoisPrecedentSiBesoin_(); } catch(e) { Logger.log('KPI: ' + e); }
    const sheet1 = s1(), sheet2 = s2();
    const ci = getConsistIdx(sheet1);
    const ii = getInvIdx(sheet2);

    function nextWorkingDay(fromStr) {
      const [y,m,d] = fromStr.split('-').map(Number);
      const dt = new Date(y, m-1, d);
      dt.setDate(dt.getDate()+1);
      while (dt.getDay()===0||dt.getDay()===6) dt.setDate(dt.getDate()+1);
      return normDate(dt);
    }

    // Pose le marqueur de throttle (chemin rapide pour les appels suivants du jour)
    function marquerJour() {
      if (!cfg) { cfg = getSS().getSheetByName('_Config') || getSS().insertSheet('_Config'); cfg.hideSheet(); }
      cfg.getRange('B4').setValue('report:' + todayStr);
    }

    const cRows = sheet1.getDataRange().getValues();
    const pastConsists = [];
    for (let i=1; i<cRows.length; i++) {
      const d = normDate(cRows[i][ci.date]);
      if (d && d < todayStr) {
        pastConsists.push({ id:String(cRows[i][ci.id]), date:d, rowIndex:i+1 });
      }
    }
    if (pastConsists.length===0) { marquerJour(); return; }

    pastConsists.sort((a,b)=>a.date.localeCompare(b.date));
    const now = new Date().toLocaleString('fr-FR');
    let totalReportees = 0;
    const moisAffectes = new Set();

    pastConsists.forEach(consist => {
      const iRows = sheet2.getDataRange().getValues();
      const aReporter = [], rowIndicesToMark = [];

      for (let i=1; i<iRows.length; i++) {
        const statutLigne = String(iRows[i][ii.statut]);
        if (String(iRows[i][ii.cid])===consist.id &&
            (statutLigne==='En attente'||statutLigne==='Injoignable'||statutLigne==='Problème')) {
          aReporter.push({
            type:         String(iRows[i][ii.type]),
            num:          String(iRows[i][ii.num]),
            nom:          String(iRows[i][ii.nom]),
            remarque:     String(iRows[i][ii.remarque]||''),
            panne:        ii.panne >= 0 ? String(iRows[i][ii.panne]||'') : '',
            reporteDepuis:normDate(iRows[i][ii.reporteDepuis])||consist.date,
            ville:        String(iRows[i][ii.ville]    ||''),
            quartier:     String(iRows[i][ii.quartier] ||''),
            duree:        Number(iRows[i][ii.duree]    ||0),
            publiePar:    ii.publiePar >= 0 ? String(iRows[i][ii.publiePar]||'') : ''
          });
          rowIndicesToMark.push(i+1);
        }
      }
      if (aReporter.length===0) return;
      aReporter.forEach(inv => { if (inv.reporteDepuis) moisAffectes.add(inv.reporteDepuis.substring(0,7)); });

      let targetDate = nextWorkingDay(consist.date);
      if (targetDate < todayStr) targetDate = todayStr;
      moisAffectes.add(consist.date.substring(0,7));
      moisAffectes.add(targetDate.substring(0,7));

      const nextId  = 'C_' + targetDate.replace(/-/g,'');
      const cRows2  = sheet1.getDataRange().getValues();
      let exists=false, exRow=-1, exNb=0;
      for (let i=1; i<cRows2.length; i++) {
        if (String(cRows2[i][ci.id])===nextId) { exists=true; exRow=i+1; exNb=Number(cRows2[i][ci.nb])||0; break; }
      }
      if (!exists) {
        const row1 = new Array(ci.total).fill('');
        row1[ci.id]=nextId; row1[ci.date]=targetDate;
        row1[ci.nb]=aReporter.length; row1[ci.creeLe]=now+' (report auto)';
        sheet1.appendRow(row1);
      } else {
        sheet1.getRange(exRow, ci.nb+1).setValue(exNb+aReporter.length);
      }

      aReporter.forEach((inv,idx) => {
        const remarque     = (inv.remarque&&inv.remarque!=='null'&&inv.remarque!=='') ? inv.remarque : '';
        const nouvelleDuree = inv.duree + 1;
        const rowInv = new Array(ii.total).fill('');
        rowInv[ii.id]           = nextId+'_R'+(Date.now()+idx)+'_'+idx;
        rowInv[ii.cid]          = nextId;
        rowInv[ii.date]         = targetDate;
        rowInv[ii.type]         = inv.type;
        rowInv[ii.num]          = inv.num;
        rowInv[ii.nom]          = inv.nom;
        rowInv[ii.statut]       = 'En attente';
        if (ii.panne >= 0) rowInv[ii.panne] = inv.panne || '';
        rowInv[ii.remarque]     = remarque;
        rowInv[ii.reporteDepuis]= inv.reporteDepuis||consist.date;
        rowInv[ii.maj]          = now;
        rowInv[ii.ville]        = inv.ville;
        rowInv[ii.quartier]     = inv.quartier;
        rowInv[ii.duree]        = nouvelleDuree;
        if (ii.publiePar >= 0) rowInv[ii.publiePar] = inv.publiePar || '';
        sheet2.appendRow(rowInv);
      });

      rowIndicesToMark.sort((a,b)=>b-a).forEach(rowIdx => sheet2.deleteRow(rowIdx));

      // NE PAS réécrire Nb_Interventions avec les lignes physiques restantes
      // (= seulement les réalisées) ni supprimer la fiche vidée : les vrais
      // compteurs (photo de fin de journée : réalisées + instances) sont
      // reconstruits par recalculerAgregatsMois() ci-dessous, et la fiche
      // doit rester dans l'historique même si tout a été reporté.

      totalReportees += aReporter.length;
    });

    // Recalculer les agrégats (Nb_Interventions/Realisees/Instances) des mois
    // touchés par ce report, une fois tous les déplacements de lignes terminés —
    // avec la logique par date d'origine, immunisée contre le déplacement physique.
    moisAffectes.forEach(m => recalculerAgregatsMois(m));

    marquerJour();
    Logger.log(totalReportees+' intervention(s) reportée(s).');
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
//  SUPPRIMER UNE INTERVENTION PROPREMENT (depuis l'app)
//  Recalcule automatiquement Nb_Interventions et nettoie
//  la fiche du jour si elle devient vide.
// ============================================================
function deleteIntervention(data) {
  const sheet1 = s1(), sheet2 = s2();
  const invId = String(data.invId || '');
  if (!invId) return { success: false, error: 'ID intervention manquant' };
  const ci = getConsistIdx(sheet1);
  const ii = getInvIdx(sheet2);

  const iRows = sheet2.getDataRange().getValues();
  let consistId = null, rowToDelete = -1;
  for (let i = 1; i < iRows.length; i++) {
    if (String(iRows[i][ii.id]) === invId) {
      consistId  = String(iRows[i][ii.cid]);
      rowToDelete = i + 1;
      break;
    }
  }
  if (rowToDelete === -1) return { success: false, error: 'Intervention introuvable' };

  sheet2.deleteRow(rowToDelete);

  // NE PAS réécrire Nb_Interventions avec les lignes physiques restantes ni
  // supprimer la fiche vidée : les compteurs photo-de-fin-de-journée sont
  // reconstruits par recalculerAgregatsMois(). Écrire "remaining" laissait un
  // Nb incohérent (Nb ≠ Réalisées + Instances) dès que le recalcul n'avait
  // pas lieu — notamment quand la date de la ligne supprimée était corrompue.
  // On prend la date de la FICHE (fiable) en priorité, celle de la ligne en
  // secours, pour être sûr de toujours recalculer le bon mois.
  let moisARecalculer = null;
  const cRows = sheet1.getDataRange().getValues();
  for (let i = 1; i < cRows.length; i++) {
    if (String(cRows[i][ci.id]) === consistId) {
      const dFiche = normDate(cRows[i][ci.date]);
      if (dFiche) moisARecalculer = dFiche.substring(0,7);
      break;
    }
  }
  if (!moisARecalculer) {
    const dLigne = normDate(iRows[rowToDelete-1][ii.date]);
    if (dLigne) moisARecalculer = dLigne.substring(0,7);
  }
  if (moisARecalculer) recalculerAgregatsMois(moisARecalculer);
  return { success: true };
}

// ============================================================
//  RÉPARATION DES EN-TÊTES — à exécuter UNE FOIS
//  Ajoute la ligne d'en-têtes manquante sur Interventions
//  SANS toucher aux données existantes.
// ============================================================
function reparerEnTetes() {
  const sheet2 = getSS().getSheetByName(SHEET_INTERVENTIONS);
  let fixed = [];

  // Interventions — ajouter entête si manquante
  if (sheet2) {
    const firstCell = String(sheet2.getRange(1,1).getValue());
    if (firstCell !== 'ID_Intervention') {
      sheet2.insertRowBefore(1);
      sheet2.getRange(1,1,1,16).setValues([[
        'ID_Intervention','ID_Consistance','Date',
        'Type','Numero_Ligne','Nom_Client',
        'Statut','Panne','Remarque','Reporté_depuis','Mis_à_jour_le','Ville','Quartier','Duree_Jours','Publié_par','Statut_par'
      ]]).setFontWeight('bold').setBackground('#1d4ed8').setFontColor('white');
      fixed.push('Interventions (en-tête ajoutée)');
    }
  }

  notify(
    fixed.length > 0
      ? '✅ Réparations effectuées :\n\n- ' + fixed.join('\n- ')
      : 'ℹ️ Toutes les en-têtes sont déjà correctes, rien à faire.'
  );
}

// ============================================================
//  RÉPARATION DE LA BASE — à exécuter UNE FOIS depuis l'éditeur
//  si des lignes ont été supprimées manuellement dans le Sheet.
//  1) Recalcule Nb_Interventions pour chaque jour
//  2) Supprime les fiches "Consistances" devenues orphelines
//     (0 intervention restante)
//  Ne touche à AUCUNE donnée d'intervention existante.
// ============================================================
function reparerBaseDeDonnees() {
  const sheet1 = s1(), sheet2 = s2();
  const ci = getConsistIdx(sheet1);
  const ii = getInvIdx(sheet2);
  const cRows = sheet1.getDataRange().getValues();
  const iRows = sheet2.getDataRange().getValues();

  const counts = {};
  for (let i = 1; i < iRows.length; i++) {
    const cid = String(iRows[i][ii.cid]);
    if (!cid) continue;
    counts[cid] = (counts[cid] || 0) + 1;
  }

  let updated = 0, removed = 0;
  for (let i = cRows.length - 1; i >= 1; i--) {
    const cid = String(cRows[i][ci.id]);
    const realCount = counts[cid] || 0;
    if (realCount === 0) { sheet1.deleteRow(i+1); removed++; }
    else if (Number(cRows[i][ci.nb]) !== realCount) { sheet1.getRange(i+1, ci.nb+1).setValue(realCount); updated++; }
  }

  notify(
    '✅ Réparation terminée\n\n'+updated+' compteur(s) corrigé(s)\n'+removed+' fiche(s) orpheline(s) supprimée(s)'
  );
}

// ============================================================
//  RECALCULER LES AGRÉGATS PAR JOUR (Réalisées / Instances)
//  Pour chaque fiche du mois donné, on reconstitue la PHOTO DE FIN DE
//  JOURNÉE (minuit, juste avant le report automatique de 1h) :
//    - Nb_Interventions = interventions présentes sur la fiche ce jour-là
//                         (créées ce jour + arrivées par report)
//    - Realisees        = celles réalisées CE jour-là
//    - Instances        = celles encore ouvertes à la fin de ce jour
//    → Nb_Interventions = Realisees + Instances, toujours.
//
//  On ne compte PAS les lignes physiques (le report de 1h les déplace,
//  ce qui effondrerait le total des jours passés au nombre de réalisées).
//  On reconstruit la présence depuis les dates, qui ne bougent jamais :
//  une intervention d'origine O (Reporté_depuis) réalisée le jour C est
//  présente sur chaque fiche de O à C inclus — en instance de O à C-1,
//  réalisée le jour C. Une intervention encore ouverte est présente en
//  instance de O jusqu'à aujourd'hui. Les jours passés sont donc stables
//  ET reconstructibles à tout moment.
//
//  Une intervention reportée plusieurs fois existe en plusieurs lignes
//  physiques (une par report) — on ne garde que son état le plus avancé
//  (même logique de dédoublonnage que getAll()) pour ne la compter qu'une
//  seule fois.
// ============================================================
function recalculerAgregatsMois(monthKey) {
  const sheet1 = s1(), sheet2 = s2();
  const ci = getConsistIdx(sheet1);
  const ii = getInvIdx(sheet2);
  const cRows = sheet1.getDataRange().getValues();
  const iRows = sheet2.getDataRange().getValues();

  const consistMap = {};       // cid -> date de la fiche
  const consistsOfMonth = [];  // fiches du mois à mettre à jour
  for (let i = 1; i < cRows.length; i++) {
    const d = normDate(cRows[i][ci.date]);
    consistMap[String(cRows[i][ci.id])] = d;
    if (d && d.substring(0,7) === monthKey) {
      consistsOfMonth.push({ date: d, rowIndex: i + 1 });
    }
  }
  if (consistsOfMonth.length === 0) return;

  // Déduplication sur tout le classeur (une intervention reportée peut
  // avoir son origine dans un mois différent de celui affiché).
  const deduped = {};
  for (let j = 1; j < iRows.length; j++) {
    const cid     = String(iRows[j][ii.cid]);
    const rowDate = consistMap[cid];
    if (!rowDate) continue;
    const remarque = String(iRows[j][ii.remarque] || '');
    if (remarque.startsWith('➡️ Reporté au')) continue;

    const cle = String(iRows[j][ii.nom] || '').trim().toUpperCase() + '|'
      + String(iRows[j][ii.num] || '').trim() + '|' + String(iRows[j][ii.type] || '');
    const statut  = String(iRows[j][ii.statut] || '');
    const origine = normDate(iRows[j][ii.reporteDepuis]) || rowDate;

    if (!deduped[cle]) {
      deduped[cle] = { statut, date: rowDate, origine };
    } else {
      const ex = deduped[cle];
      const pNew = statutPoids(statut), pEx = statutPoids(ex.statut);
      const garder = pNew > pEx || (pNew === pEx && rowDate > ex.date);
      deduped[cle] = {
        statut:  garder ? statut  : ex.statut,
        date:    garder ? rowDate : ex.date,
        origine: (origine < ex.origine) ? origine : ex.origine
      };
    }
  }

  // Présence par jour : une intervention est présente sur chaque fiche
  // entre son origine et sa date de fin (= sa date de réalisation, ou
  // aujourd'hui si toujours ouverte).
  const todayStr = normDate(new Date());
  const invs = Object.values(deduped);
  consistsOfMonth.forEach(c => {
    let total = 0, realisees = 0;
    invs.forEach(inv => {
      const fin = (inv.statut === 'Réalisé') ? inv.date : todayStr;
      if (inv.origine <= c.date && c.date <= fin) {
        total++;
        if (inv.statut === 'Réalisé' && inv.date === c.date) realisees++;
      }
    });
    sheet1.getRange(c.rowIndex, ci.nb+1).setValue(total);
    sheet1.getRange(c.rowIndex, ci.realisees+1).setValue(realisees);
    sheet1.getRange(c.rowIndex, ci.instances+1).setValue(total - realisees);
  });
}


// ============================================================
//  RÉPARATION — Pousser vers AUJOURD'HUI les interventions
//  encore actives (En attente/Injoignable/Réalisé/Problème,
//  donc PAS "Transféré") qui sont restées coincées sur une
//  fiche passée. À exécuter UNE FOIS pour rattraper le retard
//  accumulé avant le correctif du calcul de date cible.
// ============================================================
function reparerInterventionsCoincees() {
  const sheet1 = s1(), sheet2 = s2();
  const ci = getConsistIdx(sheet1);
  const ii = getInvIdx(sheet2);
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = normDate(today);

  const cRows = sheet1.getDataRange().getValues();
  const iRows = sheet2.getDataRange().getValues();

  const consistDateById = {};
  for (let i = 1; i < cRows.length; i++) {
    consistDateById[String(cRows[i][ci.id])] = normDate(cRows[i][ci.date]);
  }

  const aDeplacer = [];
  for (let i = 1; i < iRows.length; i++) {
    const cid        = String(iRows[i][ii.cid]);
    const consistDate = consistDateById[cid];
    const remarque   = String(iRows[i][ii.remarque] || '');
    if (consistDate && consistDate < todayStr && !remarque.startsWith('➡️ Reporté au')) {
      aDeplacer.push({
        rowIndex: i+1, consistId: cid,
        type:     String(iRows[i][ii.type]),
        num:      String(iRows[i][ii.num]),
        nom:      String(iRows[i][ii.nom]),
        panne:    ii.panne >= 0 ? String(iRows[i][ii.panne]||'') : '',
        reporteDepuis: normDate(iRows[i][ii.reporteDepuis]) || consistDate,
        ville:    String(iRows[i][ii.ville]    || ''),
        quartier: String(iRows[i][ii.quartier] || ''),
        duree:    Number(iRows[i][ii.duree]    || 0)
      });
    }
  }

  if (aDeplacer.length === 0) {
    notify('ℹ️ Aucune intervention coincée. Tout est à jour.');
    return;
  }

  const now    = new Date().toLocaleString('fr-FR');
  const nextId = 'C_' + todayStr.replace(/-/g,'');
  const cRows2 = sheet1.getDataRange().getValues();
  let exists=false, exRow=-1, exNb=0;
  for (let i=1; i<cRows2.length; i++) {
    if (String(cRows2[i][ci.id])===nextId) { exists=true; exRow=i+1; exNb=Number(cRows2[i][ci.nb])||0; break; }
  }

  if (!exists) {
    const row1 = new Array(ci.total).fill('');
    row1[ci.id]=nextId; row1[ci.date]=todayStr;
    row1[ci.nb]=aDeplacer.length; row1[ci.creeLe]=now+' (réparation)';
    sheet1.appendRow(row1);
  } else {
    sheet1.getRange(exRow, ci.nb+1).setValue(exNb+aDeplacer.length);
  }

  aDeplacer.forEach((inv, idx) => {
    const rowInv = new Array(ii.total).fill('');
    rowInv[ii.id]           = nextId+'_FIX'+(Date.now()+idx)+'_'+idx;
    rowInv[ii.cid]          = nextId;
    rowInv[ii.date]         = todayStr;
    rowInv[ii.type]         = inv.type;
    rowInv[ii.num]          = inv.num;
    rowInv[ii.nom]          = inv.nom;
    if (ii.panne >= 0) rowInv[ii.panne] = inv.panne || '';
    rowInv[ii.statut]       = 'En attente';
    rowInv[ii.remarque]     = '(Réparé — reporté du '+formatDateFr(inv.reporteDepuis)+')';
    rowInv[ii.reporteDepuis]= inv.reporteDepuis;
    rowInv[ii.maj]          = now;
    rowInv[ii.ville]        = inv.ville;
    rowInv[ii.quartier]     = inv.quartier;
    rowInv[ii.duree]        = inv.duree + 1;
    sheet2.appendRow(rowInv);
  });

  aDeplacer.sort((a,b)=>b.rowIndex-a.rowIndex).forEach(inv => sheet2.deleteRow(inv.rowIndex));

  // Compteurs reconstruits par le recalcul photo-de-fin-de-journée (jamais
  // de "remaining" physique, jamais de suppression de fiche — voir
  // deleteIntervention pour la même logique).
  const moisAffectes = new Set([todayStr.substring(0,7)]);
  aDeplacer.forEach(inv => {
    const d = consistDateById[inv.consistId];
    if (d) moisAffectes.add(d.substring(0,7));
    if (inv.reporteDepuis) moisAffectes.add(inv.reporteDepuis.substring(0,7));
  });
  moisAffectes.forEach(m => recalculerAgregatsMois(m));

  notify('✅ '+aDeplacer.length+' intervention(s) déplacée(s) vers la fiche d\'aujourd\'hui ('+formatDateFr(todayStr)+').');
}

// ============================================================
//  MIGRATION — feuille Interventions (à exécuter UNE FOIS)
//  1. Insère la colonne Panne après Statut
//  2. Déplace "Panne: X" des remarques vers la colonne Panne
//  3. Supprime les colonnes Chef, Tel_Client, Localite
// ============================================================
function migrerColonnesInterventions() {
  const sheet = s2();
  ensureInvAuditCols(sheet); // crée Panne (après Statut) + audit si absents

  // Extraction des "Panne: X" contenus dans les remarques
  let h = getColMap(sheet);
  const rows = sheet.getDataRange().getValues();
  let extraites = 0;
  for (let i = 1; i < rows.length; i++) {
    const rem = String(rows[i][h['Remarque']] || '');
    if (rem.indexOf('Panne: ') === -1) continue;
    let panne = '';
    const rest = [];
    rem.split(' • ').forEach(seg => {
      if (seg.trim().indexOf('Panne: ') === 0) panne = seg.trim().slice(7).trim();
      else rest.push(seg);
    });
    if (panne) {
      sheet.getRange(i+1, h['Panne']+1).setValue(panne);
      sheet.getRange(i+1, h['Remarque']+1).setValue(rest.join(' • '));
      extraites++;
    }
  }

  // Suppression des colonnes encombrantes (relire la position après chaque
  // suppression : les index se décalent)
  const supprimees = [];
  ['Chef','Tel_Client','Localite'].forEach(nom => {
    const hh = getColMap(sheet);
    if (hh[nom] !== undefined) { sheet.deleteColumn(hh[nom]+1); supprimees.push(nom); }
  });

  return { success: true, pannesExtraites: extraites, colonnesSupprimees: supprimees };
}

// ============================================================
//  MIGRATION — feuille Consistances (à exécuter UNE FOIS)
//  Supprime la colonne Chef : la sélection du chef centre à la
//  publication n'est plus demandée (le nom du publicateur reste
//  tracé via Publié_par sur chaque intervention, colonne Interventions).
// ============================================================
function migrerColonnesConsistances() {
  const sheet = s1();
  const h = getColMap(sheet);
  if (h['Chef'] === undefined) return { success: true, colonneSupprimee: false };
  sheet.deleteColumn(h['Chef']+1);
  return { success: true, colonneSupprimee: true };
}

// ============================================================
//  MIGRATION — sépare 'Clients FTTH/cuivre' en deux feuilles
//  'Clients FTTH' et 'Clients Cuivre' (à exécuter UNE FOIS).
//  - Le Service de chaque ligne choisit la feuille (défaut FTTH).
//  - Les noms passent en MAJUSCULES.
//  - L'ancienne feuille est archivée (renommée), pas supprimée :
//    à effacer manuellement une fois le résultat vérifié.
// ============================================================
function migrerSeparerClients() {
  const ss  = getSS();
  const old = ss.getSheetByName('Clients FTTH/cuivre');
  if (!old) return { success: true, dejaFait: true };

  const h    = getColMap(old);
  const rows = old.getDataRange().getValues();
  const get  = (row, name) => h[name] !== undefined ? String(row[h[name]] || '').trim() : '';

  const ftth = [], cuivre = [];
  let serviceAutre = 0;
  for (let i = 1; i < rows.length; i++) {
    const num = get(rows[i], 'Numero');
    if (!num) continue;
    const service = get(rows[i], 'Service').toUpperCase();
    if (service !== 'FTTH' && service !== 'CUIVRE') serviceAutre++;
    const row = [
      num,
      get(rows[i], 'Nom').toUpperCase(),
      get(rows[i], 'Telephone'),
      get(rows[i], 'Tel_Secondaire'),
      get(rows[i], 'Localite'),
      get(rows[i], 'Ville'),
      get(rows[i], 'Quartier'),
      get(rows[i], 'GPS'),
      get(rows[i], 'Derniere_MAJ')
    ];
    (service === 'CUIVRE' ? cuivre : ftth).push(row);
  }

  const sheetF = s3ftth(), sheetC = s3cuivre();
  if (ftth.length)   sheetF.getRange(sheetF.getLastRow()+1, 1, ftth.length,   9).setValues(ftth);
  if (cuivre.length) sheetC.getRange(sheetC.getLastRow()+1, 1, cuivre.length, 9).setValues(cuivre);

  old.setName('zz_Clients_archive_20260710');
  return { success: true, ftth: ftth.length, cuivre: cuivre.length, serviceAutreClasseFtth: serviceAutre };
}

// ============================================================
//  MIGRATION — reprise de l'historique LS dans Clients LS
//  (à exécuter UNE FOIS). Les interventions LS n'ont jamais créé
//  de fiche client : le contact était encodé dans la Remarque
//  ("Tel: … • Tel2: … • Localité: …"). On rejoue tout l'historique
//  en ordre chronologique — la donnée non vide la plus récente gagne
//  (upsertClientLs_ ne remplace jamais par du vide).
// ============================================================
function migrerClientsLs() {
  const sheet2 = s2();
  const ii     = getInvIdx(sheet2);
  const rows   = sheet2.getDataRange().getValues();

  const lignes = [];
  for (let i = 1; i < rows.length; i++) {
    if (typeToService(rows[i][ii.type]) !== 'LS') continue;
    const nom = String(rows[i][ii.nom] || '').trim();
    if (!nom) continue;
    lignes.push({ row: rows[i], date: normDate(rows[i][ii.date]) });
  }
  lignes.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let crees = 0, maj = 0;
  lignes.forEach(l => {
    const remarque = String(l.row[ii.remarque] || '');
    const contact  = contactDepuisRemarque(remarque);
    let gps = '';
    remarque.split(' • ').forEach(seg => {
      const s = seg.trim();
      if (s.indexOf('GPS: ') === 0) gps = s.slice(5).trim();
    });
    const res = upsertClientLs_({
      nom:      l.row[ii.nom],
      tel:      contact.tel,
      telSec:   contact.telSec,
      loc:      contact.loc,
      ville:    String(l.row[ii.ville]    || ''),
      quartier: String(l.row[ii.quartier] || ''),
      gps
    });
    if (res === 'created') crees++;
    else if (res === 'updated') maj++;
  });

  return { success: true, lignesLsScannees: lignes.length, clientsCrees: crees, majEffectuees: maj };
}

// ============================================================
//  RÉPARATION DES AGRÉGATS MENSUELS — à exécuter UNE FOIS
//  Calcule Realisees/Instances pour tous les mois déjà existants
// ============================================================
function reparerAgregatsMensuels() {
  const sheet1 = s1();
  const ci = getConsistIdx(sheet1);
  const cRows = sheet1.getDataRange().getValues();
  const months = new Set();
  for (let i = 1; i < cRows.length; i++) {
    const d = normDate(cRows[i][ci.date]);
    if (d) months.add(d.substring(0,7));
  }
  months.forEach(m => recalculerAgregatsMois(m));
  notify('✅ Agrégats recalculés pour ' + months.size + ' mois.');
}

// ============================================================
//  HELPERS
// ============================================================

// Calcule le nombre de jours ouvrables (lundi-vendredi) entre
// deux dates au format "YYYY-MM-DD" (inclusif des deux bornes).
function joursOuvres(dateDebStr, dateFinStr) {
  if (!dateDebStr || !dateFinStr) return 0;
  const [dy, dm, dd] = dateDebStr.split('-').map(Number);
  const [fy, fm, fd] = dateFinStr.split('-').map(Number);
  const deb = new Date(dy, dm-1, dd);
  const fin = new Date(fy, fm-1, fd);
  if (fin < deb) return 0;
  let count = 0;
  const cur = new Date(deb);
  while (cur <= fin) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ============================================================
//  DURÉE RÉELLE D'UNE INTERVENTION (en jours ouvrés)
//  Calculée à la volée depuis les dates, plutôt que via un
//  compteur incrémenté chaque nuit (fragile en cas de panne
//  du trigger). Auto-réparant : toujours juste, quel que soit
//  l'historique de la ligne.
//  - Origine = reporteDepuis (1ère apparition) sinon la date de la ligne
//  - Fin     = date de la ligne si Réalisé (figée), sinon aujourd'hui
//  - Même jour création/résolution → 0
// ============================================================
function calculerDuree(reporteDepuis, dateLigne, statut) {
  const origine = (reporteDepuis && reporteDepuis !== 'null' && reporteDepuis !== '') ? reporteDepuis : dateLigne;
  const fin = (statut === 'Réalisé') ? dateLigne : normDate(new Date());
  if (!origine || !fin) return 0;
  return Math.max(0, joursOuvres(origine, fin) - 1);
}
function formaterFeuille(sheet){if(sheet.getLastRow()>1)sheet.autoResizeColumns(1,16);}
function formatDateFr(s){
  if(!s)return'?';const p=String(s).split('-');if(p.length<3)return s;
  const m=['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
  return parseInt(p[2])+' '+m[parseInt(p[1])-1]+' '+p[0];
}
