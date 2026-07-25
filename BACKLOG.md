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

## Release

- [ ] **NOM-8 — Screenshots/GIF in the README**: the last asset for the Marketplace page (PNG icon and `allannava95` publisher already done).
