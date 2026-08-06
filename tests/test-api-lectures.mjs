// Teste le COEUR de l'API (api/core.mjs) sans aucun hebergeur : on injecte
// la configuration puis on lui passe de vraies Request.
// Cible : la VRAIE base Neon, avec les VRAIES donnees migrees.
import fs from 'node:fs';

const conn = fs.readFileSync(process.argv[2], 'utf8').trim();
const { configurerEnv, traiterRequete } = await import(process.argv[3]);
configurerEnv({ DATABASE_URL: conn });


let ok = 0, ko = 0;
const verifier = (nom, cond, detail) => {
  if (cond) { ok++; console.log('  OK    ' + nom); }
  else { ko++; console.log('  ECHEC ' + nom + (detail ? '  -> ' + detail : '')); }
};

async function appel(corps) {
  const req = new Request('https://exemple.test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': 'harnais-test' },
    body: JSON.stringify(corps)
  });
  const rep = await traiterRequete(req, { ip: '203.0.113.9' });
  return { statut: rep.status, corps: await rep.json() };
}

console.log('\n1. ping');
{
  const r = await appel({ action: 'ping' });
  verifier('repond pong', r.corps.pong === true, JSON.stringify(r.corps));
}

console.log('\n2. login — mauvais PIN puis bon PIN');
{
  const mauvais = await appel({ action: 'login', matricule: '103300', pin: '0001' });
  verifier('mauvais PIN refuse', mauvais.corps.success === false, JSON.stringify(mauvais.corps));

  // 103300 n'a pas ete reinitialise : son PIN reel est inconnu du harnais.
  // On teste donc le chemin « matricule introuvable » et la session via un
  // compte dont on connait le PIN (999999 remis a 0000).
  const inconnu = await appel({ action: 'login', matricule: 'PAS_UN_MATRICULE', pin: '0000' });
  verifier('matricule inconnu refuse', inconnu.corps.error === 'Matricule introuvable', JSON.stringify(inconnu.corps));
}

let token = null, tokenTech = null;
console.log('\n3. login admin (999999 / 0000, remis au defaut)');
{
  const r = await appel({ action: 'login', matricule: '999999', pin: '0000' });
  verifier('connexion reussie', r.corps.success === true, JSON.stringify(r.corps));
  verifier('mustChangePin signale', r.corps.mustChangePin === true, 'mustChangePin=' + r.corps.mustChangePin);
  verifier('roles renvoyes', Array.isArray(r.corps.roles) && r.corps.roles.includes('admin'), JSON.stringify(r.corps.roles));
  verifier('token emis', typeof r.corps.token === 'string' && r.corps.token.length > 40);
  token = r.corps.token;
}

console.log('\n4. VERROU mustChangePin — doit tout bloquer sauf changePin/logout');
{
  const r = await appel({ action: 'getByDate', date: '2026-08-06', token, actingRole: 'admin' });
  verifier('lecture bloquee', r.corps.success === false && r.corps.mustChangePin === true, JSON.stringify(r.corps));
}

console.log('\n5. changePin puis lecture autorisee');
{
  const c = await appel({ action: 'changePin', currentPin: '0000', newPin: '778899', token, actingRole: 'admin' });
  verifier('changement accepte', c.corps.success === true, JSON.stringify(c.corps));

  const r = await appel({ action: 'getByDate', date: '2026-08-06', token, actingRole: 'admin' });
  verifier('la session reste valide apres changePin', r.corps.success === true, JSON.stringify(r.corps).slice(0, 120));
  verifier('26 interventions pour le 06/08', (r.corps.interventions || []).length === 26,
    (r.corps.interventions || []).length + ' interventions');
  const avecDuree = (r.corps.interventions || []).filter(i => i.duree > 0).length;
  verifier('durees calculees', avecDuree > 0, avecDuree + ' interventions avec duree > 0');

  // On remet le PIN au defaut : l'utilisateur reel doit toujours etre invite
  // a le personnaliser, le harnais ne doit rien laisser derriere lui.
  const retour = await appel({ action: 'changePin', currentPin: '778899', newPin: '0000', token, actingRole: 'admin' });
  verifier('PIN admin remis a 0000 (etat rendu intact)', retour.corps.success === true, JSON.stringify(retour.corps));
}

console.log('\n6. session invalide');
{
  const r = await appel({ action: 'getByDate', date: '2026-08-06', token: 'faux-token', actingRole: 'admin' });
  verifier('rejetee avec authError', r.corps.authError === true, JSON.stringify(r.corps));
}

