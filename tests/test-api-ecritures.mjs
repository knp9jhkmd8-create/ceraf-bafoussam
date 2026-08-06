// Deuxième tranche : écritures, administration, onglet Audit.
// Cible la VRAIE base. Tout ce qui est créé est supprimé en fin de test.
import fs from 'node:fs';
const conn = fs.readFileSync(process.argv[2], 'utf8').trim();
globalThis.Netlify = { env: { get: (k) => (k === 'DATABASE_URL' ? conn : undefined) } };
const { default: api } = await import(process.argv[3]);

let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  OK    ' + nom); }
  else { ko++; console.log('  ECHEC ' + nom + (detail ? '  -> ' + detail : '')); } };

async function appel(corps) {
  const rep = await api(new Request('https://t/api', { method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'harnais-2' },
    body: JSON.stringify(corps) }), { ip: '198.51.100.7' });
  return rep.json();
}

// ── Session admin ──────────────────────────────────────────────────────────
const l = await appel({ action: 'login', matricule: '999999', pin: '0000' });
if (!l.success) { console.error('login admin impossible: ' + JSON.stringify(l)); process.exit(1); }
const T = l.token;
await appel({ action: 'changePin', currentPin: '0000', newPin: '909090', token: T, actingRole: 'admin' });
const A = { token: T, actingRole: 'admin' };

const DATE = '2026-08-07';   // date de test, distincte des donnees reelles
const MAT  = '_H2_TEST';

console.log('\n1. saveConsistance — publication');
let invId = null;
{
  const r = await appel({ action: 'saveConsistance', date: DATE, ...A, interventions: [
    { type: 'Dérangements FTTH', num: '999000111', nom: 'CLIENT HARNAIS', ville: 'Bafoussam',
      quartier: 'TEST', tel: '600000000', loc: 'Rue du test', updateClient: true },
    { type: 'Études FTTH', customerId: 'CID-HARNAIS-1', nom: 'ETUDE HARNAIS', ville: 'Bafoussam',
      quartier: 'TEST', fdt: 'FDT-9', fat: 'FAT-9' }
  ]});
  v('publication acceptee', r.success === true, JSON.stringify(r));
  v('2 interventions creees', r.publiees === 2, 'publiees=' + r.publiees);

  const d = await appel({ action: 'getByDate', date: DATE, ...A });
  v('relecture: 2 interventions', (d.interventions || []).length === 2, (d.interventions || []).length + '');
  const etude = (d.interventions || []).find(i => i.type === 'Études FTTH');
  v('remarque structuree composee', etude && /FDT: FDT-9 • FAT: FAT-9/.test(etude.remarque || ''),
    etude ? etude.remarque : 'introuvable');
  invId = (d.interventions || [])[0]?.id;

  const g = await appel({ action: 'getClients', ...A });
  const cli = (g.clientsFtth || []).find(c => c.num === '999000111');
  v('fiche client creee par la publication', !!cli, cli ? cli.nom : 'absente');
  v('nom en MAJUSCULES', cli && cli.nom === 'CLIENT HARNAIS', cli ? cli.nom : '');
}

console.log('\n2. saveConsistance — IDEMPOTENCE (le point critique)');
{
  const uuid = crypto.randomUUID();
  const p = { action: 'saveConsistance', date: DATE, clientRequestId: uuid, ...A,
    interventions: [{ type: 'Dérangements FTTH', num: '999000222', nom: 'IDEMPOTENCE', ville: 'Bafoussam', quartier: 'TEST' }] };
  const a = await appel(p);
  const b = await appel(p);                       // rejeu exact, comme apres un timeout
  v('1er envoi publie', a.publiees === 1, JSON.stringify(a));
  v('rejeu NE duplique PAS', b.publiees === 0, 'publiees=' + b.publiees);
  const d = await appel({ action: 'getByDate', date: DATE, ...A });
  const n = (d.interventions || []).filter(i => i.num === '999000222').length;
  v('une seule ligne en base', n === 1, n + ' lignes');
}

console.log('\n3. reclassement de service (FTTH -> CUIVRE)');
{
  await appel({ action: 'saveConsistance', date: DATE, ...A, interventions: [
    { type: 'Dérangements Cuivre', num: '999000111', nom: 'CLIENT HARNAIS', ville: 'Bafoussam', quartier: 'TEST' }]});
  const g = await appel({ action: 'getClients', ...A });
  v('la fiche a change de service', (g.clientsCuivre || []).some(c => c.num === '999000111'),
    'cuivre=' + (g.clientsCuivre || []).length);
  v('elle ne figure plus en FTTH', !(g.clientsFtth || []).some(c => c.num === '999000111'));
}

