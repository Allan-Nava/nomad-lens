# Nomad Lens

**HashiCorp Nomad operations inside VS Code** — the place where you already edit your job specs.

## Features

- **Cluster explorer** — jobs with real health (a `running` job missing allocations shows as **degraded**), allocations with restart counts, tasks, nodes (ready/drain), active deployments. Multi-cluster via settings, one click to switch.
- **Plan diff, repo vs running** — open a `.nomad`/`.hcl` job spec and run *Plan Current Job File*: the spec is parsed server-side and planned against the running job, and the diff opens beside your editor. If the diff contains more than you expected, you know **before** deploying.
- **Live task logs** — follow stdout/stderr of any task in an Output channel (streaming, not polling); multiple streams side by side.
- **Incident bundle in one click** — for a failed allocation: `incidents/<date>-<job>-<alloc>/` with a ready-to-fill `report.md` (task event timeline, node, restart counts) plus the tail of stdout/stderr as attached log files. Your incident report is half-written before you start.
- **Cluster snapshot** — one command generates a markdown health report: problems first (degraded jobs, drained nodes, stuck deployments), full job table after. Perfect for the morning check or as a preflight baseline.

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

The core (API client + report renderers) has no VS Code dependency and lives in `src/core/`. The integration test spins up `nomad agent -dev` on a random port, registers a sample job, and verifies plan diffs; if `nomad` is not installed the integration tests are skipped. Zero runtime dependencies: the Nomad HTTP API is consumed with Node's native fetch.

## License

MIT
