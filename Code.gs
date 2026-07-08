// ============================================================
//  CERAF BAFOUSSAM — Code.gs (v4.3)
// ============================================================

const SHEET_ID            = '1OH566jWxL8ph7-UWscrs3ZQt0elNAnPGcNqvjC-RA_w';
const SHEET_CONSIST       = 'Consistances';
const SHEET_INTERVENTIONS = 'Interventions';
const SHEET_CLIENTS       = 'Clients';
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
      sheet.appendRow(['ID_Consistance','Date','Chef','Nb_Interventions','Créé_le','Realisees','Instances']);
      sheet.getRange(1,1,1,7).setFontWeight('bold').setBackground('#1d4ed8').setFontColor('white');
    } else if (name === SHEET_INTERVENTIONS) {
      sheet.appendRow(['ID_Intervention','ID_Consistance','Date',
        'Type','Numero_Ligne','Nom_Client',
        'Statut','Panne','Remarque','Reporté_depuis','Mis_à_jour_le','Ville','Quartier','Duree_Jours','Publié_par','Statut_par']);
      sheet.getRange(1,1,1,16).setFontWeight('bold').setBackground('#1d4ed8').setFontColor('white');
    } else if (name === SHEET_CLIENTS) {
      sheet.appendRow(['Numero','Nom','Telephone','Localite','Ville','Quartier','Service','GPS','Derniere_MAJ']);
      sheet.getRange(1,1,1,9).setFontWeight('bold').setBackground('#0891b2').setFontColor('white');
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
function s1()     { return getOrCreateSheet(getSS(), SHEET_CONSIST); }
function s2()     { return getOrCreateSheet(getSS(), SHEET_INTERVENTIONS); }
function s3()     { return getOrCreateSheet(getSS(), SHEET_CLIENTS); }
function s4()     { return getOrCreateSheet(getSS(), SHEET_USERS); }

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
      if ((action === 'getAll' || action === 'getClients' || action === 'getClientHistory') && role === 'technicien') {
        result = { success: false, error: 'Accès réservé au chef centre' };
      }
      else if (action === 'getByDate')  result = getByDate(e.parameter);
      else if (action === 'getAll')     result = getAll(e.parameter);
      else if (action === 'getClients') result = getClients();
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
      const CHEF_ONLY  = ['deleteClient','deleteIntervention','saveClient'];
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
      else if (data.action === 'deleteClient')       result = deleteClient(data);
      else if (data.action === 'updateClientGPS')    result = updateClientGPS(data);
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
  s1(); s2(); s3(); s4();
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

// Feuille Clients
function getClientsIdx(sheet) {
  const h = getColMap(sheet);
  return {
    num:      h['Numero']        !== undefined ? h['Numero']        : 0,
    nom:      h['Nom']           !== undefined ? h['Nom']           : 1,
    tel:      h['Telephone']     !== undefined ? h['Telephone']     : 2,
    telSec:   h['Tel_Secondaire']!== undefined ? h['Tel_Secondaire']: -1,
    loc:      h['Localite']      !== undefined ? h['Localite']      : 3,
    ville:    h['Ville']         !== undefined ? h['Ville']         : 4,
    quartier: h['Quartier']      !== undefined ? h['Quartier']      : 5,
    service:  h['Service']       !== undefined ? h['Service']       : 6,
    gps:      h['GPS']           !== undefined ? h['GPS']           : 7,
    maj:      h['Derniere_MAJ']  !== undefined ? h['Derniere_MAJ']  : 8,
    total:    sheet.getLastColumn()
  };
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

// Ajoute la colonne Tel_Secondaire (après Telephone) à la feuille Clients
// si elle manque — sans elle, le numéro secondaire finissait combiné dans
// Telephone ("tel/telSec"). Appelé sur les chemins d'écriture.
function ensureClientsCols(sheet) {
  const h = getColMap(sheet);
  if (h['Tel_Secondaire'] === undefined && h['Telephone'] !== undefined) {
    sheet.insertColumnAfter(h['Telephone'] + 1);
    sheet.getRange(1, h['Telephone'] + 2).setValue('Tel_Secondaire');
  }
}

// Jointure Clients : numéro nettoyé → {tel, loc}. Les colonnes Tel_Client
// et Localite ont été retirées de la feuille Interventions — la fiche
// Client est la seule source de ces informations à la lecture.
function getClientsJoinMap() {
  const sheet3 = s3();
  const c = getClientsIdx(sheet3);
  const rows = sheet3.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const num = String(rows[i][c.num] || '').trim().replace(/\s/g,'');
    if (!num) continue;
    map[num] = {
      tel:    String(rows[i][c.tel] || ''),
      telSec: c.telSec >= 0 ? String(rows[i][c.telSec] || '') : '',
      loc:    String(rows[i][c.loc] || '')
    };
  }
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
    chef:     h['Chef']             !== undefined ? h['Chef']             : 2,
    nb:       h['Nb_Interventions'] !== undefined ? h['Nb_Interventions'] : 3,
    creeLe:   h['Créé_le']          !== undefined ? h['Créé_le']          : 4,
    realisees:h['Realisees']        !== undefined ? h['Realisees']        : 5,
    instances:h['Instances']        !== undefined ? h['Instances']        : 6,
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
  const sheet3 = s3();
  const rows3  = sheet3.getDataRange().getValues();
  const c      = getClientsIdx(sheet3);
  const clients = [];
  for (let i = 1; i < rows3.length; i++) {
    if (!String(rows3[i][c.num]).trim()) continue;
    clients.push({
      num:      String(rows3[i][c.num]),
      nom:      String(rows3[i][c.nom]      || ''),
      tel:      String(rows3[i][c.tel]      || ''),
      telSec:   c.telSec >= 0 ? String(rows3[i][c.telSec] || '') : '',
      loc:      String(rows3[i][c.loc]      || ''),
      ville:    String(rows3[i][c.ville]    || ''),
      quartier: String(rows3[i][c.quartier] || ''),
      service:  String(rows3[i][c.service]  || ''),
      gps:      String(rows3[i][c.gps]      || ''),
      maj:      String(rows3[i][c.maj]      || '')
    });
  }

  // Interventions actives (non Réalisées) — pour détection doublons côté front
  const sheet2 = s2();
  const rows2  = sheet2.getDataRange().getValues();
  const ii     = getInvIdx(sheet2);
  const activeInterventions = [];
  for (let i = 1; i < rows2.length; i++) {
    const num = String(rows2[i][ii.num] || '').trim();
    if (!num) continue;
    const statutInv = String(rows2[i][ii.statut]);
    if (statutInv === 'Réalisé') continue;
    activeInterventions.push({
      num:    num.replace(/\s/g,'').toLowerCase(),
      type:   String(rows2[i][ii.type] || ''),
      date:   normDate(rows2[i][ii.date]),
      statut: statutInv
    });
  }

  return { success: true, clients, activeInterventions };
}

// ============================================================
//  CLIENTS — chercher par numéro
// ============================================================
function findClient(params) {
  const num = String(params.num || '').trim().replace(/\s/g,'');
  if (!num) return { success: false, error: 'Numéro vide' };
  const sheet = s3();
  const rows  = sheet.getDataRange().getValues();
  const c     = getClientsIdx(sheet);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][c.num]).trim().replace(/\s/g,'') === num) {
      return {
        success: true, found: true,
        client: {
          num:      String(rows[i][c.num]),
          nom:      String(rows[i][c.nom]      || ''),
          tel:      String(rows[i][c.tel]      || ''),
          telSec:   c.telSec >= 0 ? String(rows[i][c.telSec] || '') : '',
          loc:      String(rows[i][c.loc]      || ''),
          ville:    String(rows[i][c.ville]    || ''),
          quartier: String(rows[i][c.quartier] || ''),
          service:  String(rows[i][c.service]  || ''),
          gps:      String(rows[i][c.gps]      || '')
        }
      };
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
  const num = String(params.num || '').trim().replace(/\s/g,'');
  if (!num) return { success: false, error: 'Numéro manquant' };

  const sheet2 = s2();
  const ii = getInvIdx(sheet2);
  const rows = sheet2.getDataRange().getValues();

  const deduped = {};
  for (let j = 1; j < rows.length; j++) {
    const rowNum = String(rows[j][ii.num] || '').trim().replace(/\s/g,'');
    if (rowNum !== num) continue;
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

  return { success: true, num, history };
}

// ============================================================
//  CLIENTS — sauvegarder
// ============================================================
function saveClient(data) {
  const { num, nom, tel, telSec, loc, ville, quartier, service, gps } = data;
  if (!num) return { success: false, error: 'Numéro manquant' };
  const sheet    = s3();
  const now      = new Date().toLocaleString('fr-FR');
  const rows     = sheet.getDataRange().getValues();
  const c        = getClientsIdx(sheet);
  const numClean = String(num).trim().replace(/\s/g,'');
  const telFinal = (tel && telSec) ? tel+'/'+telSec : (tel||'');

  function buildRow() {
    const row = new Array(c.total).fill('');
    row[c.num]      = num;
    row[c.nom]      = nom      || '';
    row[c.tel]      = tel      || '';
    if (c.telSec >= 0) row[c.telSec] = telSec || '';
    else row[c.tel] = telFinal; // pas de colonne séparée → combiner dans tel
    row[c.loc]      = loc      || '';
    row[c.ville]    = ville    || '';
    row[c.quartier] = quartier || '';
    row[c.service]  = service  || '';
    if (c.gps >= 0) row[c.gps] = gps || '';
    row[c.maj]      = now;
    return row;
  }

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][c.num]).trim().replace(/\s/g,'') === numClean) {
      sheet.getRange(i+1, 1, 1, c.total).setValues([buildRow()]);
      return { success: true, action: 'updated' };
    }
  }
  sheet.appendRow(buildRow());
  sheet.autoResizeColumns(1, c.total);
  return { success: true, action: 'created' };
}

