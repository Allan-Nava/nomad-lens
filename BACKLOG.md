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

- [ ] **NOM-8 — Publish sul Marketplace**: publisher reale in `package.json`, icona PNG 128px, screenshot/GIF nel README, `vsce publish`.
