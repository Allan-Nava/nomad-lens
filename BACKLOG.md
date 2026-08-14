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
- [x] **NOM-16 — Live resource usage**: `GET /v1/client/allocation/:id/stats` → actual CPU/memory per task against what the spec requests, in the allocation tooltip and as a per-job report that flags over- and under-provisioning. Fetched with `mapPool` (limited concurrency) and degrading gracefully when the client node is unreachable. Pure `renderResourceUsage` in `core/resources.ts`, tested.
- [x] **NOM-17 — Node drain & eligibility**: from the node context menu, toggle scheduling eligibility (`POST /v1/node/:id/eligibility`) and start/stop a drain (`POST /v1/node/:id/drain`, with a deadline). The most destructive action in the extension: drain requires confirmation by typing the node id, and the tree shows the drain progress (remaining allocations). Metadata in `core/actions.ts`, tested.
- [x] **NOM-18 — Filter the tree**: a filter box on the Nomad view — free text on the job name plus a "problems only" toggle (degraded/pending/failed), so a cluster with hundreds of jobs stays usable. Pure predicate `jobMatchesFilter` in `core/report.ts`, tested.
- [x] **NOM-19 — Codebase in English** (chore): translate the Italian still left in `src/` and `test/` — comments, user-facing strings (`Nessun cluster configurato`, `Digita "…" per confermare`), headings of the generated reports (`## Tutti i job`) and test names — per the rule in `CLAUDE.md`/`AGENTS.md`. Touches visible output, so it needs the test expectations updated in the same pass.

## v0.6 — Docs

- [x] **NOM-20 — Published documentation generated from the guide**: `site/guide.html` is built from `docs/GUIDE.md` by `npm run site` (pure renderer `core/markdown.ts`, tested; `scripts/build-site.ts` for the shell), and the Pages workflow runs it before uploading — so the website can never document a version of the extension that no longer exists. The guide itself was deepened: sequential numbering, a complete command reference, a complete settings reference and a recipes section; the landing page links into it by anchor.

## v1.0 — Marketplace release

Road to the first public release: the extension is feature-complete, this is the polish and the actual publish.