console.log('\n4. GPS + suppression = archivage');
{
  const gp = await appel({ action: 'updateClientGPS', num: '999000111', gps: '5.1,10.2', ...A });
  v('GPS enregistre', gp.success === true, JSON.stringify(gp));
  const d1 = await appel({ action: 'getByDate', date: DATE, ...A });
  v('GPS remonte sur l intervention', (d1.interventions || []).some(i => i.gps === '5.1,10.2'));

  const del = await appel({ action: 'deleteClient', num: '999000111', ...A });
  v('suppression acceptee', del.success === true, JSON.stringify(del));
  const g = await appel({ action: 'getClients', ...A });
  v('client absent des listes actives',
    !(g.clientsFtth || []).concat(g.clientsCuivre || []).some(c => c.num === '999000111'));
}

console.log('\n5. deleteIntervention');
{
  // On prend une intervention ENCORE active : celle du client 999000111 a
  // deja ete archivee en cascade par le deleteClient de l'etape 4 — c'est le
  // comportement attendu, pas un defaut.
  const d0 = await appel({ action: 'getByDate', date: DATE, ...A });
  const cible = (d0.interventions || [])[0];
  v('une intervention active subsiste', !!cible, (d0.interventions || []).length + ' active(s)');
  if (cible) {
    const r = await appel({ action: 'deleteIntervention', invId: cible.id, ...A });
    v('archivee', r.success === true, JSON.stringify(r));
    const d = await appel({ action: 'getByDate', date: DATE, ...A });
    v('absente de la fiche du jour', !(d.interventions || []).some(i => i.id === cible.id));
  }
  // La cascade du deleteClient precedent doit bien avoir archive son intervention.
  const rebelote = await appel({ action: 'deleteIntervention', invId, ...A });
  v('cascade du deleteClient confirmee (deja archivee)',
    rebelote.success === false && /introuvable/.test(rebelote.error || ''), JSON.stringify(rebelote));
}

console.log('\n6. administration des utilisateurs');
{
  const add = await appel({ action: 'adminAddUser', matricule: MAT, nom: 'HARNAIS DEUX', roles: 'technicien', ...A });
  v('creation', add.success === true, JSON.stringify(add));
  const dbl = await appel({ action: 'adminAddUser', matricule: MAT, nom: 'X', roles: 'technicien', ...A });
  v('doublon refuse', dbl.success === false, JSON.stringify(dbl));
  const bad = await appel({ action: 'adminAddUser', matricule: MAT + 'B', nom: 'X', roles: 'sorcier', ...A });
  v('role invalide refuse', bad.success === false, JSON.stringify(bad));

  const list = await appel({ action: 'adminListUsers', ...A });
  const u = (list.users || []).find(x => x.id === MAT);
  v('present dans la liste', !!u);
  v('signale au PIN par defaut', u && u.pinParDefaut === true, u ? String(u.pinParDefaut) : '');

  const maj = await appel({ action: 'adminUpdateUser', id: MAT, roles: 'chef,technicien', ...A });
  v('mise a jour des roles', maj.success === true, JSON.stringify(maj));

  const moi = await appel({ action: 'adminDeleteUser', id: '999999', ...A });
  v('refuse de supprimer son propre compte', moi.success === false, JSON.stringify(moi));

  const rst = await appel({ action: 'adminResetPin', id: MAT, pin: '4321', ...A });
  v('reinitialisation du PIN', rst.success === true, JSON.stringify(rst));
  const lt = await appel({ action: 'login', matricule: MAT, pin: '4321' });
  v('connexion avec le nouveau PIN', lt.success === true, JSON.stringify(lt));

  const sup = await appel({ action: 'adminDeleteUser', id: MAT, ...A });
  v('suppression du compte de test', sup.success === true, JSON.stringify(sup));
  const apres = await appel({ action: 'login', matricule: MAT, pin: '4321' });
  v('compte supprime ne se connecte plus', apres.success === false, JSON.stringify(apres));
}

