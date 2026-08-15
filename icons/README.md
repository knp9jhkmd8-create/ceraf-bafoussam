# icons/ — sources du jeu d'icônes métier

Ces 10 SVG sont les **sources versionnées** des icônes de types d'intervention
et de rôles. Ils ne sont **pas chargés à l'exécution**.

## Pourquoi ils ne sont pas chargés directement

L'app est un fichier unique (`index.html`) servi hors ligne par un service
worker qui ne met en cache que `index.html` et `manifest.json`. Dix
`<img src="icons/…">` seraient dix requêtes HTTP de plus, absentes de ce cache
(donc cassées hors ligne), et un `<img>` ne peut pas hériter de `currentColor` —
les icônes ne suivraient plus la couleur du texte parent.

Elles sont donc **inlinées dans l'objet `ICO`** d'`index.html`, comme tout le
reste du jeu d'icônes.

## Modifier une icône

1. Éditer le `.svg` ici (garder `viewBox="0 0 24 24"`, `stroke="currentColor"`,
   `stroke-width="1.5"`, pas de `fill`).
2. Reporter le contenu (les balises **à l'intérieur** du `<svg>`) dans la clé
   correspondante de `ICO`, dans `index.html`.

Éditer le `.svg` seul ne change rien à l'écran.

## Correspondance fichier → clé `ICO`

| Fichier | Clé `ICO` | Utilisé par |
|---|---|---|
| `etude-ftth.svg` | `etudeFtth` | `TI.etude_ftth` |
| `installation-ftth.svg` | `installFtth` | `TI.install_ftth` |
| `derangement-ftth.svg` | `derangFtth` | `TI.derang_ftth` |
| `derangement-cuivre.svg` | `derangCuivre` | `TI.derang_cuivre` |
| `etude-ls.svg` | `etudeLs` | `TI.etude_ls` |
| `installation-ls.svg` | `installLs` | `TI.install_ls` |
| `derangement-ls.svg` | `derangLs` | `TI.derang_ls` |
| `resiliation.svg` | `resiliation` | `TI.resiliation_ftth` / `_cuivre` / `_ls` |
| `chef-equipe-reseau.svg` | `roleChef` | `ROLE_META.chef` |
| `technicien-ftth.svg` | `roleTechnicien` | `ROLE_META.technicien` |

`ROLE_META.admin` utilise `ICO.roleAdmin` (clé/trousseau) : aucune icône n'a été
fournie pour ce rôle. Elle est dessinée au même `stroke-width` 1.5 que les deux
autres pour que les trois cartes de rôle aient le même poids de trait.

Ces icônes sont tracées à **1.5** ; le reste du jeu `ICO` (navigation, boutons,
statuts) est à **1.8**. C'est voulu : ce sont deux familles distinctes qui ne se
côtoient jamais dans un même bloc.
