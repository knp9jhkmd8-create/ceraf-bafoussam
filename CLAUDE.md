# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CERAF Bafoussam — a PWA for managing field interventions (FTTH/LS/Cuivre) for a telecom crew. Two independently deployed halves that share no build tooling:

- **Frontend**: [index.html](index.html) — a single-file vanilla JS SPA (~1600 lines of inline `<script>`), hosted on GitHub Pages. No framework, no bundler, no npm dependencies for the frontend itself. [manifest.json](manifest.json) + [sw.js](sw.js) make it an installable offline-first PWA.
- **Backend**: [Code.gs](Code.gs) — a Google Apps Script project bound to a Google Sheet (ID in `SHEET_ID` constant), exposed as a web app via `doGet`/`doPost` returning JSON. This is the only "API" — there is no separate server.

The frontend talks to the backend over a user-configured Apps Script web app URL (entered once in the app's setup screen, stored in `localStorage['ceraf_url']`) — it is **not** hardcoded in the source.

## Deploying the backend (Code.gs)

The backend is managed with `clasp` (Google's official Apps Script CLI), already configured in this repo:

- `.clasp.json` links this directory to the Apps Script project (scriptId, not the Sheet ID).
- `.claspignore` restricts what clasp will sync to **only** `Code.gs` and `appsscript.json` — the frontend files (`index.html`, `sw.js`, `manifest.json`, icons) must never be pushed to Apps Script. `sw.js` in particular would be pushed as a `.js` file and Apps Script would try to interpret it as server-side script, which breaks the project (it contains `self.addEventListener` service-worker code, invalid as Apps Script).

Typical workflow after editing `Code.gs`:

```bash
clasp push --force                      # sync Code.gs to the Apps Script project
clasp version "description of change"   # snapshot a version
clasp deploy -i <deploymentId> -V <versionNumber> -d "description"   # publish to the LIVE deployment
```

Always deploy with `-i <deploymentId>` targeting the **existing production deployment** (find it via `clasp deployments` — it's the one whose URL matches what's configured in the app's setup screen / what both "chef" and "technicien" roles use). Deploying without `-i` creates a brand-new deployment with a different URL, which would silently break the app for all users since they'd still be pointing at the old URL. There is no staging environment — the live deployment IS production.

Before pushing, sanity-check syntax since Apps Script errors only surface at runtime in the Sheet, not at push time:
```bash
cp Code.gs /tmp/Code_check.js && node --check /tmp/Code_check.js
```
(copy to `.js` extension first — `node --check` refuses `.gs`.)

There is no automated test suite. Verification is done by curling the deployed web app directly, e.g.:
```bash
curl -sL "https://script.google.com/macros/s/<deploymentId>/exec?action=getAll&role=chef&month=2026-07"
```
`doGet`/`doPost` redirect (302) before returning JSON — use `-L` to follow.

## Data model (Google Sheet, 3 tabs)

Column order is **not** trustworthy — read every sheet through the dynamic header-index helpers (`getColMap`, `getClientsIdx`, `getInvIdx`, `getConsistIdx` in Code.gs) rather than hardcoded column numbers. The schema has been migrated multiple times in place (columns added/removed/reordered — see the many one-off `reparer*`/`migrer*` functions at the bottom of Code.gs), so header-name lookup is the only safe way to access a column.

- **Consistances**: one row per day (`ID_Consistance`, `Date`, `Chef`, `Nb_Interventions`, `Realisees`, `Instances`). A "fiche du jour".
- **Interventions**: one row per intervention, linked to a Consistance by `ID_Consistance`. Type (FTTH/LS/Cuivre), `Statut` (`En attente` / `Réalisé` / `Injoignable` / `Problème`), `Reporté_depuis` (origin date of first occurrence, carried through report chains), `Duree_Jours` (legacy incremental counter — **no longer the source of truth for duration**, see below).
- **Clients**: deduplicated by line number (`Numero`). Holds `GPS`, `Service`, `Tel_Secondaire`, etc. GPS coordinates live here, not on the intervention row — `getByDate`/`getAll` always return `gps: ''` for interventions; the frontend merges in `clientsCache[num].gps` client-side ([index.html:1497](index.html:1497)).

## Key backend behaviors (Code.gs)

- **Role enforcement is server-side**, not just UI: `doGet`/`doPost` check `role` against action name (`getAll`/`getClients` chef-only for GET; `deleteClient`/`deleteIntervention`/`saveClient` chef-only for POST). Don't assume the frontend hiding a button is sufficient access control.
- **Automatic daily carry-forward**: `reporterInterventionsEnAttente` runs on a time trigger (1am) and moves any intervention still `En attente`/`Injoignable`/`Problème` to the next business day's Consistance, incrementing `Duree_Jours` and preserving `Reporté_depuis` (the true origin date). Interventions marked `Réalisé` are excluded and thus frozen.
- **Duration (`duree`) is computed on read, not trusted from storage**: `calculerDuree(reporteDepuis, dateLigne, statut)` computes `joursOuvres(origine, fin) - 1` at request time (`fin` = today if still open, or the row's own date if `Réalisé`). This was changed from an incrementally-stored counter because that counter silently diverges from reality whenever the nightly trigger doesn't run reliably (e.g. an old Apps Script deployment stuck live for weeks). Prefer computing derived values like this from source dates over trusting an incrementally-maintained counter.
- **`normDate()` is not just a formatter — it's a data-corruption shim.** Historical bugs wrote `Date.toString()` (e.g. `"Mon Jun 22 2026 00:00:00 GMT+0100 (West Africa Time)"`) into cells as literal text instead of an ISO date. `normDate()` handles native `Date` objects, clean `YYYY-MM-DD` strings, *and* falls back to `new Date(s)` parsing for that legacy corrupted format. Any new code reading a date-ish cell should go through `normDate()`, never a bare `String(cell)`.
- **Monthly history dedup** (`getAll`): the same logical intervention can appear as multiple rows across a month (once per day it was carried forward). Dedup key is `nom|num|type`; the surviving row is chosen by most-advanced status (`statutPoids`: Réalisé > Problème > Injoignable > En attente), tie-broken by latest date. The earliest `Reporté_depuis` across all duplicates is preserved as `datePremiere` so duration calculation still reflects the true origin even though only one row survives.
- **Client deletion cascades**: deleting a client also deletes all its interventions across every Consistance and recalculates affected `Nb_Interventions` counts.

## Frontend structure (index.html)

Single file, no build step — edit directly and reload. Rough map by function, not file (there's only one file):

- Role gate (`chef` vs `technicien`) stored in `localStorage['ceraf_role']`, chosen once at startup (`chooseRole`/`startApp`).
- Consistance entry form: per-service-type field sets (`etype_ftth`, `install_ftth`, `derang_ftth`, `derang_cuivre`, `etude_ls`, `derang_ls`, `install_ls` — see `gf()`/`cf()`), each with its own field IDs (`f1c`, `f2u`, etc.) — there's no shared form model, each type is hand-wired.
- Client autofill + duplicate detection: typing a line number (`onNumInput`) looks up `clientsCache` (built from `getClients()`, cached in-memory) and cross-checks `getActiveInterventions()` to warn about in-progress duplicates before publish.
- Quartier (neighborhood) suggestion uses a local Levenshtein implementation (`levenshtein`, `suggererQuartiers`) against known quartiers rather than a fixed dropdown, since quartier spelling in the field is inconsistent.
- "Terrain" view (`loadTerrain`/`renderTerrain`) is the day's live worksheet — filterable by quartier/status/type, GPS capture per intervention (`getGPSField`, `saveGPS` — writes back to the Clients sheet), status updates.
- "Historique" view consumes `getAll` (monthly, deduped) rather than `getByDate` (single day, raw).

## When making a change

- If you touch anything date-related in `Code.gs`, run it through `normDate()`/`joursOuvres()` rather than assuming sheet cells are clean — this codebase has a documented history of date-as-text corruption.
- Prefer fixing root causes over one-off repair scripts. The bottom third of `Code.gs` is a graveyard of `reparer*`/`corriger*`/`migrer*` functions written to patch specific past data corruption incidents — they're useful as forensic evidence of what already went wrong, not a pattern to keep extending.
- After any `Code.gs` change intended for production, push, version, deploy to the existing deployment ID, and verify against the **live** URL with `curl` before declaring it done — there's no staging/CI to catch regressions otherwise.
