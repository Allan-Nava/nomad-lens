# Nomad Lens — User guide

HashiCorp Nomad operations inside VS Code: browse clusters/jobs/allocations/tasks, follow logs as a stream, **diff the spec in your repo against the running job** before deploying, see what the last deploy changed and roll it back, find out why a job will not schedule, export an incident bundle in one click and generate a cluster snapshot.

Zero runtime dependencies: it talks to the Nomad HTTP API through Node's native `fetch`. ACL tokens are read from environment variables only and are never stored or displayed.

---

## 1. Installation

- **Marketplace**: search for "Nomad Lens" (publisher `allannava95`) and install.
- **From a `.vsix`**: `code --install-extension nomad-lens-<version>.vsix`, or from the Extensions view → `…` → *Install from VSIX*.

After installing, the **Nomad** icon appears in the Activity Bar (side bar).

Requirements: VS Code 1.85 or newer. Nothing else — no CLI, no SDK. Network access from your machine to the Nomad HTTP API (`:4646` by default) is enough.

## 2. Configuring clusters

Settings live in `settings.json` (user or workspace), under `nomadLens.clusters`:

```jsonc
"nomadLens.clusters": [
  { "name": "dev",  "address": "http://nomad-dev.example:4646" },
  {
    "name": "prod",
    "address": "https://nomad.example:4646",
    "namespace": "default",
    "tokenEnv": "NOMAD_TOKEN_PROD"   // the NAME of the env var, not the token
  }
]
```

| Field | Required | Notes |
|---|:---:|---|
| `name` | ✔ | Label shown in the status bar and in the picker. |
| `address` | ✔ | `http(s)://host:4646`. |
| `namespace` | | Nomad namespace; appended as a query param to every call. |
| `tokenEnv` | | **Name** of the environment variable holding the ACL token. |

The first cluster in the list is the one selected at startup. Switch with **Select Cluster** (also from the status bar item `$(rocket) nomad: <cluster>`).

### ACL tokens — the security rule

The token is **never** put in the settings. In `tokenEnv` you name an env var; the extension reads the token from it at runtime and sends it as the `X-Nomad-Token` header. The token is never stored, logged or displayed.

Make sure VS Code can see that env var (export it in the shell profile you launch `code` from, or use the `.env`/launcher of your setup):

```bash
export NOMAD_TOKEN_PROD="…"   # in your ~/.zshrc, read before starting VS Code
```

If a cluster uses a token over plain `http://` towards a non-local host, Nomad Lens warns you once per cluster: the token would travel in cleartext.

## 3. The cluster explorer

Open the **Nomad** panel. You will see three sections:

- **Jobs** — every job with its **real health**. A `running` job with missing or failed allocations is marked **degraded** (🟠), not "running": that distinction is the point of the whole extension. Expanding a job shows its allocations (excluding `complete` ones), and inside each one its tasks.
- **Nodes** — nodes with status, drain progress and scheduling eligibility.
- **Deployments** — active/recent deployments with status and description.

Allocations carry their own warnings: an allocation killed by **OOM** or stuck in a **restart loop** (≥3 restarts) shows a ⚠ with the reason, derived from the task events already present in the list — no extra API call.

### Filtering the list

On a cluster with hundreds of jobs, the list is only useful if you can cut it down:

- **Filter Jobs by Name** (funnel icon) — keeps the jobs whose id contains what you type, case-insensitively.
- **Show Problem Jobs Only** (⚠ icon) — a toggle that keeps only degraded, pending, failed or lost jobs, by *effective* health, so an under-scaled `running` job counts as a problem.
- **Clear Job Filter** — removes both.

The two criteria are ANDed. While a filter is active the list starts with an entry like `filter: 2/24 · "web" · problems only`; click it to clear. The filter is always shown on purpose — a shortened list must never look like an empty cluster.

## 4. Plan diff: repo vs running

The heart of the "know what you are changing before deploying" workflow.

1. Open a `.nomad` or `.hcl` job spec.
2. Right-click in the editor → **Plan Current Job File (diff vs running)** (or use the Command Palette).
3. The extension sends the spec to `POST /v1/jobs/parse` (HCL→JSON, `Canonicalize: true`), then **plans** it against the running job and opens the **diff beside** your editor.

How to read it:

