# Backlog — nomad-lens

Single source of truth for todos. Stable ids `NOM-n`; check items off, never delete them. Every `##` is a GitHub milestone (synced automatically).

## v0.2 — Released

Features and infrastructure shipped in the 0.2.x series.

- [x] **NOM-9 — Automatic publish on tag**: `publish` job in `ci.yml` that on a `v*` tag runs `vsce publish` (Marketplace) + `ovsx publish` (Open VSX, optional), with a tag == `package.json` guard. Secret `VSCE_PAT` (and optionally `OVSX_PAT`).
- [x] **NOM-10 — Backlog/milestone sync**: workflow `backlog-sync.yml` + `scripts/backlog-sync.mjs` that makes GitHub milestones and issues a mirror of `BACKLOG.md` (`NOM-n` ids anchored via markers, idempotent).
- [x] **NOM-11 — `go.diagnostic.vulncheck` auto-fix**: on activation it corrects the broken `"Prompt"` default (rejected by gopls) to a valid value; settings `nomadLens.autoFixGoVulncheck` / `nomadLens.goVulncheckFixValue`. Pure logic in `core/vulncheck.ts`, tested.
- [x] **NOM-12 — Hardening from the audit**: authoritative `desired` from the task groups' `Count` (more accurate `jobHealth` on under-scaled jobs), request timeouts (8s), warning for cleartext ACL tokens over `http://`, least-privilege CI.
- [x] **NOM-13 — Guide + website**: `docs/GUIDE.md` and a GitHub Pages landing page (`site/`, dark theme) with automatic deploy via `pages.yml`.

## v0.3 — Daily driver

- [x] **NOM-1 — Restart storm / OOM detector**: allocations in a restart loop (≥3) or killed by OOM are highlighted in the tree (⚠ icon + description), derived from the task events already present in the allocation list (no extra request). Pure logic `taskEventIsOom`/`allocWarnings`, tested.
- [x] **NOM-2 — Deployment watch**: poller over active deployments → progress (healthy/desired, canary) in the status bar + notification on success/failure and on stall (healthy count stuck beyond the threshold). Pure aggregation/state in `core/deploy.ts` (tested). Settings `deploymentWatch`/`deploymentPollSeconds`/`deploymentStallSeconds`.
- [x] **NOM-3 — Actions with confirmation**: restart allocation, stop/start job from the tree context menu. Destructive ones → double modal confirmation; stop job → confirmation by typing the id; never a default button. Pure metadata in `core/actions.ts` (tested); stopJob verified in the integration tests.
- [x] **NOM-4 — Cross-alloc grep**: "Grep Logs Across Allocations" command on a job → searches a string in the logs (stdout+stderr) of all allocations in parallel (pool of 8), markdown report grouped by allocation with `task/type:line` positions. Pure logic `grepLogs`/`renderGrepReport` in `core/grep.ts` (tested).

## v0.4 — Drift

- [x] **NOM-5 — Compare clusters**: "Compare Job Across Clusters" command → the same job on two clusters, diff table of count/image/cpu/memory/env with a ≠ marker. Pure extraction/comparison in `core/drift.ts` (tested).
- [x] **NOM-6 — Image inventory**: "Image Inventory (all clusters)" command → job × cluster matrix with the docker image per cell and a `≠` marker on jobs with image drift. Pure rendering `renderImageInventory` in `core/drift.ts` (tested).
- [x] **NOM-7 — Schedulable snapshot**: "Save Cluster Snapshot to File" command that writes the snapshot to `nomadLens.snapshotPath` (a folder → `nomad-snapshot-<cluster>-<date>.md`, or an exact `.md` file; supports `~`). Pure file name `snapshotFileName` (tested). Bindable to an external task/scheduler for the morning report.

## v0.5 — Deep dive

Answering "what changed?" and "why is it broken?" without leaving the editor.

- [x] **NOM-14 — Job version history + revert**: `GET /v1/job/:id/versions?diffs=true` → pick two versions of a running job and render the diff (reusing the `renderPlanDiff` renderer), so you can see what the last deploy actually changed. **Revert** to a version via `POST /v1/job/:id/revert` — mutating and destructive, so confirmation by typing the job id, as with Stop Job. Pure version list/diff rendering in `core/versions.ts`, tested.
- [x] **NOM-15 — Placement diagnostics**: for a job stuck in `pending` with no allocations, `GET /v1/job/:id/evaluations` + `GET /v1/evaluation/:id` → render the `FailedTGAllocs` breakdown (nodes filtered by constraint, exhausted dimensions, class filtered, quota) as a readable "why it does not place" report. Surfaced in the tree as a ⚠ on the job and as a command. Pure `renderPlacementFailures` in `core/placement.ts`, tested.
- [ ] **NOM-16 — Live resource usage**: `GET /v1/client/allocation/:id/stats` → actual CPU/memory per task against what the spec requests, in the allocation tooltip and as a per-job report that flags over- and under-provisioning. Fetched with `mapPool` (limited concurrency) and degrading gracefully when the client node is unreachable. Pure `renderResourceUsage` in `core/resources.ts`, tested.
- [ ] **NOM-17 — Node drain & eligibility**: from the node context menu, toggle scheduling eligibility (`POST /v1/node/:id/eligibility`) and start/stop a drain (`POST /v1/node/:id/drain`, with a deadline). The most destructive action in the extension: drain requires confirmation by typing the node id, and the tree shows the drain progress (remaining allocations). Metadata in `core/actions.ts`, tested.
- [ ] **NOM-18 — Filter the tree**: a filter box on the Nomad view — free text on the job name plus a "problems only" toggle (degraded/pending/failed), so a cluster with hundreds of jobs stays usable. Pure predicate `jobMatchesFilter` in `core/report.ts`, tested.
- [ ] **NOM-19 — Codebase in English** (chore): translate the Italian still left in `src/` and `test/` — comments, user-facing strings (`Nessun cluster configurato`, `Digita "…" per confermare`), headings of the generated reports (`## Tutti i job`) and test names — per the rule in `CLAUDE.md`/`AGENTS.md`. Touches visible output, so it needs the test expectations updated in the same pass.

## Release

- [ ] **NOM-8 — Screenshots/GIF in the README**: the last asset for the Marketplace page (PNG icon and `allannava95` publisher already done).
