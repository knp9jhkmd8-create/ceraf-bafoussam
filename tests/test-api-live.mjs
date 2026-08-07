// Rejoue le harnais contre l'API DÉPLOYÉE (HTTP), et non plus contre le
// module importé. Mesure aussi la latence client vs le temps serveur (_ms),
// pour isoler le coût réseau.
const URL_API = process.argv[2] || 'https://ceraf-bafoussam-api.netlify.app/api';

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
verifier('mustChangePin signale', l.mustChangePin === true, 'mustChangePin=' + l.mustChangePin);
const tok = l.token;

console.log('\n3. verrou mustChangePin');
const bloque = await appel({ action: 'getByDate', date: '2026-08-06', token: tok, actingRole: 'technicien' });
verifier('lecture bloquee tant que PIN par defaut', bloque.mustChangePin === true, JSON.stringify(bloque));

console.log('\n4. changePin puis lectures');
const chg = await appel({ action: 'changePin', currentPin: '1234', newPin: '336699', token: tok, actingRole: 'technicien' });
verifier('changement accepte', chg.success === true, JSON.stringify(chg));

const d = await appel({ action: 'getByDate', date: '2026-08-06', token: tok, actingRole: 'technicien' });
verifier('getByDate repond', d.success === true, JSON.stringify(d).slice(0, 120));
verifier('26 interventions', (d.interventions || []).length === 26, (d.interventions || []).length + '');
verifier('durees calculees', (d.interventions || []).some(i => i.duree > 0));

const g = await appel({ action: 'getClients', token: tok, actingRole: 'technicien' });
verifier('getClients repond', g.success === true, JSON.stringify(g).slice(0, 120));
verifier('258 FTTH', (g.clientsFtth || []).length === 258, (g.clientsFtth || []).length + '');
verifier('23 Cuivre', (g.clientsCuivre || []).length === 23, (g.clientsCuivre || []).length + '');
verifier('4 LS', (g.clientsLs || []).length === 4, (g.clientsLs || []).length + '');

console.log('\n5. controle des roles');
verifier('getAll refuse au technicien',
  (await appel({ action: 'getAll', month: '2026-08', token: tok, actingRole: 'technicien' })).success === false);
verifier('role usurpe refuse',
  (await appel({ action: 'getByDate', date: '2026-08-06', token: tok, actingRole: 'admin' })).authError === true);

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
