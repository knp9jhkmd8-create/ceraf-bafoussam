// Rejoue le harnais contre l'API DÉPLOYÉE (HTTP), et non plus contre le
// module importé. Mesure aussi la latence client vs le temps serveur (_ms),
// pour isoler le coût réseau.
const URL_API = process.argv[2] || 'https://ceraf-bafoussam-api.knp9jhkmd8.workers.dev';

let ok = 0, ko = 0;
const mesures = [];
const verifier = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  OK    ' + nom); }
  else { ko++; console.log('  ECHEC ' + nom + (detail ? '  -> ' + detail : '')); }
};

async function appel(corps) {
  const t0 = Date.now();
  const rep = await fetch(URL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps)
  });
  const txt = await rep.text();
  const ms = Date.now() - t0;
  let j; try { j = JSON.parse(txt); } catch { j = { _brut: txt.slice(0, 200) }; }
  mesures.push({ action: corps.action, ms, srv: j._ms ?? null, octets: txt.length });
  return j;
}

console.log('Cible : ' + URL_API + '\n');

console.log('1. ping');
verifier('pong', (await appel({ action: 'ping' })).pong === true);

console.log('\n2. login');
const l = await appel({ action: 'login', matricule: '_T_HARNAIS', pin: '1234' });
verifier('connexion reussie', l.success === true, JSON.stringify(l));
// Le PIN du harnais est 1234, pas le DEFAULT_PIN ('0000') : `mustChangePin`
// doit donc être FAUX. Le verrou lui-même (compte encore au PIN par défaut, à
// l'origine de l'incident du 06/08) est couvert par le harnais hors ligne, qui
// peut fabriquer un compte dans cet état — un test live ne le peut pas sans
// laisser un compte cassé derrière lui en cas d'interruption.
verifier('mustChangePin faux (PIN personnalise)', l.mustChangePin === false, 'mustChangePin=' + l.mustChangePin);
const tok = l.token;

console.log('\n3. changePin puis lectures');
const chg = await appel({ action: 'changePin', currentPin: '1234', newPin: '336699', token: tok, actingRole: 'technicien' });
verifier('changement accepte', chg.success === true, JSON.stringify(chg));

// Pas de date ni de compte EN DUR : le report nocturne déplace les
// interventions encore ouvertes vers le jour ouvré suivant, donc une fiche
// passée se vide toute seule. C'est ce qui faisait échouer « 26 interventions
// au 2026-08-06 » — un faux échec qui masquait les vrais.
const AUJOURDHUI = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const d = await appel({ action: 'getByDate', date: AUJOURDHUI, token: tok, actingRole: 'technicien' });
verifier('getByDate repond', d.success === true, JSON.stringify(d).slice(0, 120));
// Le week-end, il n'y a legitimement PAS de fiche : `reporter_interventions()`
// ne cree jamais de consistance un samedi ou un dimanche, et reporte au lundi.
// Asserter « fiche non vide » sans regarder le jour echoue a tort deux jours
// sur sept -- exactement le genre de faux echec qui finit par masquer les vrais.
const jourSemaine = new Date(AUJOURDHUI + 'T12:00:00Z').getUTCDay();   // 0=dim, 6=sam
const ouvre = jourSemaine >= 1 && jourSemaine <= 5;
if (ouvre) {
  verifier('fiche du jour non vide', (d.interventions || []).length > 0, (d.interventions || []).length + '');
  verifier('durees calculees', (d.interventions || []).some(i => i.duree >= 0));
} else {
  console.log('  (week-end : pas de fiche du jour, comportement attendu)');
}

const g = await appel({ action: 'getClients', token: tok, actingRole: 'technicien' });
verifier('getClients repond', g.success === true, JSON.stringify(g).slice(0, 120));
// Pas d'effectif EN DUR : la base vit (fiches ajoutées, résiliées, archivées).
// Un nombre figé finit toujours par échouer à tort et masquer les vrais
// problèmes — c'est ce qui est arrivé le 07/08 avec « 26 interventions » et
// « 258 FTTH ». On vérifie la FORME, pas le décompte.
verifier('trois listes clients presentes',
  Array.isArray(g.clientsFtth) && Array.isArray(g.clientsCuivre) && Array.isArray(g.clientsLs));
