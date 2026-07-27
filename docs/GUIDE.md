# Nomad Lens — User guide

HashiCorp Nomad operations inside VS Code: browse clusters/jobs/allocations/tasks, follow logs as a stream, **diff the spec in your repo against the running job** before deploying, export an incident bundle in one click and generate a cluster snapshot. Zero runtime dependencies: it talks to the Nomad HTTP API through native `fetch`.

---

## 1. Installation

- **Marketplace**: search for "Nomad Lens" (publisher `allannava95`) and install.
- **From a `.vsix`**: `code --install-extension nomad-lens-<version>.vsix`, or from the Extensions view → `…` → *Install from VSIX*.

After installing, the **Nomad** icon appears in the Activity Bar (side bar).

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

| Field       | Required | Notes |
|-------------|:---:|------|
| `name`      | ✔ | Label shown in the status bar and in the picker. |
| `address`   | ✔ | `http(s)://host:4646`. |
| `namespace` |   | Nomad namespace; appended as a query param to every call. |
| `tokenEnv`  |   | **Name** of the environment variable holding the ACL token. |

### ACL tokens — security rule
The token is **never** put in the settings. In `tokenEnv` you name an env var; the extension reads the token from it at runtime and sends it as the `X-Nomad-Token` header. The token is never stored nor displayed.

Make sure VS Code can see that env var (export it in the shell profile you launch `code` from, or use the `.env`/launcher of your setup). For example:

```bash
export NOMAD_TOKEN_PROD="…"   # in your ~/.zshrc, read before starting VS Code
```

## 3. The cluster explorer

Open the **Nomad** panel. You will see three sections:

- **Jobs** — every job with its **real health**. Note: a `running` job with missing or failed allocations is marked **degraded** (🟠), not "running". Expanding a job shows its allocations (excluding `complete` ones), and inside each one its tasks.
- **Nodes** — nodes with their `ready`/other status and the `drain` flag.
- **Deployments** — active/recent deployments with status and description.

Handy commands from the view:
- **Refresh** (the ↻ icon in the title) — reload.
- **Select Cluster** — switch the active cluster (also from the status bar at the bottom, `$(rocket) nomad: <cluster>`). Switching cluster stops every open log stream.

## 4. Plan diff: repo vs running

The heart of the "know what you are changing before deploying" workflow.

1. Open a `.nomad` or `.hcl` job spec.
2. Right-click in the editor → **Nomad Lens: Plan Current Job File (diff vs running)** (or use the Command Palette).
3. The extension sends the spec to `POST /v1/jobs/parse` (HCL→JSON, `Canonicalize: true`), then **plans** it against the running job and opens the **diff beside** your editor.

How to read it:
- `~ field: old → new` (modified), `+` (added), `-` (removed), recursively over TaskGroup → Task → Config.
- `No differences …` if the spec matches what is running.
- It highlights `⚠ Placement failed for: …` and the plan's `⚠ Warnings`.

If the diff contains more than you expected, **you find out before** applying.

## 4b. Job version history and revert

Nomad keeps every registered version of a job. Right-click a job → **Job Version History (diff between versions)**: pick a version and Nomad Lens opens a markdown report with the full history table (version, submit time, stable flag, which one is current) and the diff of the version you picked against the immediately older one — the answer to "what did the last deploy actually change?".

To roll back, right-click the job → **Revert Job to a Previous Version**:

1. Pick one of the older versions (the current one is not offered).
2. Nomad Lens **plans that old spec against what is running** and opens the diff beside your editor: you see exactly what the revert would change *before* deciding. If the preview cannot be produced the revert is not blocked — you get a warning and the confirmation still asks.
3. Confirm by **typing the job id**, like Stop Job. Reverting replaces the running spec, so it gets the strongest confirmation the extension has.

Nomad implements the revert by re-registering the old spec as a **new** version: nothing is deleted from the history, and reverting a revert is just another revert.

> Timestamps: Nomad reports submit times in nanoseconds; the report shows them as ISO dates.

## 4c. Why is my job not scheduling?

A job stuck in `pending` with no allocations is a *scheduling* problem, not a task problem, and Nomad records the reason in the evaluation rather than in any log. Right-click the job → **Explain Placement Failures**: Nomad Lens reads the evaluations and renders the scheduler's counters as sentences, for example:

- `3 nodes filtered by constraint ${attr.kernel.name} = plan9`
- `not enough memory on 2 nodes`
- `no nodes available in datacenter dc1`
- `quota exhausted: prod`

Jobs in that state are also marked in the tree with `⚠ cannot place`, with the first reason in the tooltip — so you notice before you go looking. Only jobs that already look stuck are checked (one extra API call each), and if the check fails the tree keeps working normally.

If there are no placement failures the report says so and points you at the allocations instead: the scheduler did its job and the tasks are the ones failing to start.

## 5. Streaming logs

- Expand job → alloc → task and click the task (or right-click → **Follow Task Logs**).
- Pick `stdout` or `stderr`: a dedicated Output channel opens and **streams** (it does not poll), and multiple streams can sit side by side.
- **Stop Following Logs** from the Command Palette stops a stream. Streams are also closed on cluster switch and on deactivation (no hanging connections).

## 6. Incident bundle in one click

On a problematic allocation (right-click → **Export Incident Bundle for Allocation**):

