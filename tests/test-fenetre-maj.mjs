// Rejoue les 4 situations de la fenêtre de mise à jour sur le VRAI code
// extrait d'index.html (pas une copie), avec un DOM minimal.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const debut = src.indexOf('const MAJ_ID=');
const fin   = src.indexOf('//  PWA — SERVICE WORKER');
if (debut < 0 || fin < 0) { console.error('bornes introuvables'); process.exit(1); }
const code = src.slice(debut, fin);

let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log('  OK    ' + nom); }
  else { ko++; console.log('  ECHEC ' + nom + (detail !== undefined ? '  -> ' + detail : '')); } };

function nouveauContexte(stockage) {
  const el = (id) => {
    const classes = new Set(id === 'maj-plus-tard' ? ['hidden'] : []);
    return { id, textContent: '', title: '', style: {}, children: [],
      classList: { add: c => classes.add(c), remove: c => classes.delete(c),
        contains: c => classes.has(c), toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); } },
      appendChild(n) { this.children.push(n); }, _classes: classes };
  };
  const noeuds = {}; ['maj-corps','modal-maj','maj-titre','maj-btn','maj-plus-tard']
    .forEach(id => noeuds[id] = el(id));
  let recharge = 0;
  const ctx = {
    LANG: 'fr',
    t: k => k,                                   // on assert sur les CLÉS, pas la traduction
    document: { getElementById: id => noeuds[id] || null,
                createElement: t => el('<' + t + '>') },
    localStorage: { getItem: k => (k in stockage ? stockage[k] : null),
                    setItem: (k, val) => { stockage[k] = val; } },
    location: { reload: () => { recharge++; } },
  };
  ctx.globalThis = ctx;
  const f = new Function('LANG','t','document','localStorage','location',
    code + '\nreturn {afficherQuoiDeNeufSiBesoin,afficherMajDispo,fermerQuoiDeNeuf,reporterMaj,proposerMajTest:()=>{majEnAttente=true;afficherMajDispo();},MAJ_ID};');
  const api = f(ctx.LANG, ctx.t, ctx.document, ctx.localStorage, ctx.location);
  return { api, noeuds, stockage, nbRecharges: () => recharge };
}
const ouverte = c => c.noeuds['modal-maj']._classes.has('active');

console.log('\n1. Appareil NEUF (rien en mémoire) — silence, drapeau posé');
{
  const c = nouveauContexte({});
  c.api.afficherQuoiDeNeufSiBesoin();
  v('aucune fenêtre', !ouverte(c));
  v('drapeau posé', c.stockage['ceraf_maj_vue'] === c.api.MAJ_ID, c.stockage['ceraf_maj_vue']);
  v('aucun rechargement', c.nbRecharges() === 0);
}

console.log('\n2. Notes déjà lues — rien du tout');
{
  const c0 = nouveauContexte({}); const ID = c0.api.MAJ_ID;
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue: ID });
  c.api.afficherQuoiDeNeufSiBesoin();
  v('aucune fenêtre', !ouverte(c));
}

console.log('\n3. Nouveautés à lire, AUCUNE mise à jour en attente');
{
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue: 'ancien-id' });
  c.api.afficherQuoiDeNeufSiBesoin();
  v('fenêtre ouverte', ouverte(c));
  v('titre = quoi de neuf', c.noeuds['maj-titre'].textContent === 'maj.quoiDeNeuf', c.noeuds['maj-titre'].textContent);
  v('bouton = J’ai compris', c.noeuds['maj-btn'].textContent === 'maj.ok', c.noeuds['maj-btn'].textContent);
  v('« Plus tard » masqué', c.noeuds['maj-plus-tard']._classes.has('hidden'));
  c.api.fermerQuoiDeNeuf();
  v('fenêtre fermée', !ouverte(c));
  v('notes marquées lues', c.stockage['ceraf_maj_vue'] === c.api.MAJ_ID);
  v('PAS de rechargement inutile', c.nbRecharges() === 0, c.nbRecharges());
}

console.log('\n4. Nouveautés à lire ET mise à jour qui arrive pendant la lecture');
{
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue: 'ancien-id' });
  c.api.afficherQuoiDeNeufSiBesoin();
  const titreAvant = c.noeuds['maj-titre'].textContent;
  c.api.proposerMajTest();                       // le service worker s'installe
  v('pas de 2e fenêtre : titre inchangé', c.noeuds['maj-titre'].textContent === titreAvant, c.noeuds['maj-titre'].textContent);
  v('bouton devient Recharger', c.noeuds['maj-btn'].textContent === 'maj.recharger', c.noeuds['maj-btn'].textContent);
  v('« Plus tard » apparaît', !c.noeuds['maj-plus-tard']._classes.has('hidden'));
  c.api.fermerQuoiDeNeuf();
  v('notes marquées lues', c.stockage['ceraf_maj_vue'] === c.api.MAJ_ID);
  v('la mise à jour est APPLIQUÉE', c.nbRecharges() === 1, c.nbRecharges());
}

console.log('\n5. App ouverte depuis longtemps, mise à jour publiée (aucune note à lire)');
{
  const c0 = nouveauContexte({}); const ID = c0.api.MAJ_ID;
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue: ID });
  c.api.proposerMajTest();
  v('fenêtre ouverte', ouverte(c));
  v('titre = mise à jour disponible', c.noeuds['maj-titre'].textContent === 'maj.titreDispo', c.noeuds['maj-titre'].textContent);
  v('corps = message générique', c.noeuds['maj-corps'].textContent === 'maj.dispo', c.noeuds['maj-corps'].textContent);
  v('bouton = Recharger', c.noeuds['maj-btn'].textContent === 'maj.recharger');
  v('« Plus tard » proposé', !c.noeuds['maj-plus-tard']._classes.has('hidden'));
  c.api.fermerQuoiDeNeuf();
  v('mise à jour appliquée', c.nbRecharges() === 1);
  v('drapeau des notes NON écrasé', c.stockage['ceraf_maj_vue'] === ID, c.stockage['ceraf_maj_vue']);
}

console.log('\n6. « Plus tard » : ne recharge pas, ne marque rien');
{
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue: 'ancien-id' });
  c.api.proposerMajTest();
  c.api.reporterMaj();
  v('fenêtre fermée', !ouverte(c));
  v('aucun rechargement', c.nbRecharges() === 0);
  v('drapeau inchangé', c.stockage['ceraf_maj_vue'] === 'ancien-id');
}

console.log(`\n${ok} OK / ${ko} ECHEC`);
process.exit(ko ? 1 : 0);
