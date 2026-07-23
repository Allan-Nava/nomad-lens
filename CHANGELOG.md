# Changelog

## 0.1.1

### Aggiunto

- Publish automatico sugli store su tag `v*`: nuovo job `publish` in `ci.yml` che esegue `vsce publish` (VS Code Marketplace) e, se configurato il secret `OVSX_PAT`, `ovsx publish` (Open VSX). Secret richiesto: `VSCE_PAT`. Environment `marketplace` per un eventuale gate di approvazione manuale.
- Guard di release nel job `package`: la pipeline aborta se il tag non combacia con `version` di `package.json`.
- Sync automatico del backlog: workflow `backlog-sync.yml` + `scripts/backlog-sync.mjs` (zero dipendenze, fetch nativo) che rende milestone e issue GitHub un mirror di `BACKLOG.md`. Ogni heading `##` → milestone, ogni voce `NOM-n` → issue ancorata via marker `<!-- backlog:NOM-n -->`; voci spuntate chiudono la issue, sezioni interamente spuntate chiudono la milestone. Idempotente, con dry-run da `workflow_dispatch`.

## 0.1.0

- Cluster explorer: job con health reale (running incompleto = degraded), allocation con restart count, task, nodi, deployment.
- Plan diff repo-vs-running: parse HCL server-side + plan con diff renderizzato accanto all'editor.
- Log follow in streaming (stdout/stderr) in Output channel dedicati.
- Incident bundle: `incidents/<data>-<job>-<alloc>/` con report.md (timeline eventi) + log allegati.
- Cluster snapshot report in markdown (problemi in cima, tabella completa).
- Multi-cluster da settings; token ACL solo da env var, mai visualizzati.
