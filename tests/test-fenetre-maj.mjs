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

function nouveauContexte(stockage, role = 'admin') {
  const el = (id) => {
    const classes = new Set(id === 'maj-plus-tard' ? ['hidden'] : []);
    const noeud = { id, textContent: '', title: '', style: {}, children: [],
      classList: { add: c => classes.add(c), remove: c => classes.delete(c),
        contains: c => classes.has(c), toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); } },
      appendChild(n) { this.children.push(n); }, _classes: classes };
    // innerHTML ecrit aussi textContent : le vrai DOM expose les deux, et le
    // code pose le titre en innerHTML a cause de l'icone.
    Object.defineProperty(noeud, 'innerHTML', {
      get() { return this.textContent; },
      set(v) { this.textContent = v; },
    });
    return noeud;
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
  const f = new Function('LANG','t','document','localStorage','location','role',
    code + '\nreturn {afficherQuoiDeNeufSiBesoin,afficherMajDispo,fermerQuoiDeNeuf,reporterMaj,'         + 'reproposerMajSiEnAttente,proposerMajTest:()=>{majEnAttente=true;afficherMajDispo();},notesDuRole,MAJ_ID,NOTES_MAJ};');
  const api = f(ctx.LANG, ctx.t, ctx.document, ctx.localStorage, ctx.location, role);
  // Les notes sont desormais memorisees PAR ROLE : le harnais vise la meme cle
  // que le code, sinon chaque assertion porterait sur une cle morte.
  return { api, noeuds, stockage, role, nbRecharges: () => recharge,
           cleVue: 'ceraf_maj_vue_' + role };
}
const ouverte = c => c.noeuds['modal-maj']._classes.has('active');

console.log('\n1. Appareil NEUF (rien en mémoire) — silence, drapeau posé');
{
  const c = nouveauContexte({});
  c.api.afficherQuoiDeNeufSiBesoin();
  v('aucune fenêtre', !ouverte(c));
  v('drapeau posé', c.stockage[c.cleVue] === c.api.MAJ_ID, c.stockage[c.cleVue]);
  v('aucun rechargement', c.nbRecharges() === 0);
}

console.log('\n2. Notes déjà lues — rien du tout');
{
  const c0 = nouveauContexte({}); const ID = c0.api.MAJ_ID;
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue_admin: ID });
  c.api.afficherQuoiDeNeufSiBesoin();
  v('aucune fenêtre', !ouverte(c));
}

console.log('\n3. Nouveautés à lire, AUCUNE mise à jour en attente');
{
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue_admin: 'ancien-id' });
  c.api.afficherQuoiDeNeufSiBesoin();
  v('fenêtre ouverte', ouverte(c));
  v('titre = quoi de neuf', c.noeuds['maj-titre'].textContent === 'maj.quoiDeNeuf', c.noeuds['maj-titre'].textContent);
  v('bouton = J’ai compris', c.noeuds['maj-btn'].textContent === 'maj.ok', c.noeuds['maj-btn'].textContent);
  v('« Plus tard » masqué', c.noeuds['maj-plus-tard']._classes.has('hidden'));
  c.api.fermerQuoiDeNeuf();
  v('fenêtre fermée', !ouverte(c));
  v('notes marquées lues', c.stockage[c.cleVue] === c.api.MAJ_ID);
  v('PAS de rechargement inutile', c.nbRecharges() === 0, c.nbRecharges());
}

console.log('\n4. Nouveautés à lire ET mise à jour qui arrive pendant la lecture');
{
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue_admin: 'ancien-id' });
  c.api.afficherQuoiDeNeufSiBesoin();
  const titreAvant = c.noeuds['maj-titre'].textContent;
  c.api.proposerMajTest();                       // le service worker s'installe
  v('pas de 2e fenêtre : titre inchangé', c.noeuds['maj-titre'].textContent === titreAvant, c.noeuds['maj-titre'].textContent);
  v('bouton devient Recharger', c.noeuds['maj-btn'].textContent === 'maj.recharger', c.noeuds['maj-btn'].textContent);
  v('« Plus tard » apparaît', !c.noeuds['maj-plus-tard']._classes.has('hidden'));
  c.api.fermerQuoiDeNeuf();
  v('notes marquées lues', c.stockage[c.cleVue] === c.api.MAJ_ID);
  v('la mise à jour est APPLIQUÉE', c.nbRecharges() === 1, c.nbRecharges());
}

console.log('\n5. App ouverte depuis longtemps, mise à jour publiée (aucune note à lire)');
{
  const c0 = nouveauContexte({}); const ID = c0.api.MAJ_ID;
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue_admin: ID });
  c.api.proposerMajTest();
  v('fenêtre ouverte', ouverte(c));
  v('titre = mise à jour disponible', c.noeuds['maj-titre'].textContent === 'maj.titreDispo', c.noeuds['maj-titre'].textContent);
  v('corps = message générique', c.noeuds['maj-corps'].textContent === 'maj.dispo', c.noeuds['maj-corps'].textContent);
  v('bouton = Recharger', c.noeuds['maj-btn'].textContent === 'maj.recharger');
  v('« Plus tard » proposé', !c.noeuds['maj-plus-tard']._classes.has('hidden'));
  c.api.fermerQuoiDeNeuf();
  v('mise à jour appliquée', c.nbRecharges() === 1);
  v('drapeau des notes NON écrasé', c.stockage[c.cleVue] === ID, c.stockage[c.cleVue]);
}

