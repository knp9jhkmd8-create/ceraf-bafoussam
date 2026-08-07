// Teste le CŒUR de l'API (api/core.mjs) sans aucun hébergeur : on injecte la
// configuration puis on lui passe de vraies Request.
// Cible : la VRAIE base Neon, avec les VRAIES données.
//
// DEUX RÈGLES à ne pas enfreindre en modifiant ce fichier :
//  1. Ne JAMAIS s'appuyer sur un compte de l'équipe. Leurs PIN changent, et un
//     test ne doit pas perturber quelqu'un qui travaille. Tout passe par le
//     compte dédié `_T_HARNAIS`.
//  2. Chaque appel porte `_test: true` : les écritures sont journalisées mais
//     exclues de l'onglet Audit, qui ne doit montrer que l'activité réelle.
//
// Usage : node tests/test-api-lectures.mjs <fichier-conn> file:///<...>/api/core.mjs
import fs from 'node:fs';

const conn = fs.readFileSync(process.argv[2], 'utf8').trim();
const { configurerEnv, traiterRequete } = await import(process.argv[3]);
configurerEnv({ DATABASE_URL: conn });

const COMPTE = '_T_HARNAIS';
const PIN = '1234';
// Date du jour côté Cameroun (UTC+1) : c'est à cette date qu'est rattachée la
// fiche courante. Une date figée ferait échouer le test dès le lendemain.
const AUJOURDHUI = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);

let ok = 0, ko = 0;
const verifier = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  OK    ' + nom); }
  else { ko++; console.log('  ECHEC ' + nom + (detail ? '  -> ' + detail : '')); }
};

async function appel(corps) {
  const req = new Request('https://exemple.test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'harnais-test' },
    body: JSON.stringify({ ...corps, _test: true })
  });
  const rep = await traiterRequete(req, { ip: '203.0.113.9' });
  return { statut: rep.status, corps: await rep.json() };
}

console.log('\n1. ping');
verifier('repond pong', (await appel({ action: 'ping' })).corps.pong === true);

console.log('\n2. login — cas d\'erreur');
{
  const mauvais = await appel({ action: 'login', matricule: COMPTE, pin: '0001' });
  verifier('mauvais PIN refuse', mauvais.corps.success === false, JSON.stringify(mauvais.corps));
  const inconnu = await appel({ action: 'login', matricule: 'PAS_UN_MATRICULE', pin: '0000' });
  verifier('matricule inconnu refuse', inconnu.corps.error === 'Matricule introuvable', JSON.stringify(inconnu.corps));
}

let token = null;
console.log('\n3. login du compte de test');
{
  const r = await appel({ action: 'login', matricule: COMPTE, pin: PIN });
  verifier('connexion reussie', r.corps.success === true, JSON.stringify(r.corps));
  // Ce compte a un PIN personnalisé : il doit pouvoir travailler tout de suite.
  // Le verrou est vérifié à l'étape 4 sur un compte créé pour l'occasion.
  verifier('PIN personnalise, donc pas de verrou', r.corps.mustChangePin === false, 'mustChangePin=' + r.corps.mustChangePin);
  verifier('roles renvoyes', Array.isArray(r.corps.roles) && r.corps.roles.includes('admin'), JSON.stringify(r.corps.roles));
  verifier('token emis', typeof r.corps.token === 'string' && r.corps.token.length > 40);
  token = r.corps.token;
}
const A = { token, actingRole: 'admin' };

console.log('\n4. VERROU mustChangePin — sur un compte NEUF, laisse au PIN par defaut');
{
  const NEUF = '_T_VERROU';
  await appel({ action: 'adminAddUser', matricule: NEUF, nom: 'TEST VERROU', roles: 'technicien', ...A });
  const l = await appel({ action: 'login', matricule: NEUF, pin: '0000' });
  verifier('compte neuf signale mustChangePin', l.corps.mustChangePin === true, 'mustChangePin=' + l.corps.mustChangePin);
  const T = { token: l.corps.token, actingRole: 'technicien' };

  const bloque = await appel({ action: 'getByDate', date: AUJOURDHUI, ...T });
  verifier('lecture bloquee tant que le PIN est au defaut',
    bloque.corps.success === false && bloque.corps.mustChangePin === true, JSON.stringify(bloque.corps));

  // Au PIN par défaut, `currentPin` n'est pas exigé : c'est le correctif v115
  // qui a débloqué l'équipe. Sans lui, l'utilisateur boucle indéfiniment.
  const chg = await appel({ action: 'changePin', newPin: '5678', ...T });
  verifier('changePin accepte SANS currentPin quand le PIN est au defaut',
    chg.corps.success === true, JSON.stringify(chg.corps));

  const apres = await appel({ action: 'getByDate', date: AUJOURDHUI, ...T });
  verifier('lecture debloquee apres personnalisation', apres.corps.success === true,
    JSON.stringify(apres.corps).slice(0, 100));

  await appel({ action: 'adminDeleteUser', id: NEUF, ...A });
}

console.log('\n5. lectures du jour');
{
  const r = await appel({ action: 'getByDate', date: AUJOURDHUI, ...A });
  verifier('getByDate repond', r.corps.success === true, JSON.stringify(r.corps).slice(0, 120));
  verifier('la fiche du jour est alimentee', (r.corps.interventions || []).length > 0,
    (r.corps.interventions || []).length + ' intervention(s)');
  verifier('durees calculees', (r.corps.interventions || []).some(i => i.duree > 0));
  verifier('le contact client est joint', (r.corps.interventions || []).some(i => 'tel' in i));
}

