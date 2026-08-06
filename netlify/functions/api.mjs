// ============================================================================
//  CERAF Bafoussam — API (remplaçante de Code.gs)
//
//  PRINCIPE DIRECTEUR : le contrat avec le frontend est INCHANGÉ.
//  Le front poste `{action, token, actingRole, …}` sur une URL unique et reçoit
//  `{success, …}`. On garde ce contrat à l'octet près et on remplace ce qu'il y
//  a derrière. Conséquences voulues :
//    - le frontend ne change quasiment pas ;
//    - la migration se fait action par action ;
//    - la bascule ET le retour arrière tiennent dans un changement d'URL
//      (`localStorage['ceraf_url']`), sans redéploiement.
//
//  ZÉRO DÉPENDANCE : on parle à Neon via son point d'entrée SQL-sur-HTTP avec
//  le `fetch` natif. Pas de bundler, pas de node_modules, démarrage à froid
//  minimal — cohérent avec un projet qui n'a jamais eu d'étape de build.
// ============================================================================

const SESSION_DUREE_JOURS = 7;
const DEFAULT_PIN = '0000';
// Sel historique, UNIQUEMENT pour les comptes créés avant la migration vers le
// sel par utilisateur (format « <hash>:<sel> »). Doit rester identique à celui
// d'Apps Script, sinon tous les PIN existants cessent de fonctionner.
const PIN_SALT = 'ceraf-bafoussam-2026';

const LOGIN_MAX_ECHECS = 5;
const LOGIN_FENETRE_MIN = 15;

