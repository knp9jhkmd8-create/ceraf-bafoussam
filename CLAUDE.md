# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CERAF Bafoussam — a PWA for managing field interventions (FTTH/LS/Cuivre) for a telecom crew. Two independently deployed halves that share no build tooling:

- **Frontend**: [index.html](index.html) — a single-file vanilla JS SPA (inline `<script>`), hosted on GitHub Pages. No framework, no bundler, no npm dependencies for the frontend itself. [manifest.json](manifest.json) + [sw.js](sw.js) make it an installable offline-first PWA.
- **Backend**: [api/core.mjs](api/core.mjs) — the entire API logic, hosting-agnostic (Web APIs only: `fetch`, `crypto.subtle`, `crypto.randomUUID` — no Node-specific code). Deployed as a Cloudflare Worker via the adapter in [cloudflare/src/worker.mjs](cloudflare/src/worker.mjs); a Netlify adapter also exists under `netlify/functions/` but is not the live path (see [[netlify-api]] memory — abandoned after a build-credits outage). Data lives in Neon (managed Postgres, London region). See [cloudflare/README.md](cloudflare/README.md) for the deploy procedure.

  **This used to be a Google Apps Script project bound to a Google Sheet (`Code.gs`).** That backend was fully retired 2026-08-06 (migrated to Neon) and the file was deleted from this repo 2026-08-15 — if you see stale references to `Code.gs`, `clasp`, or `script.google.com` anywhere (docs, comments, old memory entries), they describe history, not the live system.

The frontend talks to the backend over a configurable API URL, defaulting to the Cloudflare Worker (`API_URL` constant in `index.html`) and stored in `localStorage['ceraf_url']` once set. `migrerUrlBackend()` auto-upgrades any device still pointing at an old `script.google.com` URL — no user action needed, no backend redeploy required for that migration path.

## Deploying the backend

```bash
cd cloudflare
wrangler deploy
```

Full procedure, including the Neon connection string secret and post-deploy verification order, is in [cloudflare/README.md](cloudflare/README.md) — follow it, don't improvise a shortcut. There is no staging environment; the deployed Worker IS production.

There is no automated test suite for routine changes, but `tests/test-api-live.mjs` exists for live verification against a real URL (creates and tears down its own throwaway test account — never a permanent one, see the feedback memory on that incident).

## Data model (Neon Postgres — 8 tables, 2 views)

Tables: `utilisateurs`, `consistances`, `interventions`, `clients`, `clients_ls`, `clients_resilies`, `sessions`, `audit_log`. Views: `v_consistances`, `v_interventions`. Exact columns and query shapes live in [api/core.mjs](api/core.mjs) (`sql()` calls) — read that file rather than assuming, the behaviors below describe intent, not a schema dump.

- **Consistances**: one row per day. A "fiche du jour".
- **Interventions**: one row per intervention, linked to a Consistance. Type (FTTH/LS/Cuivre), `statut` (`En attente` / `Réalisé` / `Injoignable` / `Problème`), origin date carried through report chains for duration calculation.
- **Clients FTTH/Cuivre** live in the single `clients` table (service is implicit from which sheet-equivalent flow wrote it, carried over from the pre-Neon split — see `typeToService`-equivalent logic in `core.mjs`). Deduplicated by line number; GPS lives here, not on the intervention row.
- **Clients LS** (`clients_ls`): LS interventions have no line number (name is the only mandatory field), so LS clients are keyed by normalized name.
- **Clients Résiliés** (`clients_resilies`): terminated clients, archived separately from active ones.

## Key backend behaviors (api/core.mjs)

- **Role enforcement is server-side**, not just UI: `traiterRequete` checks `role` against the requested action (`getAll`/`getClients` chef-only for GET; `deleteClient`/`deleteIntervention`/`saveClient` chef-only for POST). Don't assume the frontend hiding a button is sufficient access control.
- **Automatic daily carry-forward**: `reporterNocturne` (run on a Cloudflare Cron Trigger) moves any intervention still `En attente`/`Injoignable`/`Problème` to the next business day's Consistance, preserving the true origin date. Interventions marked `Réalisé` are excluded and thus frozen.
- **Duration is computed on read, not trusted from storage** — same principle as the old Apps Script backend (computed from origin date vs. today/completion date at request time), so it can't silently diverge if a nightly job misses a run.
- **Monthly history dedup** (`getAll`): the same logical intervention can appear as multiple rows across a month (once per day it was carried forward). Dedup keeps the most-advanced status, tie-broken by latest date, while preserving the earliest origin date for duration purposes.
- **Client deletion cascades**: deleting a client also deletes all its interventions and recalculates affected counts.

## Frontend structure (index.html)

