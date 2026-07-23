# Backlog — nomad-lens

Sorgente unica dei todo. Id stabili `NOM-n`; spuntare, non cancellare. Ogni `##` è una milestone su GitHub (sync automatico).

## v0.2 — Rilasciato

Feature e infrastruttura spedite nella serie 0.2.x.

- [x] **NOM-9 — Publish automatico su tag**: job `publish` in `ci.yml` che su tag `v*` fa `vsce publish` (Marketplace) + `ovsx publish` (Open VSX, opzionale), con guard tag == `package.json`. Secret `VSCE_PAT` (e opz. `OVSX_PAT`).
- [x] **NOM-10 — Backlog/milestone sync**: workflow `backlog-sync.yml` + `scripts/backlog-sync.mjs` che rende milestone e issue GitHub un mirror di `BACKLOG.md` (id `NOM-n` ancorati via marker, idempotente).
- [x] **NOM-11 — Auto-fix `go.diagnostic.vulncheck`**: all'attivazione corregge il default rotto `"Prompt"` (rifiutato da gopls) a un valore valido; settings `nomadLens.autoFixGoVulncheck` / `nomadLens.goVulncheckFixValue`. Logica pura in `core/vulncheck.ts`, testata.
- [x] **NOM-12 — Hardening da audit**: `desired` autorevole dal `Count` dei task group (jobHealth più accurato sui job sotto-scala), timeout richieste (8s), avviso token ACL in chiaro su `http://`, CI least-privilege.
- [x] **NOM-13 — Guida + sito**: `docs/GUIDE.md` e landing GitHub Pages (`site/`, tema dark) con deploy automatico via `pages.yml`.

## v0.3 — Daily driver

- [x] **NOM-1 — Restart storm / OOM detector**: le allocation con restart loop (≥3) o kill da OOM sono evidenziate nel tree (icona ⚠ + descrizione), dedotto dagli eventi task già presenti nella lista allocation (nessuna richiesta extra). Logica pura `taskEventIsOom`/`allocWarnings`, testata.
- [x] **NOM-2 — Deployment watch**: poller dei deployment attivi → progress (healthy/desired, canary) in status bar + notifica su successo/fallimento e su blocco (healthy fermo oltre soglia). Aggregazione/stato puri in `core/deploy.ts` (testati). Settings `deploymentWatch`/`deploymentPollSeconds`/`deploymentStallSeconds`.
- [x] **NOM-3 — Azioni con conferma**: restart allocation, stop/start job dal menu contestuale del tree. Distruttive → doppia conferma modale; stop job → conferma digitando l'id; mai un bottone di default. Metadati puri in `core/actions.ts` (testati); stopJob verificato in integrazione.
- [x] **NOM-4 — Grep cross-alloc**: comando "Grep Logs Across Allocations" sul job → cerca una stringa nei log (stdout+stderr) di tutte le allocation in parallelo (pool a 8), report markdown raggruppato per alloc con posizione `task/type:riga`. Logica pura `grepLogs`/`renderGrepReport` in `core/grep.ts` (testata).

## v0.4 — Drift

- [ ] **NOM-5 — Compare clusters**: stesso job su due cluster → tabella diff di image tag, env, risorse, count.
- [ ] **NOM-6 — Image inventory**: tabella job → immagine Docker → tag per cluster.
- [ ] **NOM-7 — Snapshot schedulabile**: comando che salva lo snapshot in un path configurabile (per il report mattutino in devops_hiway).

## Rilascio

- [ ] **NOM-8 — Screenshot/GIF nel README**: ultimo asset per la pagina Marketplace (icona PNG e publisher `allannava95` già fatti).
