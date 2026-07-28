# Changelog

## 1.3.0

Closes the **v1.1 — Visual UI** milestone.

### Added

- **Job detail panel** (NOM-24): *Open Job Panel* (job context menu) opens a webview with the allocations table (status, node, restarts, OOM flags), the active deployment progress, and action buttons — Restart/Bundle per allocation, Stop/Start/History-Revert/Resource-usage/Why-not-placing at job level. Buttons post messages routed through the **existing commands** via `executeCommand`, so every mutation keeps its typed confirmation (no confirmation logic duplicated in the webview). Pure `renderJobPanel` + an allow-list contract (`isAllowedPanelCommand`/`isAllocPanelCommand`) in `core/webview/job.ts`, tested. CSP-locked with a nonce, theme-aware, zero dependencies.

## 1.2.0

### Added

- **Visual diff panel** (NOM-25): the **plan diff** (*Plan Current Job File*) and the **version diff** (*Job Version History*) now open in a webview as a colour-coded, collapsible tree (added = green, removed = red, changed = orange) grouped by task group → task → object → field, instead of plain text. Placement failures and warnings are shown on top. Pure `renderDiffTree`/`renderDiffPage` in `core/webview/diff.ts` (reusing the existing `JobDiff`), tested — including the no-change case, nested objects, and the CSP nonce. CSP-locked, no scripts (native `<details>`), theme-aware, zero dependencies.

## 1.1.0

Starts the **v1.1 — Visual UI** milestone.

### Added

- **Cluster dashboard panel** (NOM-23): *Open Cluster Dashboard* (icon in the Nomad view title) opens a webview summarising the active cluster — a job-health donut, the problem-jobs table, nodes needing attention, and active deployments with progress bars, plus a Refresh button. It re-renders on cluster switch. Self-contained, CSP-locked with a per-render nonce, theme-aware via `var(--vscode-*)`, **zero runtime dependencies**. Pure `renderDashboard` in `core/webview/dashboard.ts`, tested (sections, CSP nonce, degraded detection, all-green case).
- **Zero-dependency SVG chart kit** (NOM-26): pure `donut`, `progressBar`, `sparkline` in `core/webview/charts.ts` — used by the dashboard — returning `<svg>` strings with accessible `<title>`s. Tested for value→geometry, clamping, and empty/NaN handling (no `NaN`, no divide-by-zero).

## 1.0.0

First stable release. Closes the **v1.0 — Marketplace release** milestone.