// ============================================================
//  CLIENTS — mettre à jour GPS uniquement
// ============================================================
function updateClientGPS(data) {
  const { num, gps } = data;
  if (!num) return { success: false, error: 'Numéro manquant' };
  const sheet    = s3();
  const rows     = sheet.getDataRange().getValues();
  const c        = getClientsIdx(sheet);
  const numClean = String(num).trim().replace(/\s/g,'');
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][c.num]).trim().replace(/\s/g,'') === numClean) {
      sheet.getRange(i+1, c.gps+1).setValue(gps || '');
      sheet.getRange(i+1, c.maj+1).setValue(new Date().toLocaleString('fr-FR'));
      return { success: true };
    }
  }
  return { success: false, error: 'Client introuvable' };
}

// ============================================================
//  CLIENTS — supprimer EN CASCADE
//  Supprime le client ET toutes ses interventions, peu importe
//  la fiche/date à laquelle elles appartiennent. Recalcule
//  ensuite les compteurs Nb_Interventions affectés.
// ============================================================
function deleteClient(data) {
  const num    = String(data.num || '').trim().replace(/\s/g,'');
  const sheet1 = s1(), sheet2 = s2(), sheet3 = s3();
  const ci = getConsistIdx(sheet1);
  const ii = getInvIdx(sheet2);
  const c  = getClientsIdx(sheet3);
  const rows = sheet3.getDataRange().getValues();
  let clientFound = false;

  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][c.num]).trim().replace(/\s/g,'') === num) {
      sheet3.deleteRow(i+1);
      clientFound = true;
      break;
    }
  }
  if (!clientFound) return { success: false, error: 'Client introuvable' };

  const iRows = sheet2.getDataRange().getValues();
  const affectedConsistIds = {};
  let deletedCount = 0;
  for (let i = iRows.length - 1; i >= 1; i--) {
    const rowNum = String(iRows[i][ii.num] || '').trim().replace(/\s/g,'');
    if (rowNum === num) {
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
//  ENREGISTRER UNE CONSISTANCE
//  Correction : upsert client même pour le premier enregistrement
// ============================================================
function saveConsistance(data, session) {
  const sheet1 = s1(), sheet2 = s2(), sheet3 = s3();
  const { date, chef, interventions } = data;
  const now = new Date().toLocaleString('fr-FR');
  const ci  = getConsistIdx(sheet1);
  ensureInvAuditCols(sheet2);
  ensureClientsCols(sheet3);
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
    row1[ci.chef] = chef;
    row1[ci.nb]   = interventions.length;
    row1[ci.creeLe] = now;
    sheet1.appendRow(row1);
  }

  // Pour chaque intervention
  interventions.forEach((inv, idx) => {
    const invId = consistId + '_' + (Date.now() + idx) + '_' + idx;

    // Écriture dans Interventions via index dynamiques
    const rowInv = new Array(ii.total).fill('');
    rowInv[ii.id]           = invId;
    rowInv[ii.cid]          = consistId;
    rowInv[ii.date]         = date;
    rowInv[ii.type]         = inv.typeLabel || inv.type;
    rowInv[ii.num]          = inv.customerId ? inv.customerId : (inv.num||'');
    rowInv[ii.nom]          = inv.nom  || '';
    rowInv[ii.statut]       = 'En attente';
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
    if (ii.publiePar >= 0) rowInv[ii.publiePar] = session ? session.nom : (chef || '');
    sheet2.appendRow(rowInv);

    // Upsert clients pour toute intervention identifiable (numéro de ligne
    // réel, ou Customer ID pour les études) — c'est la fiche Client qui
    // porte le contact affiché aux techniciens.
    if (numKey) {
      const numClean = numKey.replace(/\s/g,'');
      const service  = typeToService(inv.typeLabel || inv.type);
      const cliRows  = sheet3.getDataRange().getValues();
      const c        = getClientsIdx(sheet3);

      function buildClientRow() {
        const row = new Array(c.total).fill('');
        row[c.num]      = numKey;
        row[c.nom]      = inv.nom || '';
        if (c.telSec >= 0) {
          row[c.tel]    = inv.tel    || '';
          row[c.telSec] = inv.numSec || '';
        } else {
          row[c.tel]    = (inv.tel && inv.numSec) ? inv.tel+'/'+inv.numSec : (inv.tel||'');
        }
        row[c.loc]      = inv.loc      || '';
        row[c.ville]    = inv.ville    || '';
        row[c.quartier] = inv.quartier || '';
        row[c.service]  = service;
        if (c.gps >= 0) row[c.gps] = '';
        row[c.maj]      = now;
        return row;
      }

      let found = false;
      for (let i = 1; i < cliRows.length; i++) {
        if (String(cliRows[i][c.num]).trim().replace(/\s/g,'') === numClean) {
          if (inv.updateClient) {
            sheet3.getRange(i+1, 1, 1, c.total).setValues([buildClientRow()]);
          } else {
            sheet3.getRange(i+1, c.service+1).setValue(service);
            // Le numéro secondaire saisi doit persister même sans mise à
            // jour complète de la fiche (il n'était écrit qu'à la création).
            if (inv.numSec && c.telSec >= 0) sheet3.getRange(i+1, c.telSec+1).setValue(String(inv.numSec).trim());
            sheet3.getRange(i+1, c.maj+1).setValue(now);
          }
          found = true; break;
        }
      }
      if (!found) {
        sheet3.appendRow(buildClientRow());
        SpreadsheetApp.flush();
      }
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
      consist = { id:String(cRows[i][ci.id]), date, chef:String(cRows[i][ci.chef]) };
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
    consistMap[String(cRows[i][ci.id])] = { date: rd, chef: String(cRows[i][ci.chef]) };
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
      chef:         consist.chef,
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
    ficheMap[cid] = { id:cid, date:rd, chef:String(cRows[i][ci.chef]), interventions:[] };
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

function reporterInterventionsEnAttente() {
  const lock = LockService.getScriptLock();
  const gotLock = lock.tryLock(3000);
  if (!gotLock) return;

  try {
    try { sauvegardeHebdoSiDimanche(); } catch(e) { Logger.log('Sauvegarde: ' + e); }
    const sheet1 = s1(), sheet2 = s2();
    const ci = getConsistIdx(sheet1);
    const ii = getInvIdx(sheet2);
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = normDate(today);

    function nextWorkingDay(fromStr) {
      const [y,m,d] = fromStr.split('-').map(Number);
      const dt = new Date(y, m-1, d);
      dt.setDate(dt.getDate()+1);
      while (dt.getDay()===0||dt.getDay()===6) dt.setDate(dt.getDate()+1);
      return normDate(dt);
    }

    const cRows = sheet1.getDataRange().getValues();
    const pastConsists = [];
    for (let i=1; i<cRows.length; i++) {
      const d = normDate(cRows[i][ci.date]);
      if (d && d < todayStr) {
        pastConsists.push({ id:String(cRows[i][ci.id]), date:d, chef:String(cRows[i][ci.chef]), rowIndex:i+1 });
      }
    }
    if (pastConsists.length===0) return;

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
        row1[ci.id]=nextId; row1[ci.date]=targetDate; row1[ci.chef]=consist.chef;
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

  const iRows2 = sheet2.getDataRange().getValues();
  let remaining = 0;
  for (let i = 1; i < iRows2.length; i++) {
    if (String(iRows2[i][ii.cid]) === consistId) remaining++;
  }

  const cRows = sheet1.getDataRange().getValues();
  for (let i = 1; i < cRows.length; i++) {
    if (String(cRows[i][ci.id]) === consistId) {
      if (remaining === 0) sheet1.deleteRow(i+1);
      else sheet1.getRange(i+1, ci.nb+1).setValue(remaining);
      break;
    }
  }

  const dateStr = normDate(iRows[rowToDelete-1][ii.date]);
  if (dateStr) recalculerAgregatsMois(dateStr.substring(0,7));
  return { success: true };

  return { success: true, remaining };
}

// ============================================================
//  RÉPARATION DES EN-TÊTES — à exécuter UNE FOIS
//  Ajoute la ligne d'en-têtes manquante sur Interventions et
//  Clients SANS toucher aux données existantes, en les
//  décalant proprement vers le bas si nécessaire.
// ============================================================
function reparerEnTetes() {
  const sheet2 = getSS().getSheetByName(SHEET_INTERVENTIONS);
  const sheet3 = getSS().getSheetByName(SHEET_CLIENTS);
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

  // Clients — vérifier que Tel_Secondaire est bien en colonne D (index 3)
  if (sheet3) {
    const headers = sheet3.getRange(1, 1, 1, sheet3.getLastColumn()).getValues()[0].map(String);
    const firstCell = headers[0];

    // Si pas d'en-tête du tout → insérer une ligne
    if (firstCell !== 'Numero') {
      sheet3.insertRowBefore(1);
      sheet3.getRange(1,1,1,10).setValues([[
        'Numero','Nom','Telephone','Tel_Secondaire','Localite','Ville','Quartier','Service','GPS','Derniere_MAJ'
      ]]).setFontWeight('bold').setBackground('#0891b2').setFontColor('white');
      fixed.push('Clients (en-tête ajoutée)');
    }
    // Si en-tête présente mais Tel_Secondaire manquant → insérer la colonne D
    else if (!headers.includes('Tel_Secondaire')) {
      // Insérer colonne vide en position 4 (colonne D)
      sheet3.insertColumnBefore(4);
      sheet3.getRange(1, 4).setValue('Tel_Secondaire')
        .setFontWeight('bold').setBackground('#0891b2').setFontColor('white');
      fixed.push('Clients (colonne Tel_Secondaire insérée en D)');
    }
    // Si Tel_Secondaire existe mais pas à la bonne position → signaler
    else if (headers[3] !== 'Tel_Secondaire') {
      fixed.push('⚠️ Tel_Secondaire trouvée mais pas en colonne D — vérifie manuellement');
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

function reparerServiceClients() {
  const sheet2 = s2(), sheet3 = s3();
  const ii = getInvIdx(sheet2);
  const c  = getClientsIdx(sheet3);
  const iRows = sheet2.getDataRange().getValues();
  const cRows = sheet3.getDataRange().getValues();

  const lastTypeByNum = {}, lastDateByNum = {};
  for (let i = 1; i < iRows.length; i++) {
    const num = String(iRows[i][ii.num] || '').trim().replace(/\s/g,'');
    if (!num) continue;
    const dateStr = String(iRows[i][ii.date] || '');
    if (!lastDateByNum[num] || dateStr >= lastDateByNum[num]) {
      lastDateByNum[num] = dateStr;
      lastTypeByNum[num] = String(iRows[i][ii.type] || '');
    }
  }

  let updated = 0;
  for (let i = 1; i < cRows.length; i++) {
    const num = String(cRows[i][c.num] || '').trim().replace(/\s/g,'');
    if (!num) continue;
    const type = lastTypeByNum[num];
    if (!type) continue;
    const correctService = typeToService(type);
    if (String(cRows[i][c.service]) !== correctService) {
      sheet3.getRange(i+1, c.service+1).setValue(correctService);
      updated++;
    }
  }

  notify('✅ Service recalculé pour ' + updated + ' client(s).');
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
//  MIGRATION DES FEUILLES EXISTANTES
//  À exécuter UNE FOIS après déploiement de cette version.
//  1. Feuille Interventions : supprime la colonne GPS (col P)
//  2. Feuille Clients : ajoute Tel_Secondaire en col D
// ============================================================
function migrerStructureBD() {
  const ss = getSS();
  let msg = [];

  // ── 1. INTERVENTIONS : supprimer colonne GPS (col 16 = P) ──
  const sh2 = ss.getSheetByName(SHEET_INTERVENTIONS);
  if (sh2) {
    const headers2 = sh2.getRange(1,1,1,sh2.getLastColumn()).getValues()[0];
    const gpsIdx = headers2.findIndex(h=>String(h).trim()==='GPS');
    if (gpsIdx >= 0) {
      sh2.deleteColumn(gpsIdx+1);
      msg.push('Interventions : colonne GPS supprimée (col '+(gpsIdx+1)+')');
    } else {
      msg.push('Interventions : colonne GPS déjà absente');
    }
    // S'assurer que l'entête Duree_Jours est bien en dernière position
    const h2 = sh2.getRange(1,1,1,sh2.getLastColumn()).getValues()[0];
    const dureeIdx = h2.findIndex(h=>String(h).trim()==='Duree_Jours');
    if (dureeIdx < 0) {
      sh2.getRange(1,sh2.getLastColumn()+1).setValue('Duree_Jours').setFontWeight('bold').setBackground('#1d4ed8').setFontColor('white');
      msg.push('Interventions : colonne Duree_Jours ajoutée');
    }
  }

  // ── 2. CLIENTS : ajouter Tel_Secondaire en col D si absente ──
  const sh3 = ss.getSheetByName(SHEET_CLIENTS);
  if (sh3) {
    const headers3 = sh3.getRange(1,1,1,sh3.getLastColumn()).getValues()[0];
    const hasTelSec = headers3.some(h=>String(h).trim()==='Tel_Secondaire');
    if (!hasTelSec) {
      sh3.insertColumnAfter(3); // après col C (Telephone)
      sh3.getRange(1,4).setValue('Tel_Secondaire').setFontWeight('bold').setBackground('#0891b2').setFontColor('white');
      msg.push('Clients : colonne Tel_Secondaire insérée en col D');
    } else {
      msg.push('Clients : Tel_Secondaire déjà présente');
    }
  }

  notify('✅ Migration terminée :\n\n- ' + msg.join('\n- '));
}

// ============================================================
//  RÉPARATION COMPLÈTE DES COLONNES CLIENTS — à exécuter UNE FOIS
//  Corrige le décalage causé par l'écriture 10 colonnes sur une
//  feuille qui n'en avait que 9 : GPS reçevait "FTTH",
//  Localite/Ville/Quartier/Service étaient tous décalés.
//  Détecte les lignes corrompues (GPS = FTTH/LS/CUIVRE) et
//  remet chaque valeur dans sa bonne colonne.
// ============================================================
function reparerColonnesClients() {
  const sheet   = s3();
  const all     = sheet.getDataRange().getValues();
  const c       = getClientsIdx(sheet);
  const SVCS    = ['FTTH','LS','CUIVRE'];
  const isSvc   = v => SVCS.includes(String(v).trim().toUpperCase());
  const isGPS   = v => /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(String(v).trim());

  let fixed = 0;
  for (let i = 1; i < all.length; i++) {
    const row    = [...all[i]];
    const gpsVal = String(row[c.gps] || '');

    // Ligne corrompue : GPS contient un service au lieu de coordonnées
    if (!isSvc(gpsVal)) continue;

    // Les valeurs sont décalées d'une position vers la droite
    // à partir de Localite. On les relit depuis leur vraie position (+1)
    // et on les remet au bon endroit.
    const newRow = [...row];
    newRow[c.loc]      = row[c.loc + 1]  || '';  // vrai loc est une position plus loin
    newRow[c.ville]    = row[c.ville + 1] || '';  // vrai ville
    newRow[c.quartier] = row[c.quartier + 1] || ''; // vrai quartier
    newRow[c.service]  = row[c.gps];               // service = ce qui était dans GPS
    // GPS réel : chercher dans les colonnes suivantes
    let realGPS = '';
    for (let col = c.gps + 1; col < row.length; col++) {
      if (isGPS(row[col])) { realGPS = String(row[col]); break; }
    }
    newRow[c.gps] = realGPS;
    newRow[c.maj] = new Date().toLocaleString('fr-FR');

    // Écrire en limitant au nombre de colonnes avec entête
    sheet.getRange(i + 1, 1, 1, all[0].length).setValues([newRow.slice(0, all[0].length)]);
    fixed++;
  }

  notify(
    fixed > 0
      ? '✅ ' + fixed + ' client(s) corrigé(s) — toutes les colonnes remises en ordre.\n\nActualisez la page client dans l\'app pour voir les corrections.'
      : 'ℹ️ Aucune ligne corrompue détectée.'
  );
}

// ============================================================
//  CORRIGER LES DONNÉES CLIENTS DÉCALÉES
//  Pour les lignes où Localite est en colonne Tel_Secondaire
//  (décalage dû à une écriture avec les anciens indices).
//  Règle : si Tel_Secondaire contient du texte non numérique
//  → c'est une Localite mal placée → on corrige.
// ============================================================
function corrigerDecalageClients() {
  const sheet = s3();
  const data  = sheet.getDataRange().getValues();
  const c     = getClientsIdx(sheet);

  if (c.telSec < 0) {
    notify('ℹ️ Pas de colonne Tel_Secondaire — rien à corriger.');
    return;
  }

  const isPhone = v => /^\d[\d\/]*$/.test(String(v).trim()) || String(v).trim() === '';
  let fixed = 0;

  for (let i = 1; i < data.length; i++) {
    const telSec = String(data[i][c.telSec] || '').trim();
    if (!isPhone(telSec)) {
      // Tel_Secondaire contient une Localite → décalage détecté
      // On lit les valeurs à partir de Tel_Secondaire et on les remet en place
      const loc      = telSec;                               // vrai Localite
      const ville    = String(data[i][c.telSec+1] || '').trim(); // vrai Ville
      const quartier = String(data[i][c.telSec+2] || '').trim(); // vrai Quartier
      const service  = String(data[i][c.telSec+3] || '').trim(); // vrai Service

      sheet.getRange(i+1, c.telSec+1).setValue('');          // Tel_Secondaire vide
      sheet.getRange(i+1, c.loc+1).setValue(loc);            // E = Localite
      sheet.getRange(i+1, c.ville+1).setValue(ville);        // F = Ville
      sheet.getRange(i+1, c.quartier+1).setValue(quartier);  // G = Quartier
      sheet.getRange(i+1, c.service+1).setValue(service);    // H = Service
      fixed++;
    }
  }

  notify('✅ ' + fixed + ' ligne(s) corrigée(s) dans la feuille Clients.');
}

// ============================================================
//  DIAGNOSTIC — indices réels détectés sur la feuille Clients
// ============================================================
function diagnostiquerClientsIdx() {
  const sheet = s3();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const c = getClientsIdx(sheet);
  const lines = [
    '📋 Entêtes détectées (' + headers.length + ' colonnes) :',
    headers.map((h,i) => String.fromCharCode(65+i)+'='+h).join(' | '),
    '',
    '🔢 Indices utilisés par le code :',
    'num='+c.num+' nom='+c.nom+' tel='+c.tel+' telSec='+c.telSec,
    'loc='+c.loc+' ville='+c.ville+' quartier='+c.quartier,
    'service='+c.service+' gps='+c.gps+' maj='+c.maj,
    'total='+c.total,
    '',
    '✅ = correct si telSec=3, loc=4, ville=5 (avec Tel_Secondaire en D)'
  ];
  notify(lines.join('\n'));
}

// ============================================================
//  AJOUTER Tel_Secondaire DANS LA FEUILLE CLIENTS EXISTANTE
//  À exécuter UNE FOIS. Insère la colonne après Telephone
//  sans toucher aux données existantes.
// ============================================================
function ajouterTelSecondaire() {
  const sheet = s3();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  if (headers.some(h => String(h).trim() === 'Tel_Secondaire')) {
    notify('ℹ️ La colonne Tel_Secondaire existe déjà.');
    return;
  }

  const telIdx = headers.findIndex(h => String(h).trim() === 'Telephone');
  if (telIdx < 0) {
    notify('❌ Colonne Telephone introuvable.');
    return;
  }

  // Insérer une colonne vide juste après Telephone
  sheet.insertColumnAfter(telIdx + 1);
  sheet.getRange(1, telIdx + 2)
    .setValue('Tel_Secondaire')
    .setFontWeight('bold')
    .setBackground('#0891b2')
    .setFontColor('white');

  notify(
    '✅ Colonne Tel_Secondaire ajoutée en colonne ' + String.fromCharCode(65 + telIdx + 1) + '.\n' +
    'Les données existantes sont intactes.\n\n' +
    'Désormais les numéros secondaires seront stockés séparément.'
  );
}

// ============================================================
//  SUPPRIMER LA COLONNE Tel_Secondaire ET CORRIGER LES DONNÉES
//  À exécuter UNE FOIS dans Apps Script.
// ============================================================
function supprimerColonneTelSecondaire() {
  const sheet = s3();
  const data  = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const telSecIdx = headers.indexOf('Tel_Secondaire');

  if (telSecIdx < 0) {
    Logger.log('ℹ️ Colonne Tel_Secondaire introuvable — rien à faire.');
    return;
  }

  // Avant de supprimer, fusionner Tel_Secondaire dans Telephone si non vide
  // et corriger les lignes dont les données ont été décalées
  const IS_PHONE = v => /^\d[\d\/]*$/.test(String(v).trim());
  let fixed = 0;
  for (let i = 1; i < data.length; i++) {
    const tel    = String(data[i][2] || '').trim();
    const telSec = String(data[i][telSecIdx] || '').trim();
    const loc    = String(data[i][telSecIdx+1] || '').trim();

    if (telSec !== '') {
      if (IS_PHONE(telSec)) {
        // Vrai numéro secondaire → fusionner dans Telephone
        const telFinal = tel ? tel+'/'+telSec : telSec;
        sheet.getRange(i+1, 3).setValue(telFinal);
      } else {
        // Texte non-numérique = Localite mal placée → décaler vers Localite
        sheet.getRange(i+1, telSecIdx+2).setValue(telSec);  // → Localite (col après telSec)
        sheet.getRange(i+1, telSecIdx+3).setValue(loc);      // → Ville (col après Localite)
      }
      sheet.getRange(i+1, telSecIdx+1).setValue('');
      fixed++;
    }
  }

  // Supprimer la colonne Tel_Secondaire
  sheet.deleteColumn(telSecIdx + 1);

  Logger.log('✅ Colonne Tel_Secondaire supprimée. ' + fixed + ' ligne(s) corrigée(s). La feuille Clients est revenue à 9 colonnes.');
}

// ============================================================
//  CORRIGER LES NOMS DE QUARTIERS DANS LES INTERVENTIONS
//  À exécuter une fois après un renommage de quartier.
// ============================================================
function corrigerNomsQuartiers() {
  const sheet2 = s2(), sheet3 = s3();
  const ii = getInvIdx(sheet2);
  const c  = getClientsIdx(sheet3);
  const CORRECTIONS = {
    'NDIANGDAM': 'NDIANDAM', 'MATEUR': 'MAETUR', 'MAETURE': 'MAETUR',
    'MICHOU BAR': 'CASA', "TOTAL D'EN BAS": 'TOTAL EN BAS',
    'FEUX ROUGE': 'FEU ROUGE', 'MARCHE CASA': 'CASA'
  };
  let count = 0;
  const iData = sheet2.getDataRange().getValues();
  for (let i = 1; i < iData.length; i++) {
    const q = String(iData[i][ii.quartier]||'').trim();
    if (CORRECTIONS[q]) { sheet2.getRange(i+1, ii.quartier+1).setValue(CORRECTIONS[q]); count++; }
  }
  const cData = sheet3.getDataRange().getValues();
  for (let i = 1; i < cData.length; i++) {
    const q = String(cData[i][c.quartier]||'').trim();
    if (CORRECTIONS[q]) { sheet3.getRange(i+1, c.quartier+1).setValue(CORRECTIONS[q]); count++; }
  }
  Logger.log('✅ ' + count + ' correction(s) appliquée(s).');
}
//  Si l'entête a été poussée vers le bas par des appendRow
//  intempestifs, cette fonction la remet en ligne 1.
// ============================================================
function reparerEnteteClients() {
  const sheet  = s3();
  const data   = sheet.getDataRange().getValues();
  const HEADER = ['Numero','Nom','Telephone','Localite','Ville','Quartier','Service','GPS','Derniere_MAJ'];

  // Chercher la ligne qui contient l'entête
  let headerRow = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'Numero') { headerRow = i; break; }
  }

  if (headerRow === 0) {
    notify('ℹ️ L\'entête est déjà en ligne 1. Rien à faire.');
    return;
  }

  if (headerRow > 0) {
    // Supprimer la ligne d'entête là où elle est
    sheet.deleteRow(headerRow + 1);
    // Insérer une nouvelle ligne en position 1
    sheet.insertRowBefore(1);
  } else {
    // Entête introuvable — l'écrire directement
    sheet.insertRowBefore(1);
  }

  // Écrire l'entête en ligne 1 avec le bon style
  sheet.getRange(1, 1, 1, HEADER.length)
    .setValues([HEADER])
    .setFontWeight('bold')
    .setBackground('#0891b2')
    .setFontColor('white');

  notify('✅ Entête remise en ligne 1. Tes données sont intactes.');
}

// ============================================================
//  RÉPARATION COMPLÈTE DE LA FEUILLE CLIENTS
//  Réécrit les entêtes avec les noms exacts attendus par le code,
//  puis détecte et corrige automatiquement les lignes dont les
//  colonnes sont décalées (GPS contient FTTH/LS/CUIVRE).
//  À EXÉCUTER UNE FOIS pour résoudre les problèmes de
//  Localité/GPS vides dans l'application.
// ============================================================
function reparerCompletClients() {
  const sheet = s3();
  const lastCol = sheet.getLastColumn();
  const all = sheet.getDataRange().getValues();

  // ── ÉTAPE 1 : Réécrire les entêtes avec les noms exacts ──
  // On détecte si on a 9 colonnes (ancien format sans Tel_Secondaire)
  // ou 10 colonnes (nouveau format avec Tel_Secondaire).
  let headers10 = ['Numero','Nom','Telephone','Tel_Secondaire','Localite','Ville','Quartier','Service','GPS','Derniere_MAJ'];
  let headers9  = ['Numero','Nom','Telephone','Localite','Ville','Quartier','Service','GPS','Derniere_MAJ'];
  const expectedHeaders = lastCol >= 10 ? headers10 : headers9;

  // Réécrire la ligne 1 avec les noms standardisés
  sheet.getRange(1, 1, 1, expectedHeaders.length)
    .setValues([expectedHeaders])
    .setFontWeight('bold')
    .setBackground('#0891b2')
    .setFontColor('white');
  SpreadsheetApp.flush();

  // ── ÉTAPE 2 : Relire avec les nouveaux indices corrects ──
  const c = getClientsIdx(sheet);
  const rows = sheet.getDataRange().getValues();
  const SVCS = ['FTTH','LS','CUIVRE'];
  const isSvc = v => SVCS.includes(String(v).trim().toUpperCase());
  const isGPS = v => /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(String(v).trim());

  let fixed = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = [...rows[i]];
    const gpsVal = String(row[c.gps] || '').trim();
    if (!isSvc(gpsVal)) continue; // pas corrompu

    // Colonnes décalées : corriger
    const newRow = [...row];
    newRow[c.loc]      = row[c.loc + 1]      || '';
    newRow[c.ville]    = row[c.ville + 1]    || '';
    newRow[c.quartier] = row[c.quartier + 1] || '';
    newRow[c.service]  = row[c.gps];
    let realGPS = '';
    for (let col = c.gps + 1; col < row.length; col++) {
      if (isGPS(row[col])) { realGPS = String(row[col]); break; }
    }
    newRow[c.gps] = realGPS;
    newRow[c.maj] = new Date().toLocaleString('fr-FR');
    sheet.getRange(i + 1, 1, 1, row.length).setValues([newRow.slice(0, row.length)]);
    fixed++;
  }

  notify(
    '✅ Réparation terminée !\n\n' +
    '- Entêtes standardisées (' + expectedHeaders.length + ' colonnes)\n' +
    '- ' + fixed + ' ligne(s) de données corrigée(s)\n\n' +
    'Actualisez maintenant la page Clients dans l\'app (bouton ↺).'
  );
}

// ============================================================
//  AJOUTER LA COLONNE Tel_Secondaire DANS LA FEUILLE CLIENTS
//  À exécuter UNE FOIS si la colonne n'existe pas encore.
//  Insère la colonne en position 4 (après Telephone) et
//  décale les colonnes suivantes vers la droite sans perte.
// ============================================================
function ajouterColonneTelSecondaire() {
  const sheet = s3();
  const firstRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Vérifier si la colonne existe déjà
  if (firstRow.includes('Tel_Secondaire')) {
    notify('ℹ️ La colonne Tel_Secondaire existe déjà. Rien à faire.');
    return;
  }

  // Insérer une colonne vide en position 4 (après Telephone = col 3)
  sheet.insertColumnAfter(3);

  // Mettre l'entête
  sheet.getRange(1, 4).setValue('Tel_Secondaire').setFontWeight('bold').setBackground('#0891b2').setFontColor('white');

  // Reformater toute la ligne d'entête (au cas où la couleur se serait perdue)
  sheet.getRange(1, 1, 1, 10).setFontWeight('bold').setBackground('#0891b2').setFontColor('white');

  notify(
    '✅ Colonne Tel_Secondaire ajoutée en position 4.\n\n' +
    sheet.getLastRow() - 1 + ' client(s) existant(s) conservés.\n' +
    'La colonne est vide pour l\'instant — elle se remplira au fur et à mesure des publications.'
  );
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
  let exists=false, exRow=-1, exNb=0, chefDuJour='';
  for (let i=1; i<cRows2.length; i++) {
    if (String(cRows2[i][ci.id])===nextId) { exists=true; exRow=i+1; exNb=Number(cRows2[i][ci.nb])||0; chefDuJour=String(cRows2[i][ci.chef]); break; }
  }
  if (!chefDuJour) {
    // Chef du jour inconnu : reprendre celui de la fiche d'origine la plus récente
    for (let i=1; i<cRows2.length; i++) {
      if (String(cRows2[i][ci.id])===aDeplacer[0].consistId) { chefDuJour=String(cRows2[i][ci.chef]); break; }
    }
  }

  if (!exists) {
    const row1 = new Array(ci.total).fill('');
    row1[ci.id]=nextId; row1[ci.date]=todayStr; row1[ci.chef]=chefDuJour;
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

  const affectedConsistIds = {};
  aDeplacer.forEach(inv => { affectedConsistIds[inv.consistId] = true; });
  aDeplacer.sort((a,b)=>b.rowIndex-a.rowIndex).forEach(inv => sheet2.deleteRow(inv.rowIndex));

  Object.keys(affectedConsistIds).forEach(cid => {
    const iRowsAfter = sheet2.getDataRange().getValues();
    let remaining = 0;
    for (let j=1; j<iRowsAfter.length; j++) {
      if (String(iRowsAfter[j][ii.cid])===cid) remaining++;
    }
    for (let i=1; i<cRows2.length; i++) {
      if (String(cRows2[i][ci.id])===cid) {
        if (remaining===0) sheet1.deleteRow(i+1);
        else sheet1.getRange(i+1, ci.nb+1).setValue(remaining);
        break;
      }
    }
  });

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