verifier('base clients non vide', (g.clientsFtth || []).length > 0, (g.clientsFtth || []).length + '');
verifier('fiches clients bien formees',
  (g.clientsFtth || []).every(c => c.num && c.nom !== undefined),
  JSON.stringify((g.clientsFtth || [])[0] || {}));
verifier('interventions actives fournies', Array.isArray(g.activeInterventions));

// Ces trois actions sont celles que le portage vers Neon avait cassées en
// renommant leurs clés de réponse : le frontend lisait `history` et
// `clientsResilies`, le backend renvoyait `historique` et `clients`. Le nom de
// la clé EST le contrat — d'où des assertions dessus, et pas seulement sur
// `success`, qui restait vrai pendant tout le temps où l'app était cassée.
// getClientHistory et getClientsResilies sont chef-only (CHEF_READ) : les
// appeler en technicien renvoie un refus, pas un historique.
console.log('\n3b. historique client');
const hf = await appel({ action: 'getClientHistory', num: '233441027', token: tok, actingRole: 'chef' });
verifier('cle `history` presente', Array.isArray(hf.history), JSON.stringify(Object.keys(hf)));
verifier('historique FTTH non vide', (hf.history || []).length > 0, (hf.history || []).length + '');

const hl = await appel({ action: 'getClientHistory', nomLs: 'AFRILAND FIRST BANK BALENG',
  villeLs: 'Bafoussam', quartierLs: 'ECOLE NORMALE', token: tok, actingRole: 'chef' });
verifier('historique LS trouve', (hl.history || []).length > 0, (hl.history || []).length + '');
verifier('historique LS bien du LS', (hl.history || []).length > 0
  && (hl.history || []).every(i => String(i.type).includes('LS')),
  JSON.stringify((hl.history || []).map(i => i.type)));

// Le quartier discrimine vraiment : la fiche LS est identifiee par
// (nom, ville, quartier), donc un quartier different est un AUTRE client.
const hx = await appel({ action: 'getClientHistory', nomLs: 'AFRILAND FIRST BANK BALENG',
  villeLs: 'Bafoussam', quartierLs: 'QUARTIER INEXISTANT', token: tok, actingRole: 'chef' });
verifier('quartier discriminant', (hx.history || []).length === 0, (hx.history || []).length + '');

console.log('\n3c. clients resilies');
const cr = await appel({ action: 'getClientsResilies', token: tok, actingRole: 'chef' });
verifier('cle `clientsResilies` presente', Array.isArray(cr.clientsResilies), JSON.stringify(Object.keys(cr)));

// La sauvegarde est la seule copie des donnees hors de l'hebergeur. Deux choses
// comptent : qu'elle soit COMPLETE, et qu'elle ne fasse PAS sortir les
// empreintes de PIN (4 chiffres se cassent en minutes a partir d'un hash).
console.log('\n3d. sauvegarde');
verifier('export refuse au chef',
  (await appel({ action: 'adminExport', token: tok, actingRole: 'chef' })).success === false);
const ex = (await appel({ action: 'adminExport', token: tok, actingRole: 'admin' })).export || {};
const tbl = ex.tables || {};
verifier('7 tables exportees', Object.keys(tbl).length === 7, Object.keys(tbl).join(','));
verifier('clients et interventions non vides',
  (tbl.clients || []).length > 0 && (tbl.interventions || []).length > 0);
verifier('aucune cle pin_hash', !(tbl.utilisateurs || []).some(u => 'pin_hash' in u));
verifier('aucune empreinte SHA-256 dans la charge', !/[a-f0-9]{64}/.test(JSON.stringify(tbl)));
verifier('compte coherent avec les tables',
  Object.keys(tbl).every(k => (ex.compte || {})[k] === tbl[k].length), JSON.stringify(ex.compte));

// La tuile « Durée moy. sur le mois » repose sur `dureeMois`, calcule en base :
// compteur remis a zero au 1er du mois pour tout dossier herite du mois
// precedent. La duree VRAIE de chaque intervention doit rester intacte a cote.
console.log('\n3f. duree mensuelle vs duree reelle');
const ga = await appel({ action: 'getAll', month: AUJOURDHUI.slice(0, 7), token: tok, actingRole: 'chef' });
const toutes = [].concat(...((ga.data || []).map(c => c.interventions || [])));
verifier('getAll renvoie des interventions', toutes.length > 0, String(toutes.length));
verifier('dureeMois fourni sur toutes les lignes',
  toutes.every(i => i.dureeMois !== undefined && i.dureeMois !== null),
  toutes.filter(i => i.dureeMois == null).length + ' sans dureeMois');