console.log('\n7. onglet AUDIT');
{
  const s = await appel({ action: 'adminSessions', ...A });
  v('sessions actives listees', s.success === true && (s.sessions || []).length > 0,
    (s.sessions || []).length + ' session(s)');
  const mienne = (s.sessions || []).find(x => x.matricule === '999999');
  v('ma session y figure', !!mienne);
  v('appareil trace', mienne && /harnais/.test(mienne.appareil || ''), mienne ? mienne.appareil : '');

  const a = await appel({ action: 'adminAudit', limite: 20, ...A });
  v('journal lisible', a.success === true && (a.lignes || []).length > 0, (a.lignes || []).length + ' ligne(s)');
  const avecAvantApres = (a.lignes || []).find(x => x.avant || x.apres);
  v('avant/apres presents', !!avecAvantApres);
  const f = await appel({ action: 'adminAudit', actionFiltre: 'saveConsistance', limite: 10, ...A });
  v('filtre par action', (f.lignes || []).every(x => x.action === 'saveConsistance'),
    (f.lignes || []).length + ' ligne(s)');

  // Revocation : on cree une 2e session puis on la coupe.
  const l2 = await appel({ action: 'login', matricule: '999999', pin: '909090' });
  const s2 = await appel({ action: 'adminSessions', ...A });
  const cible = (s2.sessions || []).find(x => x.matricule === '999999' && x.id !== mienne?.id);
  v('2e session visible', !!cible, (s2.sessions || []).length + ' sessions');
  if (cible) {
    const rv = await appel({ action: 'adminRevoquerSession', sessionId: cible.id, ...A });
    v('revocation acceptee', rv.success === true, JSON.stringify(rv));
    const mort = await appel({ action: 'getClients', token: l2.token, actingRole: 'admin' });
    v('la session revoquee ne passe plus', mort.authError === true, JSON.stringify(mort));
  }
}

console.log('\n8. controle d acces sur les actions admin');
{
  const t = await appel({ action: 'login', matricule: '402411', pin: '0000' });
  await appel({ action: 'changePin', currentPin: '0000', newPin: '515151', token: t.token, actingRole: 'technicien' });
  const T2 = { token: t.token, actingRole: 'technicien' };
  v('adminListUsers refuse au technicien',
    (await appel({ action: 'adminListUsers', ...T2 })).success === false);
  v('adminAudit refuse au technicien',
    (await appel({ action: 'adminAudit', ...T2 })).success === false);
  v('saveClient refuse au technicien',
    (await appel({ action: 'saveClient', num: '1', nom: 'X', ...T2 })).success === false);
  await appel({ action: 'changePin', currentPin: '515151', newPin: '0000', token: t.token, actingRole: 'technicien' });
  await appel({ action: 'logout', token: t.token });
}

console.log('\n9. nettoyage');
{
  // On archive les donnees de test creees par ce harnais.
  const d = await appel({ action: 'getByDate', date: DATE, ...A });
  for (const i of (d.interventions || [])) await appel({ action: 'deleteIntervention', invId: i.id, ...A });
  // Toutes les fiches clients creees par le harnais, y compris celle issue du
  // customerId de l'etude (saveConsistance cree une fiche pour toute cle, pas
  // seulement pour un numero de ligne).
  for (const n of ['999000111', '999000222', 'CID-HARNAIS-1']) {
    await appel({ action: 'deleteClient', num: n, ...A });
  }
  const g = await appel({ action: 'getClients', ...A });
  const restants = (g.clientsFtth || []).concat(g.clientsCuivre || [])
    .filter(c => /HARNAIS|IDEMPOTENCE/.test(c.nom || '') || /^999000|^CID-/.test(c.num || ''));
  v('aucune fiche de test residuelle', restants.length === 0,
    restants.map(c => c.num + '/' + c.nom).join(', '));
  v('base revenue a 258 FTTH', (g.clientsFtth || []).length === 258, (g.clientsFtth || []).length + '');
  v('base revenue a 23 Cuivre', (g.clientsCuivre || []).length === 23, (g.clientsCuivre || []).length + '');
  const fin = await appel({ action: 'getByDate', date: DATE, ...A });
  v('journee de test videe', (fin.interventions || []).length === 0, (fin.interventions || []).length + ' restantes');
  const r = await appel({ action: 'changePin', currentPin: '909090', newPin: '0000', ...A });
  v('PIN admin remis a 0000', r.success === true, JSON.stringify(r));
  await appel({ action: 'logout', token: T });
}

console.log('\n=== ' + ok + ' succes, ' + ko + ' echec(s) ===');
process.exit(ko ? 1 : 0);