- `~ field: old → new` (modified), `+` (added), `-` (removed), recursively over TaskGroup → Task → Config.
- `No differences: the job spec matches the running one.` if the spec matches what runs.
- It highlights `⚠ Placement failed for: …` and the plan's `⚠ Warnings`.

If the diff contains more than you expected, **you find out before** applying.

## 5. Job version history and revert

Nomad keeps every registered version of a job. Right-click a job → **Job Version History (diff between versions)**: pick a version and Nomad Lens opens a report with the full history table (version, submit time, stable flag, which one is current) and the diff of the version you picked against the immediately older one — the answer to "what did the last deploy actually change?".

To roll back, right-click the job → **Revert Job to a Previous Version**:

1. Pick one of the older versions (the current one is not offered).
2. Nomad Lens **plans that old spec against what is running** and opens the diff beside your editor: you see exactly what the revert would change *before* deciding. If the preview cannot be produced the revert is not blocked — you get a warning and the confirmation still asks.
3. Confirm by **typing the job id**, like Stop Job. Reverting replaces the running spec, so it gets the strongest confirmation the extension has.

Nomad implements the revert by re-registering the old spec as a **new** version: nothing is deleted from the history, and reverting a revert is just another revert.

> Nomad reports submit times in nanoseconds; the report shows them as ISO dates.

## 6. Why is my job not scheduling?

A job stuck in `pending` with no allocations is a *scheduling* problem, not a task problem, and Nomad records the reason in the evaluation rather than in any log. Right-click the job → **Explain Placement Failures**: Nomad Lens reads the evaluations and renders the scheduler's counters as sentences, for example:

- `3 nodes filtered by constraint ${attr.kernel.name} = plan9`
- `not enough memory on 2 nodes`
- `no nodes available in datacenter dc1`
- `quota exhausted: prod`

Jobs in that state are also marked in the tree with `⚠ cannot place`, with the first reason in the tooltip — so you notice before you go looking. Only jobs that already look stuck are checked (one extra API call each, four at a time), and if the check fails the tree keeps working normally.

If there are no placement failures the report says so and points you at the allocations instead: the scheduler did its job and the tasks are the ones failing to start.

## 7. Streaming logs

- Expand job → alloc → task and click the task (or right-click → **Follow Task Logs**).
- Pick `stdout` or `stderr`: a dedicated Output channel opens and **streams** (it does not poll), and multiple streams can sit side by side.
- **Stop Following Logs** from the Command Palette stops a stream. Streams are also closed on cluster switch and on deactivation, so no connection is left hanging.

## 8. Cross-allocation grep

Right-click a job → **Grep Logs Across Allocations**: type a string and Nomad Lens searches (case-insensitive) the `stdout`+`stderr` logs of **all** the job's allocations, in parallel (eight at a time). The result is a markdown report grouped by allocation, with a `task/type:line` position for every match.

This is the answer to "which instance logged that error?" on a job with many allocations, without opening ten log streams by hand.

## 9. Incident bundle in one click

On a problematic allocation (right-click → **Export Incident Bundle for Allocation**):

- It creates `incidents/<date>-<job>-<alloc>/` in your working folder with:
  - `report.md` — alloc/node/restart metadata, the tasks' **event timeline** (ISO timestamps), the list of attached logs, and an *Analysis* section to fill in (cause/impact/remediation).
  - `<task>.stdout.log` / `<task>.stderr.log` — the tail of each task's logs.

The report opens right away: your incident write-up is already half done.

> Requires a folder open in VS Code (a workspace folder): that is where the bundle is saved.

## 10. Mutating actions on jobs

From the tree context menu, actions that **change** the cluster — always behind an explicit confirmation, never a default button:

| Action | Confirmation |
|---|---|
| **Restart Allocation** | Double modal confirmation. |
| **Stop Job** — deregisters the job | Type the **job id**. |
| **Start Job** — re-reads the spec, clears `Stop`, re-registers | Single confirmation. |
| **Revert Job** — see §5 | Type the **job id**, after the diff preview. |

None of these has a default button: `Enter` does not trigger them.

## 11. Node drain and eligibility

Nodes have their own context menu:

