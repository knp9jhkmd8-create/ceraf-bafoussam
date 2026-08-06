// Harnais de test de changePin() : charge le vrai Code.gs avec des stubs
// Apps Script minimaux, et rejoue les scénarios de l'incident du 2026-08-06.
const fs = require('fs');
const crypto = require('crypto');

// ── Stubs Apps Script ───────────────────────────────
let uuidSeq = 0;
global.Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  computeDigest(_algo, s) {
    // Renvoie des octets signés, comme Apps Script.
    return Array.from(crypto.createHash('sha256').update(s, 'utf8').digest())
                .map(b => (b > 127 ? b - 256 : b));
  },
  getUuid() { return 'uuid-' + (++uuidSeq) + '-aaaaaaaa'; }
};

// Feuille Utilisateurs simulée
const HEADERS = ['ID','Nom','PIN_Hash','Role','Actif','Token','Token_Expire','Derniere_connexion'];
function makeSheet(rows) {
  const data = [HEADERS.slice()].concat(rows);
  return {
    data,
    getDataRange() { return { getValues: () => data.map(r => r.slice()) }; },
    getLastColumn() { return HEADERS.length; },
    getRange(r, c, nr, nc) {
      return {
        setValue(v) { data[r-1][c-1] = v; },
        getValues() {
          return data.slice(r-1, r-1+(nr||1)).map(row => row.slice(c-1, c-1+(nc||1)));
        }
      };
    }
  };
}
let SHEET;
global.s4 = () => SHEET;

// ── Chargement du vrai Code.gs ──────────────────────
const src = fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'), 'utf8');
// On n'exécute que les fonctions dont on a besoin, dans un scope global partagé.
const vm = require('vm');
const ctx = vm.createContext(global);
vm.runInContext(src, ctx);
// s4 du fichier écrase notre stub → on le remet après chargement.
vm.runInContext('s4 = () => SHEET_STUB;', ctx);
global.SHEET_STUB = null;

// ── Scénarios ───────────────────────────────────────
let ok = 0, ko = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log('  OK   ' + nom); }
  else { ko++; console.log('  ECHEC ' + nom + (detail ? ' → ' + detail : '')); }
}
function setUser(pinHashValue) {
  SHEET = makeSheet([['103300','DUPONT',pinHashValue,'technicien','true','tok-1',new Date(2099,0,1),'']]);
  global.SHEET_STUB = SHEET;
  return SHEET;
}
const session = { id: '103300' };
// PIN_SALT est déclaré en `const` : dans un contexte vm il n'est PAS exposé
// sur l'objet global (contrairement aux `function`). On l'évalue donc dedans.
const hashDefautAncien = vm.runInContext('hashPin("0000", PIN_SALT)', ctx);  // format hérité (hex nu)
const hashDefautSale   = ctx.hacherPin('0000');                       // format "<hash>:<sel>"

console.log('\n1. Compte au PIN par défaut, frontend DEPLOYE (n\'envoie pas currentPin)');
{
  const s = setUser(hashDefautSale);
  const r = ctx.changePin({ newPin: '4821' }, session);
  check('changePin accepte sans currentPin', r.success === true, JSON.stringify(r));
  check('le nouveau PIN est bien stocke', ctx.verifierPin(s.data[1][2], '4821'));
  check('mustChangePin retombe a false', ctx.isDefaultPin(s.data[1][2]) === false);
  check('le token de session est CONSERVE', s.data[1][5] === 'tok-1', 'token=' + s.data[1][5]);
  check('reconnexion avec le nouveau PIN OK', ctx.verifierPin(s.data[1][2], '4821'));
  check('reconnexion avec 0000 REFUSEE', ctx.verifierPin(s.data[1][2], '0000') === false);
}

console.log('\n2. Compte au PIN par defaut format herite (hex nu, sans sel)');
{
  const s = setUser(hashDefautAncien);
  const r = ctx.changePin({ newPin: '1234' }, session);
  check('accepte aussi sans currentPin', r.success === true, JSON.stringify(r));
  check('nouveau PIN stocke avec sel', String(s.data[1][2]).includes(':'));
  check('verification du nouveau PIN OK', ctx.verifierPin(s.data[1][2], '1234'));
}

console.log('\n3. Compte au PIN par defaut, frontend A JOUR (envoie currentPin:0000)');
{
  const s = setUser(hashDefautSale);
  const r = ctx.changePin({ currentPin: '0000', newPin: '9876' }, session);
  check('accepte', r.success === true, JSON.stringify(r));
  check('nouveau PIN stocke', ctx.verifierPin(s.data[1][2], '9876'));
}

console.log('\n4. Compte au PIN par defaut, currentPin FAUX fourni');
{
  const s = setUser(hashDefautSale);
  const r = ctx.changePin({ currentPin: '1111', newPin: '9876' }, session);
  check('refuse', r.success === false && /actuel incorrect/.test(r.error), JSON.stringify(r));
  check('PIN inchange', ctx.isDefaultPin(s.data[1][2]));
}

console.log('\n5. Compte avec PIN PERSONNEL : currentPin reste OBLIGATOIRE');
{
  const s = setUser(ctx.hacherPin('4821'));
  const r1 = ctx.changePin({ newPin: '1111' }, session);
  check('sans currentPin → refuse', r1.success === false && /actuel requis/.test(r1.error), JSON.stringify(r1));
  check('PIN inchange', ctx.verifierPin(s.data[1][2], '4821'));
  const r2 = ctx.changePin({ currentPin: '0000', newPin: '1111' }, session);
  check('avec un mauvais currentPin → refuse', r2.success === false && /actuel incorrect/.test(r2.error), JSON.stringify(r2));
  const r3 = ctx.changePin({ currentPin: '4821', newPin: '1111' }, session);
  check('avec le bon currentPin → accepte', r3.success === true, JSON.stringify(r3));
  check('nouveau PIN actif', ctx.verifierPin(s.data[1][2], '1111'));
}

console.log('\n6. Garde-fou : rejouer le meme PIN (piege de boucle infinie)');
{
  const s = setUser(hashDefautSale);
  const r = ctx.changePin({ currentPin: '0000', newPin: '0000' }, session);
  check('0000 → 0000 refuse', r.success === false && r.error.indexOf('doit être diff') >= 0, JSON.stringify(r));
  check('n\'aurait pas laisse mustChangePin a true silencieusement', ctx.isDefaultPin(s.data[1][2]));
}

console.log('\n7. Validation du format du nouveau PIN');
{
  setUser(hashDefautSale);
  check('3 chiffres refuse',  ctx.changePin({ newPin: '123' }, session).success === false);
  check('7 chiffres refuse',  ctx.changePin({ newPin: '1234567' }, session).success === false);
  check('lettres refusees',   ctx.changePin({ newPin: 'abcd' }, session).success === false);
  check('6 chiffres accepte', ctx.changePin({ newPin: '123456' }, session).success === true);
}

console.log('\n8. Non-regression login : hash par utilisateur');
{
  const a = ctx.hacherPin('4821'), b = ctx.hacherPin('4821');
  check('deux sels differents pour le meme PIN', a !== b);
  check('les deux se verifient', ctx.verifierPin(a, '4821') && ctx.verifierPin(b, '4821'));
  check('un PIN faux echoue', ctx.verifierPin(a, '4822') === false);
  check('hash vide refuse tout', ctx.verifierPin('', '0000') === false);
}

console.log('\n=== ' + ok + ' succes, ' + ko + ' echec(s) ===');
process.exit(ko ? 1 : 0);
