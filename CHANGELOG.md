# Changelog

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