Nomad Lens is feature-complete for day-to-day HashiCorp Nomad operations inside VS Code, with a zero-runtime-dependency core (Node's native `fetch`), logic covered by unit + integration tests against a real `nomad agent -dev`, and a Docker harness (`docker compose run --rm tests`).

### What's in 1.0

- **Explore** — jobs with real health (running-but-under-scaled = degraded), allocations with restart-loop/OOM flags, tasks, nodes (drain/eligibility), deployments; job filter (name + problems-only).
- **Understand** — plan diff repo↔running, job version history + revert (with plan preview), compare a job across clusters, image inventory across clusters, placement diagnostics ("why it won't schedule"), live resource usage vs requested.
- **Operate (with confirmation)** — restart allocation, stop/start job, revert job, node drain & scheduling eligibility. Destructive actions need a typed confirmation; never a default button. ACL tokens only from env vars, with a cleartext-over-http warning.
- **Diagnose** — streaming logs, cross-allocation grep, one-click incident bundle, cluster snapshot (also to a file), deployment watch in the status bar.
- **Project** — automatic publish on tag, backlog↔milestone sync, GitHub Pages site with the guide generated from `docs/GUIDE.md`, `go.diagnostic.vulncheck` auto-fix.

### Release

- Version `1.0.0`, tag `v1.0.0`. On push, CI packages the `.vsix` onto the GitHub Release and the `publish` job ships to the VS Code Marketplace (`vsce publish`) and, if `OVSX_PAT` is set, Open VSX — provided the `VSCE_PAT` secret (publisher `allannava95`) is configured. The guard aborts if the tag doesn't match `package.json`.

## 0.16.1

### Added

- **Overview illustration in the README** (NOM-8, interim): a stylized `media/showcase.png` (generated from `media/showcase.svg`) showing the cluster tree with OOM/restart-loop flags and "won't place" diagnostics, the plan diff repo↔running, live resource usage and the deployment status bar. Clearly an illustration, to be replaced with real captures/GIF from the Extension Host before the store launch. Excluded from the `.vsix` (loaded from the raw URL on the Marketplace page).

### Changed

- Backlog: new **v1.0 — Marketplace release** milestone (NOM-8 screenshots, NOM-21 listing polish, NOM-22 first publish); `NOM-21` done (`galleryBanner`, README badges, `homepage`/`bugs`/`qna`). GitHub milestones reconciled and the Italian/English duplicates removed.

## 0.16.0

### Added

- **The GitHub Pages site now hosts the full documentation** (NOM-20), generated from `docs/GUIDE.md` instead of duplicating it: `npm run site` renders `site/guide.html` (sticky table of contents, dark theme matching the landing page, responsive tables) and the Pages workflow runs it before uploading. The guide in the repo stays the single source of truth — the same rule `BACKLOG.md` follows — so the published page cannot document a version of the extension that no longer exists. `site/guide.html` is generated, therefore gitignored.
  - Pure renderer in `core/markdown.ts` (headings with anchors, paragraphs, fenced code, GFM tables, nested lists, blockquotes, rules, inline code/bold/italic/links), zero dependencies, unit-tested. Raw HTML in the source is escaped and markup inside code spans stays literal, so the generated page contains no tag the guide did not ask for — asserted by a test.
  - `scripts/build-site.ts` builds the page shell; bundled through the same esbuild step as the tests (`node esbuild.mjs --site`) so it can reuse the typed core instead of a second renderer in plain JS.
  - Two bugs the tests caught before release: the GFM alignment row `:-:` (a single dash) was not recognised, so a centred table silently rendered as a paragraph; and the guide-wide test used `__dirname`, which does not exist in the ESM test bundle.

### Changed

- **`docs/GUIDE.md` deepened and renumbered.** The `4b`/`6b-bis`/`6g` numbering that accumulated over the milestones is now sequential 1–22, and three sections are new: **Recipes** (before a deploy · morning check · a failing allocation · node maintenance · is prod really like dev?), a **command reference** covering all 24 commands with where each one lives, and a **settings reference** with type, default and meaning for every `nomadLens.*` key. Troubleshooting gained the timeout, namespace and active-filter cases.
- Landing page (`site/index.html`): the guide button and footer link now point at `./guide.html` instead of the GitHub blob; a **Deep dive** card grid covers the v0.5 features (version history, placement diagnostics, resource usage, node drain, cross-alloc grep, drift) and a **Documentation** grid links into the guide by anchor. A test asserts every anchor the landing links to exists in the guide, so those links cannot 404 silently.

## 0.15.0

Closes the v0.5 — Deep dive milestone.

### Changed

- **The whole codebase is now in English** (NOM-19), completing the 0.9.3 rule: comments and JSDoc across `src/core/*` and `src/extension.ts`, every user-facing string, and the test names in `test/run.ts`.
  - **User-visible strings changed**, so this is not a cosmetic release: notifications and errors (`Job X stopped.`, `nomad plan failed — …`), input boxes and pickers (`Type "X" to confirm`, `Does not match`, `Yes, proceed`), the vulncheck notification actions (`Undo` / `Stop fixing this`), tree placeholders (`No cluster configured`, `error: …`), and the `nomadLens.*` setting descriptions in `package.json`.
  - **Generated reports changed too**: the snapshot (`Generated:`, `total jobs`, `## ⚠ Needs attention`, `## All jobs`, `| Job | Status | … |`), the plan diff (`No differences: the job spec matches the running one.`, `⚠ Placement failed for:`), the incident bundle (`## Task event timeline`, `## Attached logs`, `## Analysis`), the cluster comparison (`| Field |`) and the grep report (now `matches`/`allocations` with correct pluralisation). Scripts that grep these reports for Italian strings need updating.
  - Test assertions that depended on the Italian output were updated in the same pass; the snapshot problems-section test now splits on the English headings.
  - Also translated, beyond the item's original scope: `scripts/backlog-sync.mjs` (including the `_Managed from BACKLOG.md_` footer written into GitHub issues), the CI/Pages/backlog-sync workflow comments, `Dockerfile.test`, `docker-compose.yml` and the `docker/` fixtures.
  - Verified **51/51 green** in the Docker suite (Nomad 1.9.5), integration included.

## 0.14.0

### Added

- **Job filter in the tree** (NOM-18): two buttons in the Nomad view title — *Filter Jobs by Name* (substring, case-insensitive) and *Show Problem Jobs Only* (degraded/pending/failed/lost, by effective health, so a running-but-under-scaled job counts) — plus *Clear Job Filter*. The two criteria are ANDed. A cluster with hundreds of jobs stays usable.
  - When a filter is active the list shows it as its **first entry** (`filter: 2/24 · "web" · problems only`), and clicking it clears the filter. A silently truncated list would read as an empty cluster; this makes the hiding explicit.
  - Escaping the input box leaves the current filter untouched instead of clearing it.
  - Pure logic in `core/report.ts` (`jobMatchesFilter`, `isFilterActive`, `filterLabel`, `EMPTY_JOB_FILTER`), tested — including that whitespace-only text is not a filter and that `problemsOnly` uses `jobHealth`, not the raw status.

## 0.13.0

### Added

- **Node drain & scheduling eligibility** (NOM-17): nodes are now first-class tree items (name, state, drain progress, tooltip with the node id) with three commands on their context menu.
  - *Drain Node* — asks for a deadline first (1 hour, the Nomad default · 10 minutes · no deadline), then requires **typing the node name**: draining evicts every allocation on it, the most destructive action in the extension. Deliberately no `-force` equivalent (immediate kill).
  - *Stop Draining Node* and *Toggle Node Scheduling Eligibility* — cheap and reversible, so a single confirmation. Toggling to ineligible on an already-draining node is refused with an explanation instead of being sent as a no-op.
  - Draining nodes show **how many allocations are left** to evict, one extra API call per draining node (`NODE_FETCH_CONCURRENCY = 4`), best-effort: a failure leaves the count unknown rather than breaking the list.
  - `NodeSummary` now carries `eligibility` (and `drainRemaining`), so the **snapshot report also flags ineligible nodes** — a node that accepts no new allocations is a morning-check problem exactly like a drain. Tree and snapshot share one definition, `nodeNeedsAttention`.
  - Pure logic in `core/nodes.ts` (`drainBody`, `stopDrainBody`, `eligibilityBody`, `countActiveAllocs`, `nodeStateLabel`, `nodeNeedsAttention`), tested: the drain deadline goes out in **nanoseconds** while `-1` ("no deadline") must pass through unmultiplied, and terminal allocations must not count as holding a drain back.
  - Integration test against real Nomad: eligibility toggled both ways, then a drain started and cancelled, asserting the state each time. Verified **48/48 green** in the Docker suite.

## 0.12.0

### Added

- **Live resource usage** (NOM-16): *Resource Usage vs Requested* on the job context menu — for every running allocation it reads `GET /v1/client/allocation/:id/stats` and joins the measured CPU (MHz) and resident memory (MiB) with what the spec requests, in a task × alloc table with percentages. Two verdicts on top: **⚠ near the memory limit** (≥90% of the request — the OOM kill about to happen) and **💤 oversized reservation** (≤20% — capacity the cluster is holding for nobody).
  - Two cases are deliberately *not* flagged: a task with no request in the spec (nothing to compare against) and a task using 0 (not yet started, not an oversized reservation). Both are covered by tests.
  - The stats endpoint is served by the *client* node, not the server: allocations are fetched with `mapPool` at concurrency 8 and one unreachable node yields an empty row set instead of voiding the whole report.
  - Pure logic in `core/resources.ts` (`taskRequests`, `parseAllocStats`, `usageFlag`, `renderResourceUsage`), tested — including the bytes→MiB conversion of `RSS`.
  - Integration test against real Nomad: a `raw_exec` job is registered, its stats are read and the request is asserted to come from the spec. Verified **43/43 green** in the Docker suite.

## 0.11.0

### Added

- **Placement diagnostics** (NOM-15): *Explain Placement Failures* on the job context menu — reads the job's evaluations (`GET /v1/job/:id/evaluations`) and turns the scheduler's `FailedTGAllocs` counters into sentences: nodes filtered by a named `constraint`, exhausted dimensions (`memory`, `cpu`, …), class filtering, exhausted quotas, datacenters with no available nodes. The report names the evaluation and ends with the typical fixes.
  - Jobs that look stuck (`desired > 0`, nothing running, not dead) are also **flagged in the tree** with `⚠ cannot place` and a tooltip carrying the first reason. Only those jobs are checked — one extra API call each, `PLACEMENT_CONCURRENCY = 4` — and a failed check is swallowed so diagnostics can never take the tree down.
  - Pure logic in `core/placement.ts` (`explainMetric`, `latestPlacementFailures`, `placementSummary`, `renderPlacementReport`), tested: counters at zero must not become noise, an empty metric still yields an explanation, and the newest evaluation that *actually failed* wins over a more recent successful one.
  - Integration test against real Nomad: a job constrained to a non-existent kernel is registered, and the report is asserted to name the failing constraint. Verified **38/38 green** in the Docker suite (Nomad 1.9.5).

## 0.10.0

Opens the v0.5 — Deep dive milestone.

### Added

- **Job version history + revert** (NOM-14): two commands on the job context menu.
  - *Job Version History (diff between versions)* — `GET /v1/job/:id/versions?diffs=true` → a markdown report with the history table (version, submit time, stable flag, current) plus the diff of the picked version against the immediately older one. Answers "what did the last deploy change?".
  - *Revert Job to a Previous Version* — plans the chosen old spec against the running job and opens that diff **before** asking, so the rollback is visible in advance; the preview is best-effort and never blocks a confirmed revert. Confirmation by typing the job id, like Stop Job (`ACTIONS.revertJob`, destructive + `requireType`). Nomad re-registers the old spec as a new version, so nothing is lost from the history.
  - New API: `versions()` and `revertJob()`; pure parsing/rendering in `core/versions.ts` (`parseVersions`, `versionPickItem`, `renderVersionHistory`, `renderVersionDiff`), tested — including the nanosecond→ISO conversion of `SubmitTime` and the `Diffs[i] ↔ Versions[i+1]` pairing, where an off-by-one would silently attribute changes to the wrong version.
  - The diff renderer is now shared: `renderJobDiffLines` extracted from `renderPlanDiff` in `core/report.ts` and reused by the version diff (same output as before).
- Integration test against a real Nomad: register two versions, read the history, assert the diff mentions `Count`, then revert to the oldest and verify the count goes back. Verified **33/33 green** in the Docker suite (Nomad 1.9.5), integration included.

### Added

- New backlog milestone **v0.5 — Deep dive** (`BACKLOG.md`): job version history + revert (`NOM-14`), placement diagnostics for jobs that will not schedule (`NOM-15`), live resource usage vs requested (`NOM-16`), node drain & eligibility (`NOM-17`), tree filter (`NOM-18`), and the chore of translating the remaining Italian in `src/`/`test/` to English (`NOM-19`). Planning only — no code changes; the milestone and its issues land on GitHub through the backlog sync.

## 0.9.4

### Changed

- All documentation translated to English, applying the 0.9.3 rule to the existing corpus: `CLAUDE.md`, `AGENTS.md`, `README.md`, `BACKLOG.md`, `docs/GUIDE.md`, the GitHub Pages landing page (`site/index.html`, now `lang="en"`) and every changelog entry below. This supersedes 0.9.3's note that earlier entries would be left as they were.
- Fixed a stale claim spotted while translating: the guide (§10) and the landing page described the extension as read-only, which stopped being true in 0.4.0 when the mutating actions (restart allocation, stop/start job) shipped. Both now state that mutating actions exist and are always behind an explicit confirmation.
- Code (comments, user-facing strings, test names) is still in Italian and is not covered by this release.

## 0.9.3

### Changed

- English is now the required language for everything in the repository: code (identifiers, comments, user-facing strings, error and log messages) and documentation (`README.md`, `CHANGELOG.md`, `BACKLOG.md`, `docs/`, JSDoc, commit messages, PR and issue titles/bodies). The rule is recorded in `CLAUDE.md` and `AGENTS.md`; changelog entries from this release on are written in English (earlier entries are left as they are).

## 0.9.2

Hardening of the tests over the glue that was uncovered so far.

### Added

- Integration tests for the mutating actions `restartAllocation` and `startJob`: the tests' dev agent now enables `raw_exec` (with `cores`, robust even in VMs where `CpuShares=0`), so they are verified against a genuinely *running* allocation — no longer just `stopJob`. Verified on the host and in a container.
- Deployment watch logic extracted into pure, tested functions: `deployNotification` (notifies only on transitions to terminal states) and `isDeployStalled` (running beyond the threshold). The poller in the glue now uses them.

## 0.9.1

### Added

- Docker environment for tests and demos: `Dockerfile.test` + `docker-compose.yml`. `docker compose run --rm tests` runs the whole suite (unit + **integration**) in a container with Nomad 1.9.5 pinned — verified **23/23 green**, integration included (the services run `privileged` with a writable cgroup, which the Nomad client needs). `demo` profile (`docker compose --profile demo up`): dev Nomad on `:4646` + a sample job (raw_exec, two allocations that log, including `error` lines for the grep) to point the extension at. Excluded from the `.vsix`.

## 0.9.0

Completes the v0.4 — Drift milestone.

### Added

- **Snapshot to file** (NOM-7): *Save Cluster Snapshot to File* command — writes the markdown snapshot to `nomadLens.snapshotPath` (a folder → `nomad-snapshot-<cluster>-<date>.md`, or an exact `.md` file; supports `~`, creates missing folders). Meant to be bound to an external task/scheduler for the morning report. Pure file name `snapshotFileName` in `core/report.ts`, tested.

## 0.8.0

### Added

- **Image inventory** (NOM-6): *Image Inventory (all clusters)* command — job × cluster matrix with the docker image per cell, and a `≠` marker on jobs with image drift across the clusters where they exist. Fetching with limited concurrency; pure rendering `renderImageInventory` in `core/drift.ts`, tested.

## 0.7.0

### Added

- **Compare job across clusters** (NOM-5): from the job menu, compare the same job on two clusters (picked from the configured ones) → diff table of `count`, `image`, `cpu`, `memory` and `env`, with a `≠` marker on the differences. `job(id)` API; pure logic `summarizeJob`/`compareJobSpecs`/`renderComparison` in `core/drift.ts`, tested.

## 0.6.0

Completes the v0.3 — Daily driver milestone.

### Added

- **Cross-allocation grep** (NOM-4): *Grep Logs Across Allocations* command on a job — searches a string (case-insensitive) in the `stdout`+`stderr` logs of all allocations in parallel (pool with concurrency 8), and opens a markdown report grouped by allocation with `task/type:line` positions. Pure logic `grepLogs`/`renderGrepReport` in `core/grep.ts`, tested.

## 0.5.0

### Added

- **Deployment watch** (NOM-2): a poller watches active deployments and shows progress (`healthy/desired`, canary) in a dedicated status bar item, with a state icon. Notifications on **success**, **failure/cancellation** and on **stall** (healthy allocations stuck beyond `deploymentStallSeconds`). Task group aggregation and state derivation are pure and tested in `core/deploy.ts`; `deployments()` now exposes `desired/placed/healthy/unhealthy/canaries`. Settings: `nomadLens.deploymentWatch`, `nomadLens.deploymentPollSeconds`, `nomadLens.deploymentStallSeconds`.

## 0.4.0

### Added

- **Actions with confirmation** (NOM-3): from the tree context menu — **Restart Allocation**, **Stop Job**, **Start Job**. Destructive actions require a double modal confirmation; stopping a job requires **typing the job id**; no default button (the CLAUDE.md rule on mutating commands). `restartAllocation`/`stopJob`/`startJob` APIs; pure metadata/confirmations in `core/actions.ts` (tested); `stopJob` verified in the integration tests against `nomad agent -dev`.

## 0.3.1

Hardening from the audit of the recent code.

### Fixed

- **`jobs()` no longer saturates the API**: the `desired` enrichment (a `GET /v1/job/:id` fetch for every service job, introduced in 0.2.2) now runs with limited concurrency (`JOB_FETCH_CONCURRENCY = 8`) instead of all in parallel. New pure helper `mapPool`, tested (concurrency cap + ordering).
- **Stricter OOM detection** (`taskEventIsOom`): no longer a bare `includes('oom')` (which matched "zoom"/"room" → false positives); it now requires `out of memory` / `oom killed` / `oomkilled` or the explicit `Details`.

## 0.3.0

### Added

- **Restart storm / OOM detector** (NOM-1): in the tree, allocations in a restart loop (≥3 restarts) or killed by **OOM** are highlighted with a ⚠ icon, a description and a tooltip. OOM is derived from the task events already included in the `allocations` response (no extra request). Pure and tested logic: `taskEventIsOom` (`core/api.ts`) and `allocWarnings` (`core/report.ts`); `AllocSummary` now exposes `oom`.

## 0.2.5

### Changed

- Backlog and milestones reorganized: a new **v0.2 — Released** milestone with the features shipped in the 0.2.x series (automatic publish, backlog sync, vulncheck auto-fix `NOM-11`, hardening from the audit `NOM-12`, guide + website `NOM-13`). The planned milestones renamed consistently with the real versions (`v0.3 — Daily driver`, `v0.4 — Drift`); `NOM-8` reduced to the screenshots only. GitHub milestones/issues realigned.

## 0.2.4

### Changed

- Restyled the GitHub Pages landing page (`site/index.html`): dark theme with a neon-green accent, aurora + dot-grid background, animated gradient title, glowing logo, "terminal" mock with a sample snapshot/plan, glass cards with a luminous border on hover. Still self-contained and dependency-free; animations disabled with `prefers-reduced-motion`.

## 0.2.3

### Added

- GitHub Pages: self-contained landing page in `site/index.html` (hero with the logo, features, install, link to the guide; light/dark theme, zero dependencies) + `pages.yml` workflow that publishes on push to `main` and auto-enables Pages (`configure-pages` with `enablement: true`). URL: https://allan-nava.github.io/nomad-lens/. Excluded from the `.vsix`.

## 0.2.2

Hardening from the internal audit.

### Fixed

- **Authoritative `desired`** (`jobHealth` core): the desired count of service jobs now comes from the task groups' real `Count` (`GET /v1/job/:id`), instead of being approximated with `Running+Queued+Starting` from the summary. Before, a running but under-scaled job with no queued allocations looked "healthy"; now it is correctly **degraded**. Fetched in parallel, with a fallback to the summary if it fails.
- **Request timeouts**: `getJson`/`postJson`/`logsTail` abort after `REQUEST_TIMEOUT_MS` (8s) — an unreachable cluster no longer leaves the tree hanging.
- **Truncated error bodies** (500 chars) in messages, so raw cluster output is not spilled into notifications.
- **Least-privilege CI**: default `permissions` set to `contents: read`; only the `package` job (which creates the release) gets `contents: write`.

### Added

- **Cleartext token warning**: if a cluster uses an ACL token over `http://` towards a non-local host, the extension warns (once per cluster). Pure logic `tokenSentInClear` in `core/api.ts`.

## 0.2.1

### Added

- Full user guide in `docs/GUIDE.md` (installation, cluster/token config, explorer, plan diff, logs, incident bundle, snapshot, vulncheck auto-fix, troubleshooting, security), linked from the README. Excluded from the `.vsix`.

## 0.2.0

### Added

- `go.diagnostic.vulncheck` auto-fix: on activation (`onStartupFinished`), if the Go extension is installed and the effective value is the broken `"Prompt"` default (which gopls rejects with `Invalid settings: ... invalid option "Prompt"`), Nomad Lens corrects it to a valid value. Transparent (notification with "Undo") and reversible. It fixes in the right scope (global for the implicit default, workspace if the override lives there).
  - New settings: `nomadLens.autoFixGoVulncheck` (bool, default `true`) and `nomadLens.goVulncheckFixValue` (`"Off"` | `"Imports"`, default `"Off"`).
  - Pure and tested decision logic in `src/core/vulncheck.ts` (no `vscode` import); I/O glue in `extension.ts`.

## 0.1.7

### Fixed

- `publisher` in `package.json` corrected to `allannava95` (it was the `allan-nava` placeholder, which did not match the real publisher on the Marketplace). Unblocks the automatic publish: the extension id becomes `allannava95.nomad-lens`. The `VSCE_PAT` in CI must belong to this publisher.

## 0.1.6

### Changed

- `typescript` bumped to `^7.0.2` (native compiler, dependabot #16). Typecheck toolchain only: the bundle stays esbuild. Verified with a clean `npm ci` that the lockfile brings all the per-platform native binaries (including `@typescript/typescript-linux-x64` for CI) and that `tsc --noEmit` + tests + build pass. The PR failure was due only to the pre-fix `types` base (0.1.3), not to the bump.

## 0.1.5

### Added

- Regression test (TDD) `hcl fixture: no single-line block with multiple arguments`: it lints the reference HCL spec and blocks upfront the syntax that HCL2 rejects. It runs **always**, even without the `nomad` binary (unlike the integration tests), so the bug fixed in 0.1.4 can no longer slip through locally. HCL fixture moved to module level.

## 0.1.4

### Fixed

- Red integration tests in CI (Nomad 1.9.5): the HCL fixture used a single-line block with two arguments (`resources { cpu = 100, memory = 64 }`), syntax rejected by HCL2. `config` and `resources` rewritten as multi-line blocks. It did not surface locally because the integration tests are skipped without the `nomad` binary.

## 0.1.3

### Fixed

- Red CI build (`npx tsc --noEmit`) due to unresolved Node/undici global types (`process`, `fetch`, `URL`, `AbortController`, `TextDecoder`, `Buffer`, `console`, `setTimeout`): it depended on `@types` package auto-discovery, which is not deterministic in the runner. `tsconfig.json` now declares `"types": ["node", "vscode"]` explicitly.

## 0.1.2

### Added

- Extension logo (`media/logo.png`, 512px): a magnifying glass framing the Nomad hexagon, brand green on a dark squircle. Set as `icon` in `package.json` for the Marketplace. Source in `media/logo.svg`.

### Changed

- `.vscodeignore` cleaned up: the `.vsix` no longer ships internal files (`CLAUDE.md`, `AGENTS.md`, `BACKLOG.md`, `.claude/`, `scripts/`, source maps, `package-lock.json`). It now contains only runtime + Marketplace assets.

## 0.1.1

### Added

- Automatic publish to the stores on a `v*` tag: new `publish` job in `ci.yml` that runs `vsce publish` (VS Code Marketplace) and, if the `OVSX_PAT` secret is configured, `ovsx publish` (Open VSX). Required secret: `VSCE_PAT`. `marketplace` environment for an optional manual approval gate.
- Release guard in the `package` job: the pipeline aborts if the tag does not match `version` in `package.json`.
- Automatic backlog sync: workflow `backlog-sync.yml` + `scripts/backlog-sync.mjs` (zero dependencies, native fetch) that makes GitHub milestones and issues a mirror of `BACKLOG.md`. Every `##` heading → a milestone, every `NOM-n` item → an issue anchored via a `<!-- backlog:NOM-n -->` marker; checked items close their issue, fully-checked sections close their milestone. Idempotent, with a dry-run from `workflow_dispatch`.

## 0.1.0

- Cluster explorer: jobs with real health (incomplete running = degraded), allocations with restart counts, tasks, nodes, deployments.
- Plan diff repo-vs-running: server-side HCL parse + plan with the diff rendered beside the editor.
- Streaming log follow (stdout/stderr) in dedicated Output channels.
- Incident bundle: `incidents/<date>-<job>-<alloc>/` with report.md (event timeline) + attached logs.
- Cluster snapshot report in markdown (problems on top, full table).
- Multi-cluster from settings; ACL tokens only from env vars, never displayed.