- **Toggle Node Scheduling Eligibility** — makes the node ineligible (no *new* allocations land there; the running ones stay) or eligible again. Single confirmation, fully reversible. The classic first step before maintenance.
- **Drain Node** — evicts *every* allocation off the node. You pick a deadline first (1 hour — the Nomad default · 10 minutes · no deadline), then confirm by **typing the node name**. Allocations still running when the deadline expires are killed. This is the most destructive action in Nomad Lens; there is deliberately no `-force` equivalent (immediate kill).
- **Stop Draining Node** — cancels an ongoing drain. Single confirmation.

While a node drains, the tree shows how many allocations are still to be evicted (`ready · draining (3 allocs left)`). A draining node is ineligible by definition, so the label does not repeat both.

Ineligible and draining nodes also appear in the cluster snapshot problems section: a node that accepts no new allocations is exactly what you want to notice at the morning check, even if it never went `down`.

## 12. Deployment watch

While a deployment is active, the status bar shows live progress — `$(sync~spin) deploy <job> healthy/desired · canary N` — and you get a notification when:

- the deployment **completes** (✅) or **fails/is cancelled** (❌);
- the deployment **stalls** — the healthy count has not moved for longer than `deploymentStallSeconds`.

Turn it off with `nomadLens.deploymentWatch` if you do not want the polling.

## 13. Resource usage vs requested

Right-click a job → **Resource Usage vs Requested**: for every running allocation Nomad Lens reads the live stats from the client node and puts them next to what the spec asks for, per task:

| Task | Alloc | CPU used/req | Mem used/req | |
|---|---|---|---|---|
| app | a1b2c3d4 | 480/500 MHz (96%) | 250/256 MiB (98%) | ⚠ near the limit |
| idle | e5f6a7b8 | 5/500 MHz (1%) | 10/256 MiB (4%) | 💤 oversized |

Two things get called out: tasks at **≥90%** of their memory request (the OOM kill that is about to happen — raise `memory`) and tasks at **≤20%** (a reservation the cluster is holding for nobody). Tasks with no request in the spec, and tasks that have not started yet, are left unflagged rather than guessed at.

Stats come from the *client* node that runs the allocation, so an unreachable node removes those rows from the report instead of failing it.

## 14. Compare a job across clusters (drift)

Right-click a job → **Compare Job Across Clusters**: pick two clusters and Nomad Lens compares the same job, producing a diff table of `count`, `image`, `cpu`, `memory` and `env` (differing rows are marked `≠`). Useful for spotting the drift between `dev` and `prod` that nobody wrote down.

## 15. Image inventory

From the Nomad view title → **Image Inventory (all clusters)**: Nomad Lens queries every configured cluster and produces a **job × cluster** matrix with the docker image per cell; jobs with different images across clusters are marked `≠`. The at-a-glance answer to "who is still on the old tag".

## 16. Cluster snapshot

**Cluster Snapshot Report** generates a health markdown:

- a summary (total jobs/problems, nodes not ready or drained or ineligible, deployments not healthy);
- **problems on top** (degraded/pending/failed jobs, nodes in drain, deployments stuck);
- the full table of all jobs below.

Perfect for the morning check or as a preflight baseline before an intervention.

**Saving it to a file** — the **Save Cluster Snapshot to File** command writes the snapshot to `nomadLens.snapshotPath`. If the path is a folder (or empty → the working folder) the file is `nomad-snapshot-<cluster>-<date>.md`; if it ends in `.md` it is the exact file; `~` is supported. Bind the command to a task or an external scheduler to get the report every morning.

## 17. Recipes

Sequences that combine the commands above into the jobs you actually do.

### Before a deploy

1. Open the spec you are about to apply → **Plan Current Job File**. Read the diff: is it only what you intended?
2. Doubtful about the current state? **Cluster Snapshot Report** first — it is your preflight baseline, and it is worth keeping.
3. Apply with your usual pipeline, then watch the status bar: the **deployment watch** tells you when it is healthy, failed or stalled.
4. If it goes wrong: **Job Version History** to confirm what changed, then **Revert Job** with the diff preview in front of you.

### Morning check

1. **Cluster Snapshot Report** (or the file version, scheduled): problems are on top.
2. For every degraded job, expand it in the tree — OOM and restart loops are already flagged on the allocations.
3. For anything `pending`, **Explain Placement Failures**: capacity, constraint or datacenter?
4. Nodes not `ready`, draining or ineligible are in the snapshot too — a node left ineligible after maintenance is a classic.

