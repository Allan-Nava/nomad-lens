# AGENTS.md — nomad-lens

**Nomad Lens** VS Code extension: HashiCorp Nomad operations inside the editor — cluster/job/allocation/task tree, log follow, plan diff repo-vs-running, incident bundle, snapshot report. TypeScript + esbuild, zero runtime dependencies (native fetch).

This file defines the operational rules for agents (Copilot, Claude, other AI tools) working in this repository.

## Working rules (ALWAYS)

- **EVERYTHING IN ENGLISH**: code (identifiers, comments, user-facing strings, error and log messages) and documentation (`README.md`, `CHANGELOG.md`, `BACKLOG.md`, `docs/`, `site/`, JSDoc, commit messages, PR and issue titles/bodies) are written **in English only**. Chat with the user stays in Italian.
- **Every commit = tagged release `vX.Y.Z`**: new section in `CHANGELOG.md` (Keep a Changelog, in English) + `git tag -a vX.Y.Z -m "Release X.Y.Z"`. Bump `minor` for substantial features, `patch` for fixes. The `version` in package.json must match the tag. **Exempt**: auto-commits on `.claude/settings.json` and CI `report:` commits.
- **NEVER `git push`**: the user always does it. NEVER `Co-Authored-By` in commits.
- **Gate before closing**: `npx tsc --noEmit` + `npm test` green (the same checks as CI).
- **Logic in the pure core** `src/core/` (NEVER import `vscode` there) with tests in `test/run.ts`; `src/extension.ts` is UI glue only.
- **TOKEN SECURITY**: ACL tokens only from env vars (`tokenEnv` = the variable name) — NEVER in settings/logs/docs. Mutating commands always behind explicit confirmation.
- **NEVER point the tests at real clusters**: only a local throwaway `nomad agent -dev`.
- **Todos -> `BACKLOG.md`** (items with stable id `NOM-n`), no scattered TODOs.

## Commands

- `npm run build` (bundle), `npm test` (unit + integration with nomad agent -dev), `npx tsc --noEmit` (typecheck)
- Local `.vsix`: `npx @vscode/vsce package --no-dependencies`
- Integration: needs `nomad` on the PATH; if missing it is skipped with a notice. In CI it is downloaded pinned.

## Known traps

- `jobHealth`: a `running` job with missing or failed allocations = **degraded** (the heart of the snapshot).
- The plan wants the job as JSON: HCL goes through `POST /v1/jobs/parse` first with `Canonicalize: true`.
- Nomad event timestamps are in **nanoseconds**: divide by 1e6 before `new Date()`.
- Log stream (`follow=true`): always close it with the AbortController on dispose/stop/cluster switch.
- No Docker driver in CI: registered jobs stay `pending`, tests must not assume running allocations.
- `test/run.ts` has no top-level await (it is CJS for tsc): everything inside `main()`; spawn external binaries only after a `spawnSync` check + an `on('error')` handler.
- `publisher` in package.json is a placeholder: align it before publishing to the Marketplace.

## Pointers

- Backlog: `BACKLOG.md` - CI: `.github/workflows/ci.yml` - Twin repos: `ansible-vars-lens`, `nats-lens`