console.log('\n6. « Plus tard » : ne recharge pas, ne marque rien');
{
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue_admin: 'ancien-id' });
  c.api.proposerMajTest();
  c.api.reporterMaj();
  v('fenêtre fermée', !ouverte(c));
  v('aucun rechargement', c.nbRecharges() === 0);
  v('drapeau inchangé', c.stockage[c.cleVue] === 'ancien-id');
}

console.log('\n7. « Plus tard » puis REOUVERTURE de l’app — la fenêtre revient');
{
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue_admin: 'ancien-id' });
  c.api.proposerMajTest();
  c.api.reporterMaj();
  v('fenêtre bien fermée', !ouverte(c));
  // Retour au premier plan
  v('elle se represente', c.api.reproposerMajSiEnAttente() === true);
  v('fenêtre rouverte', ouverte(c));
  v('toujours le bon titre', c.noeuds['maj-titre'].textContent === 'maj.titreDispo');
  v('bouton = Recharger', c.noeuds['maj-btn'].textContent === 'maj.recharger');
  // Repoussable autant de fois qu'on veut
  c.api.reporterMaj();
  v('2e report accepté', !ouverte(c) && c.nbRecharges() === 0);
  v('et elle revient encore', c.api.reproposerMajSiEnAttente() === true && ouverte(c));
  c.api.fermerQuoiDeNeuf();
  v('installée quand on accepte enfin', c.nbRecharges() === 1);
}

console.log('\n8. Aucune mise à jour en attente — aucune fenêtre à l’ouverture');
{
  const c0 = nouveauContexte({}); const ID = c0.api.MAJ_ID;
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue_admin: ID });
  v('rien à reproposer', c.api.reproposerMajSiEnAttente() === false);
  v('aucune fenêtre', !ouverte(c));
  v('aucun rechargement', c.nbRecharges() === 0);
}

console.log('9. Ciblage par role — chacun ne lit que ce qui le concerne');
{
  const admin = nouveauContexte({ ceraf_url: 'x' }, 'admin');
  const tech  = nouveauContexte({ ceraf_url: 'x' }, 'technicien');
  const nAdmin = admin.api.notesDuRole().length, nTech = tech.api.notesDuRole().length;
  v('l’admin a des notes', nAdmin > 0, nAdmin);
  v('le technicien en a moins que l’admin', nTech < nAdmin, nTech + ' vs ' + nAdmin);
  v('le technicien ne recoit que des notes qui le visent',
    admin.api.NOTES_MAJ.filter(n => n.pour.includes('technicien') || n.pour.includes('tous')).length === nTech, nTech);
  v('chaque note declare un public',
    admin.api.NOTES_MAJ.every(n => Array.isArray(n.pour) && n.pour.length));
  v('FR et EN au complet et distincts',
    admin.api.NOTES_MAJ.every(n => n.fr && n.en && n.fr !== n.en));
  v('aucun role inconnu',
    admin.api.NOTES_MAJ.every(n => n.pour.every(x => ['tous','admin','chef','technicien'].includes(x))));
}

console.log('10. Role inconnu — il ne recoit QUE les notes marquees tous');
{
  const c = nouveauContexte({ ceraf_url: 'x' }, 'role-inattendu');
  const notes = c.api.notesDuRole();
  const tous = c.api.NOTES_MAJ.filter(n => n.pour.includes('tous'));
  v('aucune note reservee a un autre role ne fuit', notes.length === tous.length, notes.length);
  // Le cas « aucune note du tout » n'est pas atteignable tant qu'une note vise
  // « tous » : c'est justement pour ce cas-la que afficherQuoiDeNeufSiBesoin
  // pose le drapeau en silence, sans quoi la fenetre reviendrait vide a chaque
  // lancement. A reactiver le jour ou une version ne concerne qu'un seul role.
}

console.log('11. Deux roles sur le meme appareil — lus separement');
{
  const stockage = { ceraf_url: 'x' };
  const admin = nouveauContexte(stockage, 'admin');
  admin.api.afficherQuoiDeNeufSiBesoin();
  v('fenetre ouverte pour l’admin', ouverte(admin));
  admin.api.fermerQuoiDeNeuf();
  v('drapeau admin pose', stockage['ceraf_maj_vue_admin'] === admin.api.MAJ_ID);
  v('drapeau technicien PAS pose', stockage['ceraf_maj_vue_technicien'] === undefined);
  const tech = nouveauContexte(stockage, 'technicien');
  tech.api.afficherQuoiDeNeufSiBesoin();
  v('le technicien a ses propres notes a lire', ouverte(tech));
}

console.log('12. Sans role actif — on ne montre rien et on ne marque rien');
{
  const c = nouveauContexte({ ceraf_url: 'x' }, '');
  c.api.afficherQuoiDeNeufSiBesoin();
  v('aucune fenetre', !ouverte(c));
  v('aucun drapeau pose',
    Object.keys(c.stockage).filter(k => k.startsWith('ceraf_maj_vue')).length === 0,
    JSON.stringify(c.stockage));
}

console.log('13. Ancienne cle sans role — respectee, pas de fenetre en double');
{
  const c0 = nouveauContexte({}); const ID = c0.api.MAJ_ID;
  const c = nouveauContexte({ ceraf_url: 'x', ceraf_maj_vue: ID }, 'admin');
  c.api.afficherQuoiDeNeufSiBesoin();
  v('deja lu avant le ciblage : rien ne se rouvre', !ouverte(c));
}
console.log(`\n${ok} OK / ${ko} ECHEC`);
process.exit(ko ? 1 : 0);