console.log('\n7. controle des roles');
{
  const t = await appel({ action: 'login', matricule: '402411', pin: '0000' });
  tokenTech = t.corps.token;
  const chg = await appel({ action: 'changePin', currentPin: '0000', newPin: '445566', token: tokenTech, actingRole: 'technicien' });
  verifier('technicien personnalise son PIN', chg.corps.success === true, JSON.stringify(chg.corps));

  const usurpe = await appel({ action: 'getByDate', date: '2026-08-06', token: tokenTech, actingRole: 'admin' });
  verifier('role usurpe refuse', usurpe.corps.authError === true, JSON.stringify(usurpe.corps));

  const interdit = await appel({ action: 'getAll', month: '2026-08', token: tokenTech, actingRole: 'technicien' });
  verifier('getAll refuse au technicien', interdit.corps.success === false && /chef/.test(interdit.corps.error || ''),
    JSON.stringify(interdit.corps));

  const permis = await appel({ action: 'getClients', token: tokenTech, actingRole: 'technicien' });
  verifier('getClients autorise au technicien', permis.corps.success === true);
  verifier('258 clients FTTH', (permis.corps.clientsFtth || []).length === 258, (permis.corps.clientsFtth || []).length + '');
  verifier('23 clients Cuivre', (permis.corps.clientsCuivre || []).length === 23, (permis.corps.clientsCuivre || []).length + '');
  verifier('4 clients LS', (permis.corps.clientsLs || []).length === 4, (permis.corps.clientsLs || []).length + '');
}

console.log('\n8. getAll (chef) — dedoublonnage mensuel');
{
  const a = await appel({ action: 'login', matricule: '999999', pin: '0000' });
  const tAdmin = a.corps.token;
  await appel({ action: 'changePin', currentPin: '0000', newPin: '112233', token: tAdmin, actingRole: 'admin' });
  const r = await appel({ action: 'getAll', month: '2026-08', token: tAdmin, actingRole: 'admin' });
  verifier('getAll repond', r.corps.success === true, JSON.stringify(r.corps).slice(0, 120));
  const inv = r.corps.interventions || [];
  const cles = inv.map(i => i.nom + '|' + i.num + '|' + i.type);
  verifier('aucun doublon apres dedoublonnage', new Set(cles).size === cles.length,
    cles.length + ' lignes, ' + new Set(cles).size + ' cles distinctes');
  verifier('consistances du mois renvoyees', (r.corps.consistances || []).length > 0,
    (r.corps.consistances || []).length + '');
  await appel({ action: 'changePin', currentPin: '112233', newPin: '0000', token: tAdmin, actingRole: 'admin' });
}

console.log('\n9. updateStatus — idempotence');
{
  const r0 = await appel({ action: 'getByDate', date: '2026-08-06', token: tokenTech, actingRole: 'technicien' });
  const cible = (r0.corps.interventions || [])[0];
  verifier('intervention cible trouvee', !!cible, JSON.stringify(cible || {}).slice(0, 80));
  if (cible) {
    const avant = cible.statut;
    const u1 = await appel({ action: 'updateStatus', invId: cible.id, statut: 'Injoignable',
      remarque: 'test harnais', token: tokenTech, actingRole: 'technicien' });
    verifier('mise a jour acceptee', u1.corps.success === true, JSON.stringify(u1.corps));
    const u2 = await appel({ action: 'updateStatus', invId: cible.id, statut: 'Injoignable',
      remarque: 'test harnais', token: tokenTech, actingRole: 'technicien' });
    verifier('rejeu identique sans effet de bord', u2.corps.success === true, JSON.stringify(u2.corps));

    const apres = await appel({ action: 'getByDate', date: '2026-08-06', token: tokenTech, actingRole: 'technicien' });
    const relu = (apres.corps.interventions || []).find(i => i.id === cible.id);
    verifier('statut bien persiste', relu && relu.statut === 'Injoignable', relu ? relu.statut : 'introuvable');

    const mauvais = await appel({ action: 'updateStatus', invId: cible.id, statut: 'Nimporte quoi',
      token: tokenTech, actingRole: 'technicien' });
    verifier('statut inconnu refuse', mauvais.corps.success === false, JSON.stringify(mauvais.corps));

    // Remise dans l'etat initial
    await appel({ action: 'updateStatus', invId: cible.id, statut: avant, remarque: cible.remarque || '',
      token: tokenTech, actingRole: 'technicien' });
    const fin = await appel({ action: 'getByDate', date: '2026-08-06', token: tokenTech, actingRole: 'technicien' });
    const remis = (fin.corps.interventions || []).find(i => i.id === cible.id);
    verifier('etat initial restaure', remis && remis.statut === avant, remis ? remis.statut : '?');
  }
}

console.log('\n10. remise en etat du compte technicien');
{
  const r = await appel({ action: 'changePin', currentPin: '445566', newPin: '0000', token: tokenTech, actingRole: 'technicien' });
  verifier('PIN technicien remis a 0000', r.corps.success === true, JSON.stringify(r.corps));
  const out = await appel({ action: 'logout', token: tokenTech });
  verifier('logout accepte', out.corps.success === true);
  const apres = await appel({ action: 'getClients', token: tokenTech, actingRole: 'technicien' });
  verifier('token revoque apres logout', apres.corps.authError === true, JSON.stringify(apres.corps));
}

console.log('\n=== ' + ok + ' succes, ' + ko + ' echec(s) ===');
process.exit(ko ? 1 : 0);