verifier('dureeMois jamais superieure a la duree reelle',
  toutes.every(i => Number(i.dureeMois) <= Number(i.duree)),
  JSON.stringify(toutes.filter(i => Number(i.dureeMois) > Number(i.duree)).slice(0, 2)));
const reporte = toutes.find(i => i.reporteDepuis && String(i.reporteDepuis).slice(0, 7) < AUJOURDHUI.slice(0, 7));
if (reporte) {
  verifier('un report du mois precedent voit son compteur repartir',
    Number(reporte.dureeMois) < Number(reporte.duree),
    `vraie ${reporte.duree} / mois ${reporte.dureeMois}`);
  verifier('sa duree REELLE reste affichee', Number(reporte.duree) > 0, String(reporte.duree));
}

console.log('\n3e. sauvegardes automatiques (cron -> KV)');
verifier('liste refusee au chef',
  (await appel({ action: 'adminBackups', token: tok, actingRole: 'chef' })).success === false);
const li = await appel({ action: 'adminBackups', token: tok, actingRole: 'admin' });
verifier('liste renvoyee', li.success === true, JSON.stringify(li).slice(0, 120));
const sv = (li.sauvegardes || [])[0];
if (!sv) {
  // Pas un echec : l'espace KV peut etre vide avant la premiere nuit.
  console.log('  (aucune sauvegarde encore — normal avant le premier passage du cron)');
} else {
  verifier('metadonnees presentes', sv.lignes > 0 && sv.octets > 0, JSON.stringify(sv));
  verifier('expiration posee', sv.expire > Math.floor(Date.now() / 1000), String(sv.expire));
  const dl = await appel({ action: 'adminBackups', cle: sv.cle, token: tok, actingRole: 'admin' });
  verifier('telechargement d une sauvegarde', dl.success === true && !!dl.export);
  verifier('7 tables dans la copie', Object.keys((dl.export || {}).tables || {}).length === 7);
  verifier('aucune empreinte SHA-256 dans la copie',
    !/[a-f0-9]{64}/.test(JSON.stringify((dl.export || {}).tables || {})));
}
// La cle vient du client : sans validation, toute autre entree du meme espace
// KV deviendrait lisible.
verifier('cle forgee refusee',
  (await appel({ action: 'adminBackups', cle: '../secret', token: tok, actingRole: 'admin' })).success === false);

console.log('\n5. controle des roles');
verifier('getAll refuse au technicien',
  (await appel({ action: 'getAll', month: '2026-08', token: tok, actingRole: 'technicien' })).success === false);
// `_T_HARNAIS` porte les trois rôles : demander « admin » est légitime pour lui.
// Ce qui doit être refusé, c'est un rôle qu'il ne porte PAS.
verifier('role inconnu refuse',
  (await appel({ action: 'getByDate', date: AUJOURDHUI, token: tok, actingRole: 'directeur' })).authError === true);

console.log('\n6. remise en etat');
verifier('PIN remis a 0000',
  (await appel({ action: 'changePin', currentPin: '336699', newPin: '1234', token: tok, actingRole: 'technicien' })).success === true);
verifier('logout', (await appel({ action: 'logout', token: tok })).success === true);
verifier('token revoque',
  (await appel({ action: 'getClients', token: tok, actingRole: 'technicien' })).authError === true);

console.log('\n=== LATENCE ===');
console.log('  action              total     serveur   reseau    octets');
mesures.forEach(m => {
  const res = m.srv === null ? '—' : (m.ms - m.srv) + 'ms';
  console.log('  ' + (m.action + '                 ').slice(0, 18)
    + String(m.ms + 'ms').padStart(8)
    + String(m.srv === null ? '—' : m.srv + 'ms').padStart(10)
    + String(res).padStart(10)
    + String(m.octets).padStart(10));
});
const parAction = {};
mesures.forEach(m => (parAction[m.action] = parAction[m.action] || []).push(m.ms));
console.log('\n  mediane par action :');
Object.keys(parAction).sort().forEach(a => {
  const s = parAction[a].slice().sort((x, y) => x - y);
  console.log('    ' + (a + '              ').slice(0, 16) + s[Math.floor(s.length / 2)] + ' ms');
});

console.log('\n=== ' + ok + ' succes, ' + ko + ' echec(s) ===');
process.exit(ko ? 1 : 0);
