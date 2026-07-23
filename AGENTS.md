# AGENTS.md — nomad-lens

Estensione VS Code **Nomad Lens**: operations HashiCorp Nomad nell'editor — tree cluster/job/allocation/task, log follow, plan diff repo-vs-running, incident bundle, snapshot report. TypeScript + esbuild, zero dipendenze runtime (fetch nativo).

Questo file definisce le regole operative per gli agent (Copilot, Claude, altri tool AI) quando lavorano in questo repository.

## Regole di lavoro (SEMPRE)

- **Ogni commit = release taggata `vX.Y.Z`**: nuova sezione in `CHANGELOG.md` (Keep a Changelog, in italiano) + `git tag -a vX.Y.Z -m "Release X.Y.Z"`. Bump `minor` per novita' sostanziali, `patch` per fix. Il `version` di package.json deve coincidere col tag. **Esenti**: auto-commit su `.claude/settings.json` e commit `report:` CI.
- **MAI `git push`**: lo fa sempre l'utente. MAI `Co-Authored-By` nei commit.
- **Gate prima di chiudere**: `npx tsc --noEmit` + `npm test` verdi (stessi check della CI).
- **Logica nel core puro** `src/core/` (MAI import `vscode` li') con test in `test/run.ts`; `src/extension.ts` e' solo glue UI.
- **SICUREZZA TOKEN**: token ACL solo da env var (`tokenEnv` = nome variabile) — MAI in settings/log/doc. Comandi mutativi sempre con conferma esplicita.
- **MAI puntare i test ai cluster reali**: solo `nomad agent -dev` locale usa e getta.
- **Todo -> `BACKLOG.md`** (item con id stabile `NOM-n`), niente TODO sparsi.

## Comandi

- `npm run build` (bundle), `npm test` (unit + integrazione con nomad agent -dev), `npx tsc --noEmit` (typecheck)
- `.vsix` locale: `npx @vscode/vsce package --no-dependencies`
- Integrazione: serve `nomad` nel PATH; se manca si salta con notice. In CI viene scaricato pinnato.

## Trappole note

- `jobHealth`: job `running` con alloc mancanti o failed = **degraded** (cuore dello snapshot).
- Il plan vuole il job in JSON: HCL passa prima da `POST /v1/jobs/parse` con `Canonicalize: true`.
- Timestamp eventi Nomad in **nanosecondi**: dividere per 1e6 prima di `new Date()`.
- Stream log (`follow=true`): chiudere sempre con l'AbortController su dispose/stop/cambio cluster.
- In CI niente driver Docker: job registrati restano `pending`, i test non devono assumere alloc running.
- `test/run.ts` senza top-level await (per tsc e' CJS): tutto dentro `main()`; spawn di binari esterni solo dopo check `spawnSync` + handler `on('error')`.
- `publisher` in package.json e' placeholder: allinearlo prima del publish Marketplace.

## Puntatori

- Backlog: `BACKLOG.md` - CI: `.github/workflows/ci.yml` - Repo gemelli: `ansible-vars-lens`, `nats-lens`
