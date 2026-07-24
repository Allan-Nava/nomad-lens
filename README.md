# Nomad Lens

**HashiCorp Nomad operations inside VS Code** — the place where you already edit your job specs.

🌐 **[Sito / landing page →](https://allan-nava.github.io/nomad-lens/)** · 📖 **[Guida d'uso completa →](docs/GUIDE.md)**

## Features

- **Cluster explorer** — jobs with real health (a `running` job missing allocations shows as **degraded**), allocations with restart counts, tasks, nodes (ready/drain), active deployments. Multi-cluster via settings, one click to switch.
- **Plan diff, repo vs running** — open a `.nomad`/`.hcl` job spec and run *Plan Current Job File*: the spec is parsed server-side and planned against the running job, and the diff opens beside your editor. If the diff contains more than you expected, you know **before** deploying.
- **Live task logs** — follow stdout/stderr of any task in an Output channel (streaming, not polling); multiple streams side by side.
- **Incident bundle in one click** — for a failed allocation: `incidents/<date>-<job>-<alloc>/` with a ready-to-fill `report.md` (task event timeline, node, restart counts) plus the tail of stdout/stderr as attached log files. Your incident report is half-written before you start.
- **Cluster snapshot** — one command generates a markdown health report: problems first (degraded jobs, drained nodes, stuck deployments), full job table after. Perfect for the morning check or as a preflight baseline.

## Go `vulncheck` auto-fix

If you also use the Go extension, its `go.diagnostic.vulncheck` setting ships a default of `"Prompt"` that the `gopls` language server rejects (`Invalid settings: … invalid option "Prompt"`). On activation Nomad Lens detects this and sets a valid value (`"Off"` by default), with a dismissable notification and an undo action. Opt out with `nomadLens.autoFixGoVulncheck: false`, or prefer active scanning with `nomadLens.goVulncheckFixValue: "Imports"`.

## Security

ACL tokens are read from an environment variable (you configure the variable *name* per cluster via `tokenEnv`) — tokens are never stored in settings and never displayed.

## Settings

```jsonc
"nomadLens.clusters": [
  { "name": "dev",     "address": "http://nomad-dev.example:4646" },
  { "name": "prod",    "address": "https://nomad.example:4646", "namespace": "default", "tokenEnv": "NOMAD_TOKEN_PROD" }
]
```

## Development

```bash
npm install
npm test             # unit tests + integration against a throwaway `nomad agent -dev`
npm run build        # bundle to dist/
# F5 in VS Code launches the Extension Development Host
```

### Con Docker

```bash
docker compose run --rm tests      # suite completa (unit + integrazione) in container, Nomad pinnato
docker compose --profile demo up   # Nomad dev su http://127.0.0.1:4646 + job di esempio
```

`tests` esegue tutta la suite in modo riproducibile (gli stessi check della CI, con `nomad agent -dev` usa e getta interno). Il profilo `demo` avvia un Nomad persistente con un job di esempio (due allocation che loggano, con righe `error` per provare il grep): puntaci l'estensione via `nomadLens.clusters` → `http://127.0.0.1:4646`. Richiede Docker Desktop (i servizi girano `privileged` con cgroup writable perché il client Nomad crea i propri cgroup).

The core (API client + report renderers) has no VS Code dependency and lives in `src/core/`. The integration test spins up `nomad agent -dev` on a random port, registers a sample job, and verifies plan diffs; if `nomad` is not installed the integration tests are skipped. Zero runtime dependencies: the Nomad HTTP API is consumed with Node's native fetch.

## Release & automation

Everything is driven by CI (`.github/workflows/`):

- **Publish on tag** — pushing a `v*` tag runs the full test suite, packages the `.vsix` onto the GitHub Release, then publishes to the **VS Code Marketplace** (`vsce publish`) and, if configured, **Open VSX** (`ovsx publish`). A guard aborts if the tag doesn't match `version` in `package.json`.
  - Required secret: `VSCE_PAT` — an Azure DevOps Personal Access Token for the Marketplace publisher named in `package.json` (`publisher`). See the [vsce publishing docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
  - Optional secret: `OVSX_PAT` — an [Open VSX](https://open-vsx.org) token. Omit it and that step is skipped.
  - The `publish` job uses the `marketplace` [environment](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment) — add required reviewers there if you want a manual approval gate before each store publish.
- **Backlog sync** — editing `BACKLOG.md` on `main` mirrors it to GitHub **milestones + issues** (`scripts/backlog-sync.mjs`, zero deps, native fetch). Each `## …` heading becomes a milestone, each `NOM-n` item an issue (anchored by a hidden `<!-- backlog:NOM-n -->` marker so retitling never duplicates). Checked items close their issue; a fully-checked section closes its milestone. `BACKLOG.md` stays the single source of truth — GitHub is a read-only mirror. Run it manually (with a dry-run toggle) from the Actions tab.

To cut a release: bump `version` in `package.json`, add a `CHANGELOG.md` entry, commit, then `git tag -a vX.Y.Z -m "Release X.Y.Z" && git push --follow-tags`.

## License

MIT