console.log('\n6. session invalide');
verifier('rejetee avec authError',
  (await appel({ action: 'getByDate', date: AUJOURDHUI, token: 'faux-token', actingRole: 'admin' })).corps.authError === true);

console.log('\n7. controle des roles');
{
  const usurpe = await appel({ action: 'getByDate', date: AUJOURDHUI, token, actingRole: 'chef' });
  verifier('role reellement detenu accepte', usurpe.corps.success === true, JSON.stringify(usurpe.corps).slice(0, 90));

  const T = { token, actingRole: 'technicien' };
  const interdit = await appel({ action: 'getAll', month: AUJOURDHUI.slice(0, 7), ...T });
  verifier('getAll refuse au technicien',
    interdit.corps.success === false && /chef/.test(interdit.corps.error || ''), JSON.stringify(interdit.corps));

  const permis = await appel({ action: 'getClients', ...T });
  verifier('getClients autorise au technicien', permis.corps.success === true);
  // Pas de compteurs figés : l'équipe crée des fiches tous les jours, un
  // nombre en dur ferait échouer le test au premier client ajouté. On vérifie
  // la COHÉRENCE (les trois listes existent, sont peuplées, et les fiches
  // portent bien leurs champs), pas une photographie.
  const f = permis.corps.clientsFtth || [], c = permis.corps.clientsCuivre || [], ls = permis.corps.clientsLs || [];
  verifier('les trois listes clients sont peuplees', f.length > 0 && c.length > 0 && ls.length > 0,
    `ftth=${f.length} cuivre=${c.length} ls=${ls.length}`);
  verifier('chaque fiche FTTH porte un numero et un nom', f.every(x => x.num && 'nom' in x));
  verifier('aucun numero en doublon entre FTTH et Cuivre',
    new Set([...f, ...c].map(x => x.num)).size === f.length + c.length);
  verifier('interventions actives renvoyees', Array.isArray(permis.corps.activeInterventions));
}

console.log('\n8. getAll — FORME de la reponse (regression de l\'Historique)');
{
  const r = await appel({ action: 'getAll', month: AUJOURDHUI.slice(0, 7), ...A });
  verifier('getAll repond', r.corps.success === true, JSON.stringify(r.corps).slice(0, 120));
  // Le frontend lit `data[]` avec les interventions IMBRIQUEES, plus la liste
  // des mois. Une premiere version renvoyait deux listes plates et parallèles :
  // l'onglet Historique restait vide. On verifie la FORME, pas que le contenu.
  verifier('renvoie data[] (fiches)', Array.isArray(r.corps.data), typeof r.corps.data);
  verifier('renvoie availableMonths non vide',
    Array.isArray(r.corps.availableMonths) && r.corps.availableMonths.length > 0,
    JSON.stringify(r.corps.availableMonths));
  verifier('chaque fiche porte ses interventions imbriquees',
    (r.corps.data || []).length > 0 && (r.corps.data || []).every(f => Array.isArray(f.interventions)));

  const inv = (r.corps.data || []).flatMap(f => f.interventions || []);
  verifier('interventions presentes', inv.length > 0, inv.length + '');
  verifier('le contact client est fourni (tel)', inv.every(i => 'tel' in i));
  verifier('les dates sont au format YYYY-MM-DD (triables et affichables)',
    inv.every(i => /^\d{4}-\d{2}-\d{2}$/.test(String(i.date))),
    JSON.stringify(inv.slice(0, 2).map(i => i.date)));

  const cles = inv.map(i => i.nom + '|' + i.num + '|' + i.type);
  verifier('aucun doublon apres dedoublonnage', new Set(cles).size === cles.length,
    cles.length + ' lignes, ' + new Set(cles).size + ' cles distinctes');
}

console.log('\n9. updateStatus — idempotence');
{
  const r0 = await appel({ action: 'getByDate', date: AUJOURDHUI, ...A });
  const cible = (r0.corps.interventions || [])[0];
  verifier('intervention cible trouvee', !!cible);
  if (cible) {
    const avant = cible.statut, remarqueAvant = cible.remarque || '';
    const u1 = await appel({ action: 'updateStatus', invId: cible.id, statut: 'Injoignable', remarque: 'test harnais', ...A });
    verifier('mise a jour acceptee', u1.corps.success === true, JSON.stringify(u1.corps));
    const u2 = await appel({ action: 'updateStatus', invId: cible.id, statut: 'Injoignable', remarque: 'test harnais', ...A });
    verifier('rejeu identique sans effet de bord', u2.corps.success === true);

    const relu = ((await appel({ action: 'getByDate', date: AUJOURDHUI, ...A })).corps.interventions || [])
      .find(i => i.id === cible.id);
    verifier('statut bien persiste', relu && relu.statut === 'Injoignable', relu ? relu.statut : 'introuvable');
    verifier('statut inconnu refuse',
      (await appel({ action: 'updateStatus', invId: cible.id, statut: 'Nimporte quoi', ...A })).corps.success === false);

    await appel({ action: 'updateStatus', invId: cible.id, statut: avant, remarque: remarqueAvant, ...A });
    const fin = ((await appel({ action: 'getByDate', date: AUJOURDHUI, ...A })).corps.interventions || [])
      .find(i => i.id === cible.id);
    verifier('etat initial restaure', fin && fin.statut === avant, fin ? fin.statut : '?');
  }
}

console.log('\n10. deconnexion');
{
  verifier('logout accepte', (await appel({ action: 'logout', token })).corps.success === true);
  verifier('token revoque apres logout',
    (await appel({ action: 'getClients', token, actingRole: 'technicien' })).corps.authError === true);
}

console.log('\n=== ' + ok + ' succes, ' + ko + ' echec(s) ===');
process.exit(ko ? 1 : 0);