Single file, no build step — edit directly and reload. Rough map by function, not file (there's only one file):

- Role gate (`chef` vs `technicien`) stored in `localStorage['ceraf_role']`, chosen once at startup (`chooseRole`/`startApp`).
- Consistance entry form: per-service-type field sets (`etype_ftth`, `install_ftth`, `derang_ftth`, `derang_cuivre`, `etude_ls`, `derang_ls`, `install_ls` — see `gf()`/`cf()`), each with its own field IDs (`f1c`, `f2u`, etc.) — there's no shared form model, each type is hand-wired.
- Client autofill + duplicate detection: typing a line number (`onNumInput`) looks up `clientsCache` (built from `getClients()`, cached in-memory) and cross-checks `getActiveInterventions()` to warn about in-progress duplicates before publish.
- Quartier (neighborhood) suggestion uses a local Levenshtein implementation (`levenshtein`, `suggererQuartiers`) against known quartiers rather than a fixed dropdown, since quartier spelling in the field is inconsistent.
- "Terrain" view (`loadTerrain`/`renderTerrain`) is the day's live worksheet — filterable by quartier/status/type, GPS capture per intervention (`getGPSField`, `saveGPS` — writes back to the Clients sheet), status updates.
- "Historique" view consumes `getAll` (monthly, deduped) rather than `getByDate` (single day, raw).

## When making a change

- Prefer fixing root causes over one-off repair scripts — the pre-Neon Apps Script backend had a graveyard of `reparer*`/`corriger*`/`migrer*` functions written to patch past data corruption; don't restart that pattern in `api/core.mjs`.
- After any `api/core.mjs` or `cloudflare/src/worker.mjs` change intended for production, deploy per [cloudflare/README.md](cloudflare/README.md) and verify against the **live** URL before declaring it done — there's no staging/CI to catch regressions otherwise.

# Instructions de Design Visuel (Style Apple HIG)

Pour tout le code UI, CSS, JSX ou Tailwind que tu génères, applique strictement la charte visuelle d'Apple (Human Interface Guidelines) pour éviter le style "IA générique" :

## 1. Typographie
- Polices : Utilise le System Font Stack d'Apple (`-apple-system`, `BlinkMacSystemFont`, `SF Pro Display`, `SF Pro Text`, `sans-serif`).
- Style : Applique un letter-spacing légèrement resserré (`tracking-tight`) sur les grands titres et des contrastes de taille très marqués.

## 2. Cartes & Surfaces
- Bordures : Ultra-subtiles (`1px` avec opacité très faible : `border-black/5` en mode clair ou `border-white/10` en mode sombre).
- Radii : Bords généreusement arrondis (`rounded-2xl` à `rounded-3xl` pour les cartes, `rounded-xl` pour les boutons).
- Glassmorphism : Effet de flou sur les barres et modales (`backdrop-blur-md` avec fond semi-transparent).

## 3. Couleurs & Ombres
- Fond global : `#F5F5F7` (clair) ou `#000000` / `#1C1C1E` (sombre).
- Ombres : Ombres diffusées et très douces (`shadow-sm` ou ombres sur-mesure très légères).
- Accents : Utilise le bleu Apple (`#007AFF`) ou violet/vert uniquement pour les CTA principaux.

## 4. Spacing & Micro-interactions
- Donne beaucoup de padding et d'espace respirant.
- Ajoute des transitions fluides au survol (`transition-all duration-200 hover:scale-[1.01]`).

# Directives UI/UX : Design System & Animations Style Apple

Lorsque tu rédiges ou modifies des interfaces utilisateur (HTML, CSS, composants React/Vue/Svelte), applique rigoureusement les principes de design et d'animations d'Apple (iOS & macOS).

---

## 1. Philosophie & Règle d'Or (Le Principe Cardinal)
- **La Règle d'Or :** Les animations Apple doivent être **discrètes, physiques et réactives**. Une animation ne doit jamais faire attendre l'utilisateur ni ralentir son travail ; elle sert uniquement à rendre la navigation fluide, naturelle et agréable. Si une animation perturbe la vitesse d'exécution de l'application, simplifie-la.

---

## 2. Physique des Mouvements (Spring Physics)
- **Pas de mouvements linéaires :** Interdiction d'utiliser des transitions rigides ou basiques (`linear`, `ease`).
- **Courbes fluides :** Utilise des courbes d'amortissement douces (effet ressort/physique) pour donner une impression de légèreté.
- **Micro-durées :** Les animations doivent être ultra-rapides (entre 0.2s et 0.35s maximum).

---

## 3. Feedback Tactile & Micro-interactions
- **Enfoncement physique :** Au clic ou au toucher (`:active`), les boutons, cartes et éléments cliquables doivent légèrement se réduire (scale) pour donner un retour physique instantané à l'utilisateur.
- **Survol élégant :** Sur ordinateur, les survols (`:hover`) doivent être très subtils (légère élévation et ombrage ultra-doux).

---

## 4. Matériaux & Profondeur (Glassmorphism)
- **Effet Verre Trempé :** Utilise le flou d'arrière-plan (Backdrop Blur) et la translucidité pour les barres de navigation, les fenêtres modales et les panneaux d'action.
- **Bordures ultra-fines :** Sépare les cartes et conteneurs avec des bordures très discrètes plutôt que des traits sombres épais.
- **Mode Sombre Négatif :** Adapte automatiquement les fonds et le flou pour le mode sombre natif.

---

## 5. Entrées Séquentielles (Staggered Animations)
- Lors du chargement d'une page ou d'une liste, fais apparaître les éléments progressivement du bas vers le haut avec un très léger décalage entre chaque élément.

## ❌ Interdiction des Émojis & Remplacement par Icônes SVG

1. **ZÉRO ÉMOJI DANS L'APPLICATION ET L'API :**
   - Interdiction stricte d'inclure des émojis (ex: 🚀, 📊, ⚠️, 📌, ✅, 💡) dans les textes, titres, notifications, boutons ou réponses d'API.
   - Les émojis donnent un aspect "généré par IA", manquent de sobriété et cassent l'esthétique professionnelle.

2. **UTILISATION EXCLUSIVE D'ICÔNES SVG VECTORIELLES :**
   - Si un élément visuel ou une icône est nécessaire, utilise **exclusivement un SVG inline** propre, vectoriel et stylisé.
   - Design de l'icône : Lignes fines (*stroke-width: 1.5px* ou *2px*), style épuré, angles arrondis (*stroke-linecap="round"* *stroke-linejoin="round"*), parfaitement aligné avec la typographie.
   - Les SVG doivent pouvoir hériter de la couleur du texte parent (`stroke="currentColor"` ou `fill="currentColor"`).