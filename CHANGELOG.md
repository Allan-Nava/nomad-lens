# Changelog

## 0.2.1

### Aggiunto

- Guida d'uso completa in `docs/GUIDE.md` (installazione, config cluster/token, explorer, plan diff, log, incident bundle, snapshot, auto-fix vulncheck, troubleshooting, sicurezza), linkata dal README. Esclusa dal `.vsix`.

## 0.2.0

### Aggiunto

- Auto-fix di `go.diagnostic.vulncheck`: all'attivazione (`onStartupFinished`), se la Go extension è installata e il valore effettivo è il default rotto `"Prompt"` (che gopls rifiuta con `Invalid settings: ... invalid option "Prompt"`), Nomad Lens lo corregge a un valore valido. Trasparente (notifica con "Annulla") e reversibile. Corregge nello scope giusto (globale per il default implicito, workspace se l'override è lì).
  - Nuove settings: `nomadLens.autoFixGoVulncheck` (bool, default `true`) e `nomadLens.goVulncheckFixValue` (`"Off"` | `"Imports"`, default `"Off"`).
  - Logica di decisione pura e testata in `src/core/vulncheck.ts` (nessun import `vscode`); glue I/O in `extension.ts`.

## 0.1.7

### Corretto

- `publisher` in `package.json` corretto in `allannava95` (era il placeholder `allan-nava`, che non combaciava con il publisher reale sul Marketplace). Sblocca il publish automatico: l'extension id diventa `allannava95.nomad-lens`. Il `VSCE_PAT` in CI deve appartenere a questo publisher.

## 0.1.6

### Modificato

- `typescript` aggiornato a `^7.0.2` (compilatore nativo, dependabot #16). Solo toolchain di typecheck: il bundle resta esbuild. Verificato con `npm ci` pulito che il lockfile porta tutti i binari nativi per-piattaforma (incluso `@typescript/typescript-linux-x64` per la CI) e che `tsc --noEmit` + test + build passano. Il fallimento della PR era dovuto solo alla base pre-fix `types` (0.1.3), non al bump.

## 0.1.5

### Aggiunto

- Test di regressione (TDD) `hcl fixture: nessun blocco single-line multi-argomento`: linta la spec HCL di riferimento e blocca a monte la sintassi che HCL2 rifiuta. Gira **sempre**, anche senza il binario `nomad` (a differenza dei test di integrazione), cosi' il bug corretto in 0.1.4 non puo' piu' sfuggire in locale. Fixture HCL spostata a livello di modulo.

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