// ── Accès base ─────────────────────────────────────────────────────────────
async function sql(requete, params = []) {
  const conn = Netlify.env.get('DATABASE_URL');
  if (!conn) throw new Error('DATABASE_URL absent de la configuration');
  const hote = conn.replace(/^.*@([^/]+)\/.*$/, '$1');
  const rep = await fetch(`https://${hote}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': conn },
    body: JSON.stringify({ query: requete, params })
  });
  if (!rep.ok) {
    const txt = await rep.text();
    let msg = txt;
    try { const j = JSON.parse(txt); msg = j.message || j.error || txt; } catch { /* texte brut */ }
    throw new Error('SQL: ' + String(msg).slice(0, 300));
  }
  return (await rep.json()).rows || [];
}
const un = async (q, p) => (await sql(q, p))[0] || null;

// ── Hachage des PIN — portage EXACT de Code.gs ─────────────────────────────
// Vérifié sur les hash réels migrés : 56 comparaisons, 0 divergence.
async function hashPin(pin, sel) {
  const octets = new TextEncoder().encode(String(pin) + ':' + sel);
  const empreinte = await crypto.subtle.digest('SHA-256', octets);
  return [...new Uint8Array(empreinte)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Les comptes historiques stockent un hex nu (sel fixe) ; les nouveaux
// « <hash>:<sel> ». Les deux doivent continuer à fonctionner.
function decouperHash(stocke) {
  const s = String(stocke || '');
  const i = s.lastIndexOf(':');
  return (i > 0 && i < s.length - 1)
    ? { hash: s.slice(0, i), sel: s.slice(i + 1) }
    : { hash: s, sel: PIN_SALT };
}
async function verifierPin(stocke, pin) {
  const { hash, sel } = decouperHash(stocke);
  return Boolean(hash) && hash === await hashPin(pin, sel);
}
async function hacherPin(pin) {
  const sel = crypto.randomUUID().slice(0, 8);
  return (await hashPin(pin, sel)) + ':' + sel;
}
const estPinDefaut = (stocke) => verifierPin(stocke, DEFAULT_PIN);

// Le token circule en clair côté client mais n'est stocké que haché : une fuite
// de la base ne donne pas de sessions utilisables.
async function hashToken(token) {
  const empreinte = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(empreinte)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Sessions ───────────────────────────────────────────────────────────────
async function resoudreSession(token) {
  if (!token) return null;
  const l = await un(
    `SELECT s.id, u.matricule, u.nom, u.roles, u.pin_hash
       FROM sessions s JOIN utilisateurs u ON u.matricule = s.matricule
      WHERE s.token_hash = $1 AND s.revoquee_le IS NULL AND s.expire_le > now()
        AND u.actif AND u.supprime_le IS NULL`,
    [await hashToken(token)]);
  if (!l) return null;
  // Trace de dernier accès — utile à l'onglet Audit, sans coût perceptible.
  sql('UPDATE sessions SET dernier_acces = now() WHERE id = $1', [l.id]).catch(() => {});
  return {
    sessionId: l.id, matricule: l.matricule, nom: l.nom,
    roles: l.roles || [],
    mustChangePin: await estPinDefaut(l.pin_hash)
  };
}

// ── Journal d'audit — alimenté au POINT DE DISPATCH ────────────────────────
// Toutes les mutations passent ici : impossible d'en oublier une. C'est ce que
// le Google Sheet ne fournissait pas — personne ne savait qui avait corrigé
// quoi à la main.
const MUTATIONS = new Set(['login', 'logout', 'changePin', 'updateStatus', 'saveConsistance',
  'saveClient', 'saveClientLs', 'updateClientGPS', 'deleteClient', 'deleteIntervention',
  'mergeClientsLs', 'adminAddUser', 'adminUpdateUser', 'adminDeleteUser', 'adminResetPin']);

async function journaliser(ctx, resultat) {
  if (!MUTATIONS.has(ctx.action)) return;
  try {
    await sql(
      `INSERT INTO audit_log (matricule, role_actif, action, entite, entite_id, avant, apres, succes, erreur, ip)
       VALUES ($1, $2::role_t, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::inet)`,
      [ctx.matricule || null, ctx.role || null, ctx.action, ctx.entite || null, ctx.entiteId || null,
       ctx.avant ? JSON.stringify(ctx.avant) : null,
       ctx.apres ? JSON.stringify(ctx.apres) : null,
       !!resultat.success, resultat.success ? null : String(resultat.error || '').slice(0, 500),
       ctx.ip || null]);
  } catch (e) {
    // Un journal en échec ne doit JAMAIS faire échouer l'action métier.
    console.error('[audit] écriture impossible:', e.message);
  }
}

// ============================================================================
//  ACTIONS — AUTHENTIFICATION
// ============================================================================
async function login(d, ctx) {
  const matricule = String(d.matricule || d.id || d.nom || '').trim();
  const pin = String(d.pin || '').trim();
  if (!matricule || !pin) return { success: false, error: 'Matricule et PIN requis' };

  // Rate-limiting lu depuis audit_log : pas de dépendance à un cache externe,
  // et la trace des tentatives est de toute façon souhaitable.
  const { echecs } = await un(
    `SELECT count(*)::int AS echecs FROM audit_log
      WHERE action = 'login' AND NOT succes AND entite_id = $1
        AND ts > now() - ($2 || ' minutes')::interval`,
    [matricule, String(LOGIN_FENETRE_MIN)]);
  if (echecs >= LOGIN_MAX_ECHECS) {
    ctx.entiteId = matricule;
    return { success: false, error: 'Trop de tentatives — réessayez dans quelques minutes', retryAfter: true };
  }

  ctx.entite = 'utilisateur'; ctx.entiteId = matricule;
  const u = await un(
    `SELECT matricule, nom, pin_hash, roles, actif FROM utilisateurs
      WHERE matricule = $1 AND supprime_le IS NULL`, [matricule]);
  if (!u) return { success: false, error: 'Matricule introuvable' };
  if (!u.actif) return { success: false, error: 'Compte désactivé' };
  if (!await verifierPin(u.pin_hash, pin)) return { success: false, error: 'PIN incorrect' };

  const token = crypto.randomUUID() + '-' + crypto.randomUUID();
  await sql(
    `INSERT INTO sessions (token_hash, matricule, expire_le, appareil)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)`,
    [await hashToken(token), u.matricule, String(SESSION_DUREE_JOURS), (ctx.userAgent || '').slice(0, 200)]);
  await sql('UPDATE utilisateurs SET derniere_connexion = now() WHERE matricule = $1', [u.matricule]);
  ctx.matricule = u.matricule;

  return { success: true, token, nom: u.nom, roles: u.roles || [],
           mustChangePin: await estPinDefaut(u.pin_hash) };
}

async function logout(d, ctx) {
  if (!d.token) return { success: true };
  await sql('UPDATE sessions SET revoquee_le = now() WHERE token_hash = $1 AND revoquee_le IS NULL',
    [await hashToken(d.token)]);
  return { success: true };
}

// Le PIN actuel n'est exigé que si le compte a DÉJÀ un PIN personnel : tant
// qu'il est resté au défaut (valeur publique), le redemander ne protège rien
// et casse les frontends publiés avant l'ajout de cette exigence — c'est
// l'incident de boucle du 2026-08-06, corrigé en v115 puis porté ici.
async function changePin(d, ctx, session) {
  const actuel = String(d.currentPin || '').trim();
  const nouveau = String(d.newPin || '').trim();
  if (!/^\d{4,6}$/.test(nouveau)) return { success: false, error: 'Le PIN doit contenir 4 à 6 chiffres' };

  const u = await un('SELECT pin_hash FROM utilisateurs WHERE matricule = $1', [session.matricule]);
  if (!u) return { success: false, error: 'Utilisateur introuvable' };

  const auDefaut = await estPinDefaut(u.pin_hash);
  if (!auDefaut && !/^\d{4,6}$/.test(actuel)) return { success: false, error: 'PIN actuel requis' };
  if (actuel && !await verifierPin(u.pin_hash, actuel)) return { success: false, error: 'PIN actuel incorrect' };
  if (await verifierPin(u.pin_hash, nouveau)) {
    return { success: false, error: 'Le nouveau PIN doit être différent de l\'ancien' };
  }

  await sql('UPDATE utilisateurs SET pin_hash = $1 WHERE matricule = $2',
    [await hacherPin(nouveau), session.matricule]);
  // Ici, contrairement à Apps Script, on PEUT révoquer proprement : la table
  // sessions distingue les appareils. On coupe tous les autres et on garde
  // celui qui vient de prouver qu'il connaît le PIN.
  await sql(`UPDATE sessions SET revoquee_le = now()
              WHERE matricule = $1 AND id <> $2 AND revoquee_le IS NULL`,
    [session.matricule, session.sessionId]);

  ctx.entite = 'utilisateur'; ctx.entiteId = session.matricule;
  return { success: true, relogin: false };
}

// ============================================================================
//  ACTIONS — LECTURES
// ============================================================================
const ligneInv = (r) => ({
  id: r.id, cid: r.consistance_id, date: r.date, type: r.type,
  num: r.numero_ligne || '', nom: r.nom_client || '', statut: r.statut,
  panne: r.panne || '', remarque: r.remarque || '',
  reporteDepuis: r.reporte_depuis || '', ville: r.ville || '', quartier: r.quartier || '',
  duree: r.duree, gps: r.gps || '',
  publiePar: r.publie_par || '', statutPar: r.statut_par || ''
});

async function getByDate(d) {
  const date = String(d.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: 'Date invalide' };
  const c = await un('SELECT id, date FROM v_consistances WHERE date = $1::date', [date]);
  if (!c) return { success: true, consist: null, interventions: [] };
  // Un seul aller-retour, et le GPS est joint côté base : remplace les deux
  // lectures de feuilles entières que faisait getClientsJoinMap().
  const inv = await sql(
    `SELECT * FROM v_interventions WHERE consistance_id = $1 ORDER BY id`, [c.id]);
  return { success: true, consist: { id: c.id, date: c.date }, interventions: inv.map(ligneInv) };
}

async function getClients() {
  const [ftth, cuivre, ls, actives] = await Promise.all([
    sql(`SELECT numero, nom, telephone, tel_secondaire, localite, ville, quartier, gps, derniere_maj
           FROM clients WHERE service='FTTH' AND supprime_le IS NULL ORDER BY nom`),
    sql(`SELECT numero, nom, telephone, tel_secondaire, localite, ville, quartier, gps, derniere_maj
           FROM clients WHERE service='CUIVRE' AND supprime_le IS NULL ORDER BY nom`),
    sql(`SELECT nom, telephone, tel_secondaire, localite, ville, quartier, pop, gps, derniere_maj
           FROM clients_ls WHERE supprime_le IS NULL ORDER BY nom`),
    sql(`SELECT numero_ligne, nom_client, date, statut, type FROM v_interventions
          WHERE statut <> 'Réalisé' ORDER BY date`)
  ]);
  const mapC = r => ({ num: r.numero, nom: r.nom, tel: r.telephone || '', telSec: r.tel_secondaire || '',
    loc: r.localite || '', ville: r.ville || '', quartier: r.quartier || '', gps: r.gps || '', maj: r.derniere_maj });
  const mapL = r => ({ nom: r.nom, tel: r.telephone || '', telSec: r.tel_secondaire || '',
    loc: r.localite || '', ville: r.ville || '', quartier: r.quartier || '', pop: r.pop || '',
    gps: r.gps || '', maj: r.derniere_maj });
  const clientsFtth = ftth.map(mapC), clientsCuivre = cuivre.map(mapC);
  return {
    success: true,
    // Le champ fusionné `clients` du backend Apps Script est ABANDONNÉ : il
    // dupliquait intégralement la charge utile pour d'anciens frontends en
    // cache. À ce stade de la migration, le frontend est à jour.
    clientsFtth, clientsCuivre, clientsLs: ls.map(mapL),
    activeInterventions: actives.map(a => ({ num: a.numero_ligne || '', nom: a.nom_client || '',
      date: a.date, statut: a.statut, type: a.type }))
  };
}

// `month` filtre désormais DANS la base. Apps Script chargeait tout
// l'historique puis filtrait en mémoire, quel que soit le mois demandé.
async function getAll(d) {
  const mois = String(d.month || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mois)) return { success: false, error: 'Mois invalide' };
  const debut = mois + '-01';
  const inv = await sql(
    `SELECT * FROM v_interventions
      WHERE date >= $1::date AND date < ($1::date + interval '1 month')
      ORDER BY date, id`, [debut]);
  const consists = await sql(
    `SELECT id, date, nb_interventions, realisees, instances FROM v_consistances
      WHERE date >= $1::date AND date < ($1::date + interval '1 month') ORDER BY date`, [debut]);

  // Dédoublonnage : une même intervention logique apparaît une fois par jour
  // de report. Clé nom|num|type, le statut le plus avancé gagne, départage par
  // date la plus récente — reprise fidèle de statutPoids().
  const poids = { 'Réalisé': 4, 'Problème': 3, 'Injoignable': 2, 'En attente': 1 };
  const parCle = new Map();
  inv.forEach(r => {
    const cle = `${r.nom_client}|${r.numero_ligne}|${r.type}`;
    const actuel = parCle.get(cle);
    if (!actuel) { parCle.set(cle, r); return; }
    const pa = poids[actuel.statut] || 0, pr = poids[r.statut] || 0;
    if (pr > pa || (pr === pa && r.date > actuel.date)) {
      // On conserve la PLUS ANCIENNE origine, pour que la durée reflète le
      // vrai début même si seule une ligne survit.
      const origine = [actuel.reporte_depuis, r.reporte_depuis].filter(Boolean).sort()[0];
      parCle.set(cle, { ...r, reporte_depuis: origine || r.reporte_depuis });
    } else if (actuel.reporte_depuis && r.reporte_depuis && r.reporte_depuis < actuel.reporte_depuis) {
      actuel.reporte_depuis = r.reporte_depuis;
    }
  });
  return {
    success: true,
    consistances: consists.map(c => ({ id: c.id, date: c.date, nb: c.nb_interventions,
      realisees: c.realisees, instances: c.instances })),
    interventions: [...parCle.values()].map(ligneInv)
  };
}

async function getClientHistory(d) {
  const num = String(d.num || '').trim();
  const nomLs = String(d.nomLs || d.nom || '').trim();
  if (!num && !nomLs) return { success: false, error: 'Numéro ou nom requis' };
  const inv = num
    ? await sql('SELECT * FROM v_interventions WHERE numero_ligne = $1 ORDER BY date DESC', [num])
    : await sql('SELECT * FROM v_interventions WHERE lower(trim(nom_client)) = lower(trim($1)) ORDER BY date DESC', [nomLs]);
  return { success: true, historique: inv.map(ligneInv) };
}

async function getClientsResilies() {
  const r = await sql(`SELECT service, numero, nom, telephone, ville, quartier, motif,
                              date_resiliation, resilie_par
                         FROM clients_resilies ORDER BY date_resiliation DESC`);
  return { success: true, clients: r.map(x => ({ service: x.service, num: x.numero || '', nom: x.nom,
    tel: x.telephone || '', ville: x.ville || '', quartier: x.quartier || '',
    motif: x.motif || '', dateRes: x.date_resiliation, par: x.resilie_par || '' })) };
}

// ============================================================================
//  ACTIONS — ÉCRITURES
// ============================================================================
// Idempotent : valeurs absolues repérées par id, donc un rejeu après timeout
// est sans danger — c'est ce qui permet à la file hors-ligne du front de
// retenter sans risque.
async function updateStatus(d, ctx, session) {
  const id = String(d.invId || '').trim();
  if (!id) return { success: false, error: 'Intervention introuvable' };
  const avant = await un('SELECT statut, remarque, panne FROM interventions WHERE id = $1 AND supprime_le IS NULL', [id]);
  if (!avant) return { success: false, error: 'Intervention introuvable' };

  const statuts = ['En attente', 'Injoignable', 'Problème', 'Réalisé'];
  const statut = statuts.includes(String(d.statut)) ? String(d.statut) : null;
  if (!statut) return { success: false, error: 'Statut inconnu' };

  await sql(
    `UPDATE interventions
        SET statut = $1::statut_t,
            remarque = COALESCE($2, remarque),
            panne = COALESCE($3, panne),
            statut_par = $4,
            mis_a_jour_le = now()
      WHERE id = $5`,
    [statut, d.remarque === undefined ? null : String(d.remarque),
     d.panne === undefined ? null : String(d.panne), session.matricule, id]);

  ctx.entite = 'intervention'; ctx.entiteId = id;
  ctx.avant = avant;
  ctx.apres = { statut, remarque: d.remarque, panne: d.panne };
  return { success: true };
}

// ============================================================================
//  DISPATCH
// ============================================================================
const CHEF_ONLY  = ['deleteClient', 'deleteIntervention', 'saveClient', 'saveClientLs', 'mergeClientsLs'];
const CHEF_READ  = ['getAll', 'getClientHistory', 'getClientsResilies'];
const ADMIN_ONLY = ['adminListUsers', 'adminAddUser', 'adminUpdateUser', 'adminDeleteUser',
                    'adminResetPin', 'adminAudit', 'adminSessions', 'adminRevoquerSession'];

// Portées ici pour l'instant ; le reste des actions d'écriture (saveConsistance,
// saveClient, gestion des utilisateurs, onglets Audit et Édition manuelle) est
// à porter — le frontend continue de les servir via Apps Script tant qu'elles
// ne sont pas listées ici, puisque la bascule se fait par URL et par appareil.
const ACTIONS = {
  ping:               async () => ({ success: true, pong: true }),
  login,
  logout,
  changePin,
  getByDate,
  getClients,
  getAll,
  getClientHistory,
  getClientsResilies,
  updateStatus
};

export default async (req, context) => {
  const json = (o, code = 200) => new Response(JSON.stringify(o),
    { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ success: false, error: 'Méthode non supportée' }, 405);
  }

  let d = {};
  try {
    if (req.method === 'POST') {
      const brut = await req.text();
      d = brut ? JSON.parse(brut) : {};
    } else {
      d = Object.fromEntries(new URL(req.url).searchParams);
    }
  } catch {
    return json({ success: false, error: 'Requête illisible' }, 400);
  }

  const action = String(d.action || '');
  const ctx = {
    action,
    role: null, matricule: null,
    ip: context?.ip || req.headers.get('x-nf-client-connection-ip') || null,
    userAgent: req.headers.get('user-agent') || ''
  };

  const t0 = Date.now();
  let resultat;
  try {
    if (!ACTIONS[action]) {
      resultat = { success: false, error: 'Action inconnue : ' + action };
    } else if (action === 'ping') {
      return json({ success: true, pong: true });
    } else if (action === 'login') {
      resultat = await login(d, ctx);
    } else {
      const session = await resoudreSession(d.token);
      if (!session) {
        resultat = { success: false, error: 'Session invalide, reconnectez-vous', authError: true };
      } else if (action === 'logout') {
        ctx.matricule = session.matricule;
        resultat = await logout(d, ctx);
      } else if (!session.roles.includes(d.actingRole)) {
        ctx.matricule = session.matricule;
        resultat = { success: false, error: 'Rôle non autorisé pour ce compte', authError: true };
      } else {
        ctx.matricule = session.matricule;
        ctx.role = d.actingRole;
        // Verrou serveur : un compte encore au PIN par défaut ne peut RIEN
        // faire tant qu'il ne l'a pas personnalisé. changePin est la seule
        // sortie, avec logout.
        if (session.mustChangePin && action !== 'changePin') {
          resultat = { success: false, error: 'Définissez un nouveau PIN avant de continuer', mustChangePin: true };
        } else if (CHEF_ONLY.includes(action) && !['chef', 'admin'].includes(d.actingRole)) {
          resultat = { success: false, error: 'Action réservée au chef centre' };
        } else if (CHEF_READ.includes(action) && d.actingRole === 'technicien') {
          resultat = { success: false, error: 'Accès réservé au chef centre' };
        } else if (ADMIN_ONLY.includes(action) && d.actingRole !== 'admin') {
          resultat = { success: false, error: 'Action réservée à l\'administrateur' };
        } else {
          resultat = await ACTIONS[action](d, ctx, session);
        }
      }
    }
  } catch (e) {
    console.error('[api]', action, e);
    resultat = { success: false, error: 'Erreur serveur : ' + e.message };
  }

  await journaliser(ctx, resultat);
  resultat._ms = Date.now() - t0;   // mesuré par l'instrumentation du frontend
  return json(resultat);
};

export const config = { path: '/api' };
