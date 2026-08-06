#!/usr/bin/env node
// ============================================================================
//  Envoie les instructions SQL produites par migrate-from-sheets.js vers Neon,
//  via le point d'entrée SQL-sur-HTTP (pas besoin de psql ni du module pg).
//
//  Usage : node db/charger.js <fichier.json> <chaine-de-connexion>
//  Le fichier contient un tableau JSON d'instructions, exécutées DANS L'ORDRE
//  (les interventions référencent les consistances et les utilisateurs).
// ============================================================================

const fs = require('fs');

const [, , fichier, conn] = process.argv;
if (!fichier || !conn) {
  console.error('Usage: node db/charger.js <fichier.json> <chaine-de-connexion>');
  process.exit(1);
}

const hote = conn.replace(/^.*@([^/]+)\/.*$/, '$1');
const instructions = JSON.parse(fs.readFileSync(fichier, 'utf8'));

async function executer(sql) {
  const t0 = Date.now();
  const rep = await fetch(`https://${hote}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': conn },
    body: JSON.stringify({ query: sql, params: [] })
  });
  const txt = await rep.text();
  const ms = Date.now() - t0;
  if (!rep.ok) {
    let detail = txt;
    try { const j = JSON.parse(txt); detail = j.message || j.error || txt; } catch (_) {}
    throw new Error(`HTTP ${rep.status} apres ${ms} ms — ${String(detail).slice(0, 300)}`);
  }
  return { ms, corps: txt };
}

(async () => {
  let ok = 0;
  for (let i = 0; i < instructions.length; i++) {
    const sql = instructions[i];
    const etiquette = (sql.match(/INSERT INTO (\w+)/) || [, sql.slice(0, 30)])[1];
    try {
      const r = await executer(sql);
      ok++;
      console.log(`  ${i + 1}/${instructions.length}  ${etiquette}  OK  (${r.ms} ms, ${sql.length} car.)`);
    } catch (e) {
      // On s'ARRÊTE au premier échec : continuer chargerait des interventions
      // dont les dépendances manquent, et masquerait la vraie cause.
      console.error(`  ${i + 1}/${instructions.length}  ${etiquette}  ECHEC`);
      console.error(`     ${e.message}`);
      console.error(`\n${ok} instruction(s) passees avant l'echec. Arret.`);
      process.exit(1);
    }
  }
  console.log(`\n${ok}/${instructions.length} instruction(s) executees.`);
})();