- It creates `incidents/<date>-<job>-<alloc>/` in your working folder with:
  - `report.md` — alloc/node/restart metadata, the tasks' **event timeline** (ISO timestamps), the list of attached logs, and an *Analysis* section to fill in (cause/impact/remediation).
  - `<task>.stdout.log` / `<task>.stderr.log` — the tail of each task's logs.

The report opens right away: your incident write-up is already half done.

> Requires a folder open in VS Code (a workspace folder): that is where the bundle is saved.

## 6b. Actions with confirmation (mutating)

From the tree context menu, actions that **change** the cluster — always behind an explicit confirmation, never a default:

- **Restart Allocation** (on an alloc) — restarts the allocation's tasks. Double modal confirmation.
- **Stop Job** (on a job) — deregisters the job. Confirmation by **typing the job id** (the strongest one).
- **Start Job** (on a job) — re-reads the job spec, clears `Stop` and re-registers it. Single confirmation.

None of these has a default button: `Enter` does not trigger them.

## 6c. Deployment watch

While a deployment is active, the status bar shows live progress — `$(sync~spin) deploy <job> healthy/desired · canary N` — and you get a notification when:

- the deployment **completes** (✅) or **fails/is cancelled** (❌);
- the deployment **stalls** (healthy allocations stuck beyond `deploymentStallSeconds`).

Settings: `nomadLens.deploymentWatch` (on/off, default on), `nomadLens.deploymentPollSeconds` (default 5), `nomadLens.deploymentStallSeconds` (default 90).

## 6d. Cross-allocation grep

Right-click a job → **Grep Logs Across Allocations**: type a string and Nomad Lens searches (case-insensitive) the `stdout`+`stderr` logs of **all** the job's allocations, in parallel. The result is a markdown report grouped by allocation, with a `task/type:line` position for every match. Useful for "who logged this error?" on a job with many instances.

## 6e. Compare a job across clusters (drift)

Right-click a job → **Compare Job Across Clusters**: pick two clusters and Nomad Lens compares the same job, producing a diff table of `count`, `image`, `cpu`, `memory` and `env` (differing rows are marked `≠`). Useful for spotting drift between `dev` and `prod`.

## 6f. Image inventory

From the Nomad view title → **Image Inventory (all clusters)**: Nomad Lens queries every configured cluster and produces a **job × cluster** matrix with the docker image per cell; jobs with different images across clusters are marked `≠`. The at-a-glance answer to "who is on the old tag".

## 6g. Resource usage vs requested

Right-click a job → **Resource Usage vs Requested**: for every running allocation Nomad Lens reads the live stats from the client node and puts them next to what the spec asks for, per task:

| Task | Alloc | CPU used/req | Mem used/req | |
|---|---|---|---|---|
| app | a1b2c3d4 | 480/500 MHz (96%) | 250/256 MiB (98%) | ⚠ near the limit |
| idle | e5f6a7b8 | 5/500 MHz (1%) | 10/256 MiB (4%) | 💤 oversized |

Two things get called out: tasks at **≥90%** of their memory request (the OOM kill that is about to happen — raise `memory`) and tasks at **≤20%** (a reservation the cluster is holding for nobody). Tasks with no request in the spec, and tasks that have not started yet, are left unflagged rather than guessed at.

Stats come from the *client* node that runs the allocation, so a node being unreachable removes those rows from the report instead of failing it.

## 7. Cluster snapshot

**Nomad Lens: Cluster Snapshot Report** generates a health markdown:
- a summary (total jobs/problems, non-ready/drain nodes, non-healthy deployments);
- **problems on top** (degraded/pending/failed jobs, draining nodes, stalled deployments);
- the full table of all jobs below.

Perfect for the morning check or as a preflight baseline before an intervention.

**Saving it to a file** — the **Save Cluster Snapshot to File** command writes the snapshot to `nomadLens.snapshotPath`. If the path is a folder (or empty → the working folder) the file is `nomad-snapshot-<cluster>-<date>.md`; if it ends in `.md` it is the exact file; `~` is supported. This lets you bind the command to a task or an external scheduler for the morning report.

## 8. `go.diagnostic.vulncheck` auto-fix

If you also use the Go extension, its `go.diagnostic.vulncheck: "Prompt"` default is rejected by `gopls` (`Invalid settings: … invalid option "Prompt"`). At startup Nomad Lens detects the case and sets a valid value, with a notification and the option to undo.

- `nomadLens.autoFixGoVulncheck` (default `true`) — turns the auto-fix off.
- `nomadLens.goVulncheckFixValue` (`"Off"` default | `"Imports"`) — the value to use; `"Imports"` enables vulnerability scanning with govulncheck.

## 9. Troubleshooting

| Symptom | Cause / remedy |
|---|---|
| "No cluster configured" | Add `nomadLens.clusters` to your settings. |
| `error: … HTTP 403` in the tree | Missing or invalid ACL token: check that the env var named in `tokenEnv` is exported **before** starting VS Code. |
| `HTTP 400 Failed to parse job` on plan | The HCL spec is not valid for the cluster's Nomad version (e.g. a single-line block with multiple arguments). |
| Plan says "Open a .nomad/.hcl job spec" | The active file does not have a `.nomad`/`.hcl` extension. |
| Logs do not start | The allocation is no longer on the node, or the task has not produced output yet. |

## 10. Security in short

- ACL tokens **only** from env vars (`tokenEnv`), never in settings/logs/output.
- Most commands are read-only. The mutating ones (restart allocation, stop/start job — see §6b) always require an explicit confirmation and never have a default button.
- Use `https://` for remote clusters: over `http://` the ACL token would travel in cleartext.