- [x] **NOM-8 — Marketplace visual**: PNG icon, `allannava95` publisher, and a stylized overview illustration in the README (`media/showcase.png`, from `media/showcase.svg`: cluster tree with OOM/restart flags and won't-place diagnostics, plan diff, resource usage, deploy bar). Real captures/GIF from the Extension Host can replace it in a later 1.0.x.
- [x] **NOM-21 — Marketplace listing polish**: `galleryBanner` (dark `#0A1420`), README badges (Marketplace version/installs, CI, license), `homepage`/`bugs`/`qna` links in `package.json`; `categories`/`keywords` verified. Manifest validated with `vsce package`.
- [x] **NOM-22 — Cut `v1.0.0`**: version bumped to `1.0.0`, CHANGELOG entry, tag `v1.0.0` (guard tag == `package.json`). The `publish` job ships to the Marketplace (+ Open VSX) automatically on push, once the `VSCE_PAT` secret (publisher `allannava95`) is set.

## v1.1 — Visual UI

Rich webview panels next to the tree, for when a table or a chart says more than a markdown report. Each panel is a **pure HTML renderer in `core/`** (returns a self-contained string, unit-tested) plus thin webview plumbing in `extension.ts`; **zero runtime dependencies** — inline CSS and hand-drawn SVG, theme-aware via `var(--vscode-*)`, CSP-locked, no CDN. Messages from the panel route back through the existing confirmed commands.

- [x] **NOM-23 — Cluster dashboard panel**: a webview summarising the active cluster — a job-health breakdown (running/degraded/pending/failed), the problem list, node drain/eligibility, and active deployments with progress bars — auto-refreshing on the deployment poll. The interactive counterpart of the markdown snapshot; clicking an entry reveals it in the tree. Pure `renderDashboard(html)` in `core/webview/dashboard.ts`, tested.
- [x] **NOM-24 — Job detail panel**: per-job webview (*Open Job Panel*) with the allocations table (status, node, restarts, OOM flags) and deployment progress, plus **action buttons** — Restart/Bundle per allocation, Stop/Start/History-Revert/Resource-usage/Why-not-placing at job level — that post messages routed through the **existing confirmed commands** (`executeCommand`, so every mutation keeps its typed confirmation). Pure `renderJobPanel` + a tested allow-list contract (`isAllowedPanelCommand`/`isAllocPanelCommand`) in `core/webview/job.ts`. Live resource gauges and inline version history are reachable via their buttons; embedding them in-panel is a later refinement.
- [x] **NOM-25 — Visual diff panel**: the plan diff and version diff rendered as a colour-coded, collapsible tree (added/removed/changed per task group → task → field) instead of plain text, reusing the existing `JobDiff` data. Pure `renderDiffHtml(JobDiff)` in `core/webview/diff.ts`, tested (including the no-change case and nested objects).
- [x] **NOM-26 — Inline charts (zero-dep SVG)**: a small pure SVG chart kit — donut (health mix), horizontal bars (deployment progress, resource %), sparkline (CPU/memory samples over the poll window) — used by the dashboard and job panel. Pure functions in `core/webview/charts.ts` returning `<svg>` strings, tested (value→geometry, empty/NaN handling, accessible `<title>`).

## v1.2 — Live & interactive UI

The v1.1 panels are static snapshots; v1.2 makes them live and clickable. Same rules: pure renderers/state in `core/`, thin webview glue, zero runtime dependencies, CSP-locked, theme-aware.

- [x] **NOM-27 — Log console panel**: *Open Log Console* (task context menu) opens a webview log viewer — level-coloured lines (error/warn/info/debug), a live filter box, follow and wrap toggles — seeded with the tail and streamed via the existing `followLogs` AbortController (line-buffered, aborted on panel dispose). Pure `stripAnsi`/`logLevel`/`classifyLine(s)`/`renderLogConsole` in `core/webview/logs.ts`, tested. First cut is one task+type; multiple allocations in one panel is a later refinement.
- [x] **NOM-28 — Live panels (push updates)**: the dashboard and job panels refresh on the deployment poll by posting a `{type:'update', body}` message the page swaps into `#root` in place (no page reload, scroll kept), with a small "live" pulse and a `nomadLens.livePanels` opt-out. Renderers split into pure `renderDashboardBody`/`renderJobPanelBody` (inner) + a full-document shell whose buttons use event delegation so they survive the swap; tested (body has no scaffolding, shell wraps `#root` + carries the update handler).
- [x] **NOM-29 — Inline resource gauges & sparklines**: the job panel embeds a Resource-usage section — per-task CPU/memory gauges vs requested (`progressBar`, with %) and a sparkline of recent samples, flagged ⚠ near-limit / 💤 oversized (reusing `usageFlag`). Fetched per running allocation with `mapPool` and degrading gracefully when the client node is unreachable. Pure `renderResourceGauges` in `core/webview/job.ts` (reuses `resources.ts` + `charts.ts`), tested. Samples accumulate in a ring buffer across refreshes; continuous auto-sampling arrives with NOM-28 (live panels).
- [x] **NOM-30 — Dashboard drill-down & tree reveal**: clicking a problem job in the dashboard opens its Job Panel and reveals+selects it in the explorer. The tree moved to `createTreeView` with stable item ids (`job:<id>`/`section:<label>`) and `getParent`, so `reveal` can locate the node. Pure `parseDashboardMessage` (validates the webview → host messages) tested; `revealJob` plumbing in the glue (best-effort, never throws).

## v1.3 — Panels & navigation

Rounding out the webview panels and making a large cluster navigable. Same rules: pure renderers in `core/`, thin glue, zero dependencies, CSP-locked.

- [x] **NOM-31 — Inline version history in the job panel**: the job panel embeds the last few job versions (v#, submit time, stable, current) — the refinement deferred from NOM-24 — with the existing History/Revert flow one click away. Versions are fetched once per full render and cached, so the live ticks stay light. Pure `renderVersionList` in `core/webview/job.ts` (reusing `core/versions.ts`), tested.
- [x] **NOM-32 — Node detail panel**: *Open Node Panel* (node click / context menu) opens a webview — status/eligibility/drain (with remaining count), allocations grouped by job, and drain-aware buttons (Drain / Stop draining / toggle eligibility) routed through the existing confirmed node commands via `executeCommand`. Pure `renderNodePanel` + `isAllowedNodePanelCommand` in `core/webview/node.ts` (reuses `nodes.ts`), tested. API `nodeAllocations`.
- [x] **NOM-33 — Global job search**: *Search Jobs Across All Clusters* lists every job from every configured cluster in a QuickPick (fuzzy on name + cluster/health description); on pick it switches to that cluster and opens the job panel. Pure `buildGlobalJobItems` in `core/search.ts` (flatten + sort + labels), tested; the cluster switch (shared `switchCluster` helper) + panel open in the glue.
