# Changelog

## 0.1.4

### Corretto

- Test di integrazione rossi in CI (Nomad 1.9.5): la fixture HCL usava un blocco single-line con due argomenti (`resources { cpu = 100, memory = 64 }`), sintassi rifiutata da HCL2. Riscritti `config` e `resources` come blocchi multi-line. Non emergeva in locale perche' l'integrazione si salta senza il binario `nomad`.

## 0.1.3

### Corretto

- Build CI (`npx tsc --noEmit`) rossa per type globali Node/undici non risolti (`process`, `fetch`, `URL`, `AbortController`, `TextDecoder`, `Buffer`, `console`, `setTimeout`): dipendeva dall'auto-discovery dei pacchetti `@types`, non deterministica nel runner. `tsconfig.json` ora dichiara esplicitamente `"types": ["node", "vscode"]`.

## 0.1.2

### Aggiunto

- Logo dell'estensione (`media/logo.png`, 512px): lente d'ingrandimento che incornicia l'esagono Nomad, verde brand su squircle scuro. Impostato come `icon` in `package.json` per il Marketplace. Sorgente in `media/logo.svg`.

### Modificato

- `.vscodeignore` ripulito: il `.vsix` non spedisce piu' file interni (`CLAUDE.md`, `AGENTS.md`, `BACKLOG.md`, `.claude/`, `scripts/`, source map, `package-lock.json`). Ora contiene solo runtime + asset Marketplace.

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
