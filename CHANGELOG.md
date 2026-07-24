# Changelog

## 0.9.1

### Aggiunto

- Ambiente Docker per test e demo: `Dockerfile.test` + `docker-compose.yml`. `docker compose run --rm tests` esegue l'intera suite (unit + **integrazione**) in container con Nomad 1.9.5 pinnato — verificato **23/23 verdi**, integrazione inclusa (i servizi girano `privileged` con cgroup writable, necessario al client Nomad). Profilo `demo` (`docker compose --profile demo up`): Nomad dev su `:4646` + job di esempio (raw_exec, due allocation che loggano, con righe `error` per il grep) da puntare con l'estensione. Esclusi dal `.vsix`.

## 0.9.0

Completa la milestone v0.4 — Drift.

### Aggiunto

- **Snapshot su file** (NOM-7): comando *Save Cluster Snapshot to File* — scrive lo snapshot markdown in `nomadLens.snapshotPath` (cartella → `nomad-snapshot-<cluster>-<data>.md`, oppure file `.md` esatto; supporta `~`, crea le cartelle mancanti). Pensato per essere bindato a un task/scheduler esterno per il report mattutino. Nome file puro `snapshotFileName` in `core/report.ts`, testato.

## 0.8.0

### Aggiunto

- **Image inventory** (NOM-6): comando *Image Inventory (all clusters)* — matrice job × cluster con l'immagine docker per cella, e marcatore `≠` sui job con drift di immagine tra i cluster dove esistono. Fetch a concorrenza limitata; rendering puro `renderImageInventory` in `core/drift.ts`, testato.

## 0.7.0

### Aggiunto

- **Compare job across clusters** (NOM-5): dal menu del job, confronta lo stesso job su due cluster (scelti dai configurati) → tabella diff di `count`, `image`, `cpu`, `memory` ed `env`, con marcatore `≠` sulle differenze. API `job(id)`; logica pura `summarizeJob`/`compareJobSpecs`/`renderComparison` in `core/drift.ts`, testata.

## 0.6.0

Completa la milestone v0.3 — Daily driver.

### Aggiunto

- **Grep cross-allocation** (NOM-4): comando *Grep Logs Across Allocations* sul job — cerca una stringa (case-insensitive) nei log `stdout`+`stderr` di tutte le allocation in parallelo (pool a concorrenza 8), e apre un report markdown raggruppato per allocazione con posizione `task/type:riga`. Logica pura `grepLogs`/`renderGrepReport` in `core/grep.ts`, testata.

## 0.5.0

### Aggiunto

- **Deployment watch** (NOM-2): un poller osserva i deployment attivi e mostra il progresso (`healthy/desired`, canary) in una voce dedicata della status bar, con icona di stato. Notifiche su **successo**, **fallimento/annullamento** e su **blocco** (allocazioni healthy ferme oltre `deploymentStallSeconds`). Aggregazione task group e derivazione dello stato pure e testate in `core/deploy.ts`; `deployments()` ora espone `desired/placed/healthy/unhealthy/canaries`. Settings: `nomadLens.deploymentWatch`, `nomadLens.deploymentPollSeconds`, `nomadLens.deploymentStallSeconds`.

## 0.4.0

### Aggiunto

- **Azioni con conferma** (NOM-3): dal menu contestuale del tree — **Restart Allocation**, **Stop Job**, **Start Job**. Le azioni distruttive richiedono doppia conferma modale; lo stop job richiede di **digitare l'id** del job; nessun pulsante di default (regola CLAUDE.md sui comandi mutativi). API `restartAllocation`/`stopJob`/`startJob`; metadati/conferme puri in `core/actions.ts` (testati); `stopJob` verificato in integrazione contro `nomad agent -dev`.

## 0.3.1

Hardening dall'audit del codice recente.

### Corretto

- **`jobs()` non satura più l'API**: l'enrichment del `desired` (fetch `GET /v1/job/:id` per ogni job service, introdotto in 0.2.2) ora gira con concorrenza limitata (`JOB_FETCH_CONCURRENCY = 8`) invece che tutto in parallelo. Nuovo helper puro `mapPool`, testato (cap di concorrenza + ordine).
- **Rilevamento OOM più stretto** (`taskEventIsOom`): non usa più `includes('oom')` nudo (matchava "zoom"/"room" → falsi positivi); ora richiede `out of memory` / `oom killed` / `oomkilled` o i `Details` espliciti.

## 0.3.0

### Aggiunto

- **Restart storm / OOM detector** (NOM-1): nel tree, le allocation con restart loop (≥3 restart) o uccise per **OOM** sono evidenziate con icona ⚠, descrizione e tooltip. L'OOM è dedotto dagli eventi task già inclusi nella risposta `allocations` (nessuna richiesta extra). Logica pura e testata: `taskEventIsOom` (`core/api.ts`) e `allocWarnings` (`core/report.ts`); `AllocSummary` ora espone `oom`.

## 0.2.5

### Modificato

- Backlog e milestone riorganizzati: nuova milestone **v0.2 — Rilasciato** con le feature spedite nella serie 0.2.x (publish automatico, backlog sync, auto-fix vulncheck `NOM-11`, hardening da audit `NOM-12`, guida + sito `NOM-13`). Le milestone pianificate rinominate coerentemente con le versioni reali (`v0.3 — Daily driver`, `v0.4 — Drift`); `NOM-8` ridotto ai soli screenshot. Milestone/issue GitHub allineate.

## 0.2.4

### Modificato

- Restyling della landing GitHub Pages (`site/index.html`): tema dark con accento neon-green, sfondo aurora + dot-grid, titolo con gradiente animato, logo con glow, mock "terminale" con snapshot/plan di esempio, card glass con bordo luminoso all'hover. Sempre self-contained e zero dipendenze; animazioni disattivate con `prefers-reduced-motion`.

## 0.2.3

### Aggiunto

- GitHub Pages: landing page self-contained in `site/index.html` (hero col logo, features, install, link alla guida; tema chiaro/scuro, zero dipendenze) + workflow `pages.yml` che pubblica su push a `main` e auto-abilita Pages (`configure-pages` con `enablement: true`). URL: https://allan-nava.github.io/nomad-lens/. Esclusa dal `.vsix`.

## 0.2.2

Hardening dall'audit interno.

### Corretto

- **`desired` autorevole** (`jobHealth` core): il conteggio desiderato dei job service ora viene dal `Count` reale dei task group (`GET /v1/job/:id`), non più approssimato con `Running+Queued+Starting` dal summary. Prima un job running ma sotto-scala senza alloc in coda risultava "healthy"; ora è correttamente **degraded**. Fetch in parallelo, con fallback al summary se fallisce.
- **Timeout sulle richieste**: `getJson`/`postJson`/`logsTail` abortiscono dopo `REQUEST_TIMEOUT_MS` (8s) — un cluster irraggiungibile non lascia più l'albero appeso.
- **Corpi d'errore troncati** (500 char) nei messaggi, per non riversare output grezzo del cluster nelle notifiche.
- **CI least-privilege**: `permissions` di default a `contents: read`; solo il job `package` (che crea la release) ottiene `contents: write`.

### Aggiunto

- **Avviso token in chiaro**: se un cluster usa un token ACL su `http://` verso un host non locale, l'estensione avvisa (una volta per cluster). Logica pura `tokenSentInClear` in `core/api.ts`.

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
