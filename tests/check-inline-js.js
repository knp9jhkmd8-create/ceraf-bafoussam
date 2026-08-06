// Extrait chaque bloc <script> inline d'index.html et le passe au parseur JS.
// index.html n'a pas de build : une erreur de syntaxe ne se voit qu'à
// l'exécution, sur le téléphone du terrain. Ce contrôle la remonte avant.
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');

const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, n = 0, erreurs = 0;
while ((m = re.exec(html)) !== null) {
  const attrs = m[1] || '';
  const code = m[2];
  if (/\bsrc\s*=/.test(attrs)) continue;          // script externe, rien à parser
  if (/type\s*=\s*["'](?!text\/javascript|module)/.test(attrs)) continue;
  n++;
  // Ligne de départ dans le fichier, pour situer une erreur éventuelle.
  const ligne = html.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(code, { filename: file + ' (bloc ' + n + ' @ ligne ' + ligne + ')' });
    console.log('  OK    bloc ' + n + ' (ligne ' + ligne + ', ' + code.split('\n').length + ' lignes)');
  } catch (e) {
    erreurs++;
    console.log('  ERREUR bloc ' + n + ' (ligne ' + ligne + ') : ' + e.message);
  }
}
console.log(n + ' bloc(s) inline analyse(s), ' + erreurs + ' erreur(s) de syntaxe');
process.exit(erreurs ? 1 : 0);