### An allocation is failing

1. **Follow Task Logs** on the task, `stderr` first.
2. Many allocations, only some broken? **Grep Logs Across Allocations** on the job to find which ones logged it.
3. Suspect memory? **Resource Usage vs Requested** — at ≥90% of the request it is going to be OOM-killed.
4. Before touching anything: **Export Incident Bundle** — event timeline plus log tails, so the evidence survives the restart that erases it.

### Node maintenance

1. **Toggle Node Scheduling Eligibility** → ineligible: nothing new lands there while you prepare.
2. **Drain Node** with a deadline that fits your migration budget, and watch the remaining-allocation count go down.
3. Do the maintenance. When done, **Stop Draining Node** and toggle eligibility back.
4. Check the snapshot: no node should be left ineligible.

### Is prod really like dev?

1. **Compare Job Across Clusters** on the job you suspect: count, image, cpu, memory, env, side by side.
2. **Image Inventory (all clusters)** for the wide view: which jobs run different images where.

## 18. Command reference

Every command is prefixed with `Nomad Lens:` in the Command Palette. "Where" says where it is offered besides the palette.

| Command | Where | What it does |
|---|---|---|
| Refresh | view title | Reloads the tree. |
| Open Cluster Dashboard | view title | Cluster health dashboard webview (§23). |
| Search Jobs Across All Clusters | view title | Global job QuickPick → switch cluster + open the job panel (§23). |
| Open Job Panel | job | Job detail webview: allocations, gauges, versions, actions (§23). |
| Open Node Panel | node | Node detail webview: allocations by job, drain/eligibility (§23). |
| Select Cluster | status bar | Switches the active cluster; stops open log streams. |
| Filter Jobs by Name | view title | Substring filter on the job id (§3). |
| Show Problem Jobs Only (toggle) | view title | Keeps only unhealthy jobs (§3). |
| Clear Job Filter | view title | Removes both filters. |
| Plan Current Job File (diff vs running) | editor context (`.nomad`/`.hcl`) | Plan diff repo vs running (§4). |
| Job Version History (diff between versions) | job | History table + diff between versions (§5). |
| Revert Job to a Previous Version | job | Rollback with a plan preview, typed confirmation (§5). |
| Explain Placement Failures | job | Why the scheduler cannot place it (§6). |
| Follow Task Logs | task | Streams `stdout`/`stderr` (§7). |
| Open Log Console | task | Webview log viewer: level colours, live filter, follow/wrap (§23). |
| Stop Following Logs | palette | Stops one open stream. |
| Grep Logs Across Allocations | job | Searches every allocation's logs (§8). |
| Export Incident Bundle for Allocation | allocation | Incident folder with report and logs (§9). |
| Restart Allocation | allocation | Restarts the allocation's tasks (§10). |
| Stop Job | job | Deregisters the job — type the id (§10). |
| Start Job | job | Re-registers a stopped job (§10). |
| Drain Node | node | Evicts every allocation — type the node name (§11). |
| Stop Draining Node | node (draining) | Cancels the drain (§11). |
| Toggle Node Scheduling Eligibility | node | Eligible ⇄ ineligible (§11). |
| Resource Usage vs Requested | job | Live usage against the requests (§13). |
| Compare Job Across Clusters | job | Diff of the same job on two clusters (§14). |
| Image Inventory (all clusters) | view title | job × cluster image matrix (§15). |
| Cluster Snapshot Report | view title | Health report in markdown (§16). |
| Save Cluster Snapshot to File | palette | Writes the snapshot to `snapshotPath` (§16). |

## 19. Settings reference

| Setting | Type | Default | Notes |
|---|---|---|---|
| `nomadLens.clusters` | array | one `local` entry | Cluster list (§2). Tokens only via `tokenEnv`. |
| `nomadLens.deploymentWatch` | boolean | `true` | Watch active deployments (§12). |
| `nomadLens.deploymentPollSeconds` | number | `5` | Deployment polling interval; minimum 2. |
| `nomadLens.deploymentStallSeconds` | number | `90` | A running deployment with an unchanged healthy count for this long is reported as stalled; minimum 10. |
| `nomadLens.livePanels` | boolean | `true` | Auto-refresh the dashboard and job panels on each poll tick, in place (§23). |
| `nomadLens.snapshotPath` | string | `""` | Where *Save Cluster Snapshot to File* writes (§16). Folder, or an exact `.md` path; `~` supported. |
| `nomadLens.autoFixGoVulncheck` | boolean | `true` | The Go extension fix in §20. |
| `nomadLens.goVulncheckFixValue` | string | `"Off"` | `"Off"` or `"Imports"` (§20). |

