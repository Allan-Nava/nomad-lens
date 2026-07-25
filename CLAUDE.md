# CLAUDE.md — nomad-lens

**Nomad Lens** VS Code extension (`github.com/Allan-Nava/nomad-lens`): HashiCorp Nomad operations inside the editor — cluster/job/allocation/task tree, streaming log follow, **plan diff between the job spec in the repo and the running one**, one-click incident bundle, cluster snapshot report. TypeScript + esbuild, **zero runtime dependencies** (Nomad HTTP API via Node 18+ native fetch).

## Working rules (ALWAYS)

- **EVERYTHING IN ENGLISH**: code (identifiers, comments, user-facing strings, error and log messages) and documentation (`README.md`, `CHANGELOG.md`, `BACKLOG.md`, `docs/`, `site/`, JSDoc, commit messages, PR and issue titles/bodies) are written **in English only**. Chat with the user stays in Italian.
- **Every commit = tagged release `vX.Y.Z`**: new section in `CHANGELOG.md` (Keep a Changelog, in English) + `git tag -a vX.Y.Z -m "Release X.Y.Z"`. Bump `minor` for substantial features, `patch` for fixes. Without being asked. The `version` field in `package.json` must match the tag (vsce requires it). **Exempt**: auto-commits on `.claude/settings.json` and `report:` commits from CI builds.
- **NEVER `git push`** — the user always does it. NEVER `Co-Authored-By` in commits.
- **Gate before closing**: `npx tsc --noEmit` + `npm test` green (the same checks as CI).
- **Logic belongs in the pure core** (`src/core/` — NEVER import `vscode` there) with tests in `test/run.ts`; `src/extension.ts` is UI glue only.
- **TOKEN SECURITY**: Nomad ACL tokens are read ONLY from env vars (`tokenEnv` in the settings holds the *name* of the variable) — NEVER tokens in settings, logs, docs or output. Mutating commands (restart/stop/drain, and future ones) ALWAYS require explicit confirmation.
- **NEVER point the tests at real clusters** (cologno/ovh/dev): only a local throwaway `nomad agent -dev`.
- **Todos → `BACKLOG.md`** (single source of truth, items with stable id `NOM-n`). Don't scatter TODOs across comments.

## Commands

```bash
npm run build            # esbuild bundle → dist/extension.js
npm test                 # unit (renderer) + integration (nomad agent -dev on a random port)
npx tsc --noEmit         # typecheck (esbuild does not typecheck)
npx @vscode/vsce package --no-dependencies   # local .vsix
```

F5 opens the Extension Host. The integration tests need `nomad` on the PATH (`brew install nomad`); if it is missing they are skipped with a notice (never an error). In CI the binary is downloaded pinned — see `ci.yml`.

## Architecture

- `src/core/api.ts` — `NomadClient`: HTTP v1 API wrapper (jobs with summary, allocations, nodes, deployments, `jobs/parse` HCL→JSON, `plan` with Diff, log tail and **streaming log follow** via fetch + AbortController). Cluster config: `{name, address, namespace?, tokenEnv?}`.
- `src/core/report.ts` — pure renderers: `renderSnapshot` (morning markdown report: problems on top, full table below), `renderPlanDiff` (recursive diff over Fields/Objects/TaskGroups), `buildIncidentBundle` (markdown with task event timeline + log files), `jobHealth` (running with missing allocations = degraded).
- `src/extension.ts` — tree (Jobs→alloc→task, Nodes, Deployments), Output channel for log streams, status bar with the active cluster, commands (plan of the active `.nomad`/`.hcl` file, incident bundle in `incidents/<date>-<job>-<alloc>/`, snapshot).
- `test/run.ts` — unit tests with fixtures + integration: spawns `nomad agent -dev` with a custom port config, parse+register+plan (expected diff and no-diff case); teardown always.

## Known traps / technical rules

- **`jobHealth`**: a `running` job with `running < desired` or `failed > 0` is **degraded** — this is the heart of the snapshot, do not simplify it.
- The plan needs the job as **JSON**: `.nomad`/`.hcl` specs go through `POST /v1/jobs/parse` first (`Canonicalize: true`).
- **Nomad event timestamps are in nanoseconds**: divide by 1e6 before `new Date()`.
- Log streaming uses `follow=true&plain=true` with fetch: ALWAYS close it with the AbortController (dispose/stop/cluster switch), otherwise the connection stays hanging.
- `nomad agent -dev` has no Docker driver in CI: registered jobs stay `pending` — tests must not assume running allocations.
- `test/run.ts` has no top-level await (it is CJS for tsc): everything inside `main()`. Before spawning external binaries: check with `spawnSync` + an `on('error')` handler, or the test process crashes.
- The `publisher` in `package.json` is a placeholder: align it before publishing to the Marketplace.

## Pointers

- Backlog: `BACKLOG.md` · CI: `.github/workflows/ci.yml` (tests on push/PR; tag `v*` → vsix on the release + `vsce publish`/`ovsx publish`, secrets `VSCE_PAT`/`OVSX_PAT`, guard tag==version)
- Backlog sync: `.github/workflows/backlog-sync.yml` + `scripts/backlog-sync.mjs` (mirrors `BACKLOG.md` → GitHub milestones/issues, idempotent, marker `<!-- backlog:NOM-n -->`; the file stays the single source of truth)
- Twin repos (same scaffold/patterns): `~/projects/github.com/ansible-vars-lens`, `~/projects/github.com/nats-lens`
- Reference operational runbook (preflight/dry-run/canary patterns): `~/projects/hiway/devops_hiway/CLAUDE.md`
