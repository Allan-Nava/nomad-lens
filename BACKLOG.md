# Backlog — nomad-lens

Sorgente unica dei todo. Id stabili `NOM-n`; spuntare, non cancellare.

## v0.2 — Daily driver

- [ ] **NOM-1 — Restart storm / OOM detector**: evidenziare nel tree i job con restart loop e gli exit da OOM (stats API: memoria usata vs allocata).
- [ ] **NOM-2 — Deployment watch**: dopo un deploy, progress canary/rolling nella status bar + notifica se fallisce o si blocca.
- [ ] **NOM-3 — Azioni con conferma**: restart allocation, stop/start job (doppia conferma, mai default).
- [ ] **NOM-4 — Grep cross-alloc**: cerca una stringa nei log di tutte le allocation di un job in parallelo, risultati con link.

## v0.3 — Drift

- [ ] **NOM-5 — Compare clusters**: stesso job su due cluster → tabella diff di image tag, env, risorse, count.
- [ ] **NOM-6 — Image inventory**: tabella job → immagine Docker → tag per cluster.
- [ ] **NOM-7 — Snapshot schedulabile**: comando che salva lo snapshot in un path configurabile (per il report mattutino in devops_hiway).

## Rilascio

- [ ] **NOM-8 — Asset per il Marketplace**: ~~icona PNG~~ (fatta, `media/logo.png`); restano publisher reale confermato su Marketplace + screenshot/GIF nel README (prerequisiti prima del primo publish).
- [x] **NOM-9 — Publish automatico su tag**: job `publish` in `ci.yml` che su tag `v*` fa `vsce publish` (Marketplace) + `ovsx publish` (Open VSX, opzionale), con guard tag == `package.json`. Richiede secret `VSCE_PAT` (e opz. `OVSX_PAT`).
- [x] **NOM-10 — Backlog/milestone sync**: workflow `backlog-sync.yml` + `scripts/backlog-sync.mjs` che rende milestone e issue GitHub un mirror di `BACKLOG.md` (id `NOM-n` ancorati via marker, idempotente).