## 20. `go.diagnostic.vulncheck` auto-fix

If you also use the Go extension, its `go.diagnostic.vulncheck: "Prompt"` default is rejected by `gopls` (`Invalid settings: … invalid option "Prompt"`). At startup Nomad Lens detects the case and sets a valid value, with a notification offering **Undo** and **Stop fixing this**.

It only steps in when the effective value is exactly `"Prompt"`: an `"Off"`/`"Imports"` you already chose is left alone. If the `"Prompt"` comes from a workspace override it is fixed in that same scope, otherwise globally.

- `nomadLens.autoFixGoVulncheck` (default `true`) — turns the auto-fix off.
- `nomadLens.goVulncheckFixValue` (`"Off"` default | `"Imports"`) — the value to write; `"Imports"` enables vulnerability scanning with govulncheck.

This has nothing to do with Nomad — it is here because it breaks the editor of anyone who writes Go, and the fix is two lines.

## 21. Troubleshooting

| Symptom | Cause / remedy |
|---|---|
| "No cluster configured" | Add `nomadLens.clusters` to your settings. |
| `error: … HTTP 403` in the tree | Missing or invalid ACL token: check that the env var named in `tokenEnv` is exported **before** starting VS Code. |
| `error: … HTTP 404` on a command | Namespace mismatch, or the object no longer exists — refresh. |
| The tree hangs, then errors | Requests abort after 8 seconds: the cluster address is unreachable from your machine (VPN? firewall?). |
| `HTTP 400 Failed to parse job` on plan | The HCL spec is not valid for the cluster's Nomad version (e.g. a single-line block with multiple arguments). |
| Plan says "Open a .nomad/.hcl job spec" | The active file does not have a `.nomad`/`.hcl` extension. |
| Logs do not start | The allocation is no longer on the node, or the task has not produced output yet. |
| Resource usage is empty | No *running* allocation, or the client node is unreachable — stats are served by the node, not the server. |
| The job list looks empty | A filter may be active: look for the `filter: …` entry at the top of the list and click it to clear. |

## 22. Security in short

- ACL tokens **only** from env vars (`tokenEnv`), never in settings, logs or output.
- Most commands are read-only. The mutating ones (restart allocation, stop/start/revert job, node drain and eligibility) always require an explicit confirmation and never have a default button; the most destructive ones require typing the target's name.
- Use `https://` for remote clusters: over `http://` the ACL token would travel in cleartext, and the extension warns you when that would happen.
- Error bodies from the cluster are truncated before being shown, so raw output is not spilled into notifications.

## 23. Visual panels, live UI and global search

Beyond the tree and the markdown reports, Nomad Lens has webview panels — dark-theme, zero-dependency, CSP-locked, and (where relevant) live.

- **Cluster dashboard** (view title, `$(dashboard)`): a job-health donut, the problem list, node drain/eligibility, and active deployments with progress bars. Click a problem job to reveal it in the tree and open its panel. Refreshes on the deployment poll.
- **Job panel** (job → *Open Job Panel*): the allocations table (status, node, restarts, OOM), inline resource gauges + sparklines vs requested, deployment progress, version history, and action buttons (restart / stop / start / revert / resource usage / why-not-placing) that go through the same confirmations as the tree commands.
- **Node panel** (click a node): status / eligibility / drain with the remaining count, allocations grouped by job, and drain / eligibility buttons.
- **Log console** (task → *Open Log Console*): a log viewer with level colouring, a live filter, and follow / wrap toggles — seeded with the tail and streamed live.
- **Visual diff**: the plan diff (§4) and the version diff (§5) open as a colour-coded, collapsible tree (added / removed / changed).
- **Global search** (view title, `$(search)` — *Search Jobs Across All Clusters*): one QuickPick over every job of every configured cluster; pick one to switch cluster and open its job panel.

The dashboard and job panels update in place on each deployment-poll tick (a small "live" pulse); turn it off with `nomadLens.livePanels`.
