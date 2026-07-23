# CLAUDE.md — nomad-lens

Estensione VS Code **Nomad Lens** (`github.com/Allan-Nava/nomad-lens`): operations HashiCorp Nomad nell'editor — tree cluster/job/allocation/task, log follow in streaming, **plan diff tra job spec nel repo e quello running**, incident bundle con un click, snapshot report del cluster. TypeScript + esbuild, **zero dipendenze runtime** (API HTTP Nomad via fetch nativo di Node 18+).

## Regole di lavoro (SEMPRE)

- **Ogni commit = release taggata `vX.Y.Z`**: nuova sezione in `CHANGELOG.md` (Keep a Changelog, in italiano) + `git tag -a vX.Y.Z -m "Release X.Y.Z"`. Bump `minor` per novità sostanziali, `patch` per fix. Senza chiederlo. Il campo `version` di `package.json` deve coincidere col tag (vsce lo pretende). **Esenti**: auto-commit su `.claude/settings.json` e commit `report:` delle build CI.
- **MAI `git push`** — lo fa sempre l'utente. MAI `Co-Authored-By` nei commit.
- **Gate prima di chiudere**: `npx tsc --noEmit` + `npm test` verdi (stessi check della CI).
- **La logica va nel core puro** (`src/core/` — MAI import `vscode` lì) con test in `test/run.ts`; `src/extension.ts` è solo glue UI.
- **SICUREZZA TOKEN**: i token ACL Nomad si leggono SOLO da env var (`tokenEnv` nelle settings indica il *nome* della variabile) — MAI token in settings, log, doc o output. I comandi mutativi (restart/stop/drain, futuri) richiedono SEMPRE conferma esplicita.
- **MAI puntare i test ai cluster reali** (cologno/ovh/dev): solo `nomad agent -dev` usa e getta locale.
- **Todo → `BACKLOG.md`** (sorgente unica, item con id stabile `NOM-n`). Non sparpagliare TODO nei commenti.

## Comandi

```bash
npm run build            # bundle esbuild → dist/extension.js
npm test                 # unit (renderer) + integrazione (nomad agent -dev su porta random)
npx tsc --noEmit         # typecheck (esbuild non typecheckka)
npx @vscode/vsce package --no-dependencies   # .vsix locale
```

F5 apre l'Extension Host. L'integrazione richiede `nomad` nel PATH (`brew install nomad`); se manca, si salta con notice (mai errore). In CI il binario viene scaricato pinnato — vedi `ci.yml`.

## Architettura

- `src/core/api.ts` — `NomadClient`: wrapper API HTTP v1 (jobs con summary, allocations, nodes, deployments, `jobs/parse` HCL→JSON, `plan` con Diff, log tail e **log follow in streaming** via fetch + AbortController). Config cluster: `{name, address, namespace?, tokenEnv?}`.
- `src/core/report.ts` — renderer puri: `renderSnapshot` (report markdown mattutino: problemi in cima, tabella completa sotto), `renderPlanDiff` (diff ricorsivo Fields/Objects/TaskGroups), `buildIncidentBundle` (markdown con timeline eventi task + file di log), `jobHealth` (running con alloc mancanti = degraded).
- `src/extension.ts` — tree (Jobs→alloc→task, Nodes, Deployments), Output channel per stream di log, status bar col cluster attivo, comandi (plan del file attivo `.nomad`/`.hcl`, incident bundle in `incidents/<data>-<job>-<alloc>/`, snapshot).
- `test/run.ts` — unit con fixture + integrazione: spawna `nomad agent -dev` con config porta custom, parse+register+plan (diff atteso e caso no-diff); teardown sempre.

## Trappole note / regole tecniche

- **`jobHealth`**: un job `running` con `running < desired` o `failed > 0` è **degraded** — è il cuore dello snapshot, non semplificarlo.
- Il plan richiede il job in **JSON**: gli spec `.nomad`/`.hcl` passano prima da `POST /v1/jobs/parse` (`Canonicalize: true`).
- **Timestamp eventi Nomad in nanosecondi**: dividere per 1e6 prima di `new Date()`.
- Lo streaming log usa `follow=true&plain=true` con fetch: chiudere SEMPRE con l'AbortController (dispose/stop/cambio cluster), altrimenti la connessione resta appesa.
- `nomad agent -dev` non ha driver Docker in CI: i job registrati restano `pending` — i test non devono assumere allocation running.
- `test/run.ts` senza top-level await (per tsc è CJS): tutto dentro `main()`. Prima di spawnnare binari esterni: check con `spawnSync` + handler `on('error')`, o il processo test crasha.
- Il `publisher` in `package.json` è un placeholder: allinearlo prima del publish Marketplace.

## Puntatori

- Backlog: `BACKLOG.md` · CI: `.github/workflows/ci.yml` (test su push/PR; tag `v*` → vsix in release + `vsce publish`/`ovsx publish`, secret `VSCE_PAT`/`OVSX_PAT`, guard tag==version)
- Backlog sync: `.github/workflows/backlog-sync.yml` + `scripts/backlog-sync.mjs` (mirror `BACKLOG.md` → milestone/issue GitHub, idempotente, marker `<!-- backlog:NOM-n -->`; il file resta sorgente unica)
- Repo gemelli (stesso scaffold/pattern): `~/projects/github.com/ansible-vars-lens`, `~/projects/github.com/nats-lens`
- Runbook operativo di riferimento (pattern preflight/dry-run/canary): `~/projects/hiway/devops_hiway/CLAUDE.md`
