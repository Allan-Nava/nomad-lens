// Unit tests (pure renderers) + integration test against a throwaway local
// `nomad agent -dev` (skipped when the binary is not available).
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import {
  NomadClient,
  JobSummary,
  JobVersionsResult,
  PlanResult,
  desiredFromJob,
  tokenSentInClear,
  taskEventIsOom,
  mapPool,
} from '../src/core/api';
import { parseVersions, versionPickItem, renderVersionHistory, renderVersionDiff } from '../src/core/versions';
import {
  explainMetric,
  latestPlacementFailures,
  placementSummary,
  renderPlacementReport,
} from '../src/core/placement';
import {
  parseAllocStats,
  renderResourceUsage,
  taskRequests,
  usageFlag,
} from '../src/core/resources';
import {
  countActiveAllocs,
  drainBody,
  eligibilityBody,
  nodeNeedsAttention,
  nodeStateLabel,
  stopDrainBody,
} from '../src/core/nodes';
import {
  renderSnapshot,
  renderPlanDiff,
  buildIncidentBundle,
  jobHealth,
  allocWarnings,
  snapshotFileName,
  jobMatchesFilter,
  isFilterActive,
  filterLabel,
  EMPTY_JOB_FILTER,
} from '../src/core/report';
import { ACTIONS, confirmMessage } from '../src/core/actions';
import {
  aggregateDeployment,
  deployStatus,
  deployStatusBar,
  deployNotification,
  isDeployStalled,
} from '../src/core/deploy';
import { grepLogs, renderGrepReport, LogSource } from '../src/core/grep';
import { summarizeJob, compareJobSpecs, renderComparison, jobImages, renderImageInventory, RawJob } from '../src/core/drift';
import { decideVulncheckFix, VulncheckState } from '../src/core/vulncheck';
import { renderMarkdown, slugify } from '../src/core/markdown';
import { donut, progressBar, sparkline } from '../src/core/webview/charts';
import { renderDashboard, renderDashboardBody } from '../src/core/webview/dashboard';
import { renderDiffTree, renderDiffPage } from '../src/core/webview/diff';
import { renderJobPanel, renderJobPanelBody, isAllowedPanelCommand, isAllocPanelCommand, renderResourceGauges } from '../src/core/webview/job';
import { stripAnsi, logLevel, classifyLine, classifyLines, renderLogConsole } from '../src/core/webview/logs';
import { JobDiff } from '../src/core/api';

// Reference spec used by the integration tests. At module level so it can be
// linted even when `nomad` is absent (integration skipped).
const HCL = `
job "lens-demo" {
  datacenters = ["dc1"]
  type = "service"
  group "web" {
    count = 2
    task "app" {
      driver = "docker"
      config {
        image = "nginx:1.25"
      }
      resources {
        cpu    = 100
        memory = 64
      }
    }
  }
}
`;

// raw_exec job: actually runs without Docker (to test the mutating actions on a
// running alloc). `cores` instead of `cpu`: in VMs CpuShares can be 0.
const RAW_HCL = `
job "lens-run" {
  datacenters = ["dc1"]
  type = "service"
  group "w" {
    count = 1
    task "app" {
      driver = "raw_exec"
      config {
        command = "/bin/sh"
        args    = ["-c", "while true; do echo tick; sleep 2; done"]
      }
      resources {
        cores  = 1
        memory = 32
      }
    }
  }
}
`;

// Job that CANNOT be placed: a constraint on a non-existent kernel. Used to verify
// the placement diagnostics (NOM-15) against the real scheduler.
const UNPLACEABLE_HCL = `
job "lens-noplace" {
  datacenters = ["dc1"]
  type = "service"
  constraint {
    attribute = "\${attr.kernel.name}"
    value     = "plan9"
  }
  group "w" {
    count = 1
    task "app" {
      driver = "raw_exec"
      config {
        command = "/bin/sh"
        args    = ["-c", "sleep 60"]
      }
      resources {
        cores  = 1
        memory = 32
      }
    }
  }
}
`;

let failures = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok   ${name}`))
    .catch((err) => {
      failures++;
      console.error(`FAIL ${name}\n     ${err}`);
    });
}

async function main(): Promise<void> {
  // --- unit: renderers ---------------------------------------------------------
  const jobs: JobSummary[] = [
    { id: 'transcoder', name: 'transcoder', type: 'service', status: 'running', running: 3, desired: 3, failed: 0 },
    { id: 'packager', name: 'packager', type: 'service', status: 'running', running: 2, desired: 3, failed: 1 },
    { id: 'cleanup', name: 'cleanup', type: 'batch', status: 'dead', running: 0, desired: 0, failed: 0 },
  ];

  await test('jobHealth: running-but-incomplete is degraded', () => {
    assert.strictEqual(jobHealth(jobs[0]), 'running');
    assert.strictEqual(jobHealth(jobs[1]), 'degraded');
    assert.strictEqual(jobHealth(jobs[2]), 'dead');
  });

  await test('snapshot: problems section lists only unhealthy jobs', () => {
    const md = renderSnapshot(
      'test-cluster',
      jobs,
      [
        { id: 'n1', name: 'worker-01', status: 'ready', drain: false, eligibility: 'eligible' },
        { id: 'n2', name: 'worker-02', status: 'ready', drain: true, eligibility: 'ineligible' },
      ],
      [
        {
          id: 'd1',
          jobId: 'packager',
          status: 'running',
          description: 'canary in progress',
          desired: 3,
          placed: 2,
          healthy: 1,
          unhealthy: 0,
          canaries: 1,
        },
      ]
    );
    const problemsSection = md.split('## ⚠ Needs attention')[1].split('## All jobs')[0];
    assert.ok(problemsSection.includes('| packager |'), 'packager should be flagged');
    assert.ok(!problemsSection.includes('| transcoder |'), 'transcoder healthy, not in problems');
    assert.ok(md.includes('worker-02'), 'drain node listed');
    assert.ok(md.includes('canary in progress'));
  });

  await test('plan diff: rendered fields and no-change case', () => {
    const plan: PlanResult = {
      Diff: {
        Type: 'Edited',
        Name: 'demo',
        Fields: null,
        Objects: null,
        TaskGroups: [
          {
            Type: 'Edited',
            Name: 'web',
            Fields: [{ Type: 'Edited', Name: 'Count', Old: '2', New: '3' }],
            Objects: null,
            Tasks: [
              {
                Type: 'Edited',
                Name: 'app',
                Fields: null,
                Objects: [
                  {
                    Type: 'Edited',
                    Name: 'Config',
                    Fields: [{ Type: 'Edited', Name: 'image', Old: 'nginx:1.25', New: 'nginx:1.27' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const text = renderPlanDiff(plan);
    assert.ok(text.includes('Count'), 'count change shown');
    assert.ok(text.includes('nginx:1.27'), 'image change shown');
    assert.ok(renderPlanDiff({}).includes('No differences'));
  });

  await test('incident bundle: markdown + log files', () => {
    const bundle = buildIncidentBundle({
      cluster: 'test',
      alloc: {
        id: 'abcdef1234567890',
        name: 'packager.web[0]',
        jobId: 'packager',
        taskGroup: 'web',
        clientStatus: 'failed',
        nodeName: 'worker-02',
        tasks: ['app'],
        restarts: 4,
        oom: true,
      },
      allocRaw: {
        TaskStates: {
          app: {
            State: 'dead',
            Failed: true,
            Events: [
              { Type: 'Started', Time: 1786000000000000000, DisplayMessage: 'Task started' },
              { Type: 'Terminated', Time: 1786000100000000000, DisplayMessage: 'OOM killed' },
            ],
          },
        },
      },
      logs: { app: { stdout: 'hello\n', stderr: 'boom\n' } },
    });
    assert.ok(bundle.dirName.includes('packager-abcdef12'));
    assert.ok(bundle.markdown.includes('OOM killed'));
    assert.ok(bundle.markdown.includes('restarts: 4'));
    assert.strictEqual(bundle.files.length, 2);
    assert.ok(bundle.files.some((f) => f.name === 'app.stderr.log' && f.content === 'boom\n'));
  });

  await test('taskEventIsOom: strict match (no false hits from "zoom"/"room")', () => {
    assert.strictEqual(taskEventIsOom({ Details: { oom_killed: 'true' } }), true);
    assert.strictEqual(taskEventIsOom({ DisplayMessage: 'Out of memory (OOM) killed' }), true);
    assert.strictEqual(taskEventIsOom({ DisplayMessage: 'OOMKilled' }), true);
    assert.strictEqual(taskEventIsOom({ Type: 'Terminated', DisplayMessage: 'Exit Code: 0' }), false);
    assert.strictEqual(taskEventIsOom({ DisplayMessage: 'joined zoom room' }), false); // niente falso positivo
    assert.strictEqual(taskEventIsOom({}), false);
  });

  await test('mapPool: runs everything, in order, without exceeding the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12, 14], 'risultati completi e in ordine');
    assert.ok(maxInFlight <= 3, `max concurrency ${maxInFlight} must be <= 3`);
    assert.ok(maxInFlight >= 2, `must run in parallel (max observed ${maxInFlight})`);
    // limit larger than the item count: no crash, everything runs
    assert.deepStrictEqual(await mapPool([1, 2], 10, async (n) => n + 1), [2, 3]);
    assert.deepStrictEqual(await mapPool([], 4, async (n) => n), []);
  });

  await test('allocWarnings: OOM and restart loop beyond the threshold (default 3)', () => {
    assert.deepStrictEqual(allocWarnings({ restarts: 0, oom: false }), []);
    assert.deepStrictEqual(allocWarnings({ restarts: 2, oom: false }), []); // sotto soglia
    assert.deepStrictEqual(allocWarnings({ restarts: 5, oom: false }), ['restart loop ×5']);
    assert.deepStrictEqual(allocWarnings({ restarts: 0, oom: true }), ['OOM']);
    assert.deepStrictEqual(allocWarnings({ restarts: 4, oom: true }), ['OOM', 'restart loop ×4']);
  });

  await test('drift: summarizeJob + compareJobSpecs surface differing image/count/env', () => {
    const mk = (image: string, count: number, env: Record<string, string>): RawJob => ({
      ID: 'web',
      TaskGroups: [
        { Name: 'web', Count: count, Tasks: [{ Name: 'app', Config: { image }, Env: env, Resources: { CPU: 100, MemoryMB: 64 } }] },
      ],
    });
    const a = summarizeJob(mk('nginx:1.25', 3, { LOG: 'info' }));
    const b = summarizeJob(mk('nginx:1.27', 2, { LOG: 'debug' }));
    assert.strictEqual(a.count, 3);
    assert.deepStrictEqual(jobImages(mk('nginx:1.25', 3, {})), ['nginx:1.25']);

    const rows = compareJobSpecs(a, b);
    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));
    assert.strictEqual(byField['count'].same, false);
    assert.strictEqual(byField['web/app · image'].same, false);
    assert.strictEqual(byField['web/app · image'].a, 'nginx:1.25');
    assert.strictEqual(byField['web/app · cpu'].same, true); // 100 == 100
    assert.ok(byField['web/app · env LOG'] && byField['web/app · env LOG'].same === false);

    const md = renderComparison('web', 'prod', 'dev', rows);
    assert.ok(md.includes('prod vs dev'));
    assert.ok(md.includes('≠'));
  });

  await test('charts: donut segments, progressBar clamp, sparkline guards', () => {
    const d = donut([
      { label: 'running', value: 3, color: '#0f0' },
      { label: 'failed', value: 1, color: '#f00' },
    ]);
    assert.ok(d.includes('<svg') && d.includes('</svg>'));
    assert.strictEqual((d.match(/<circle/g) || []).length, 3); // track + 2 segments
    assert.ok(d.includes('>4<'), 'total in the middle'); // 3+1
    assert.ok(d.includes('<title>running: 3, failed: 1</title>'));
    // total 0 → track only, no NaN
    const empty = donut([]);
    assert.ok(empty.includes('<circle') && !empty.includes('NaN'));

    // progressBar clamps value>max to full width
    assert.ok(progressBar(5, 3, '#0f0', 100).includes('width="100"'));
    assert.ok(progressBar(0, 0, '#0f0', 100).match(/width="0"/), 'max 0 → 0% fill, no div-by-zero');

    // sparkline needs ≥2 finite points
    assert.ok(sparkline([]).includes('no data'));
    assert.ok(sparkline([1, 2, 3]).includes('<polyline'));
    assert.ok(!sparkline([NaN, 1]).includes('<polyline'), 'a single finite point is not enough');
  });

  await test('log console: ANSI strip, level detection, console shell', () => {
    assert.strictEqual(stripAnsi('[31mred[0m'), 'red');
    assert.strictEqual(logLevel('2026 ERROR upstream timeout'), 'error');
    assert.strictEqual(logLevel('a warning here'), 'warn');
    assert.strictEqual(logLevel('INFO started'), 'info');
    assert.strictEqual(logLevel('plain line'), '');
    assert.strictEqual(logLevel('zooming around'), '', 'no false positive on substrings');

    const cl = classifyLine('[33mWARN disk low[0m');
    assert.deepStrictEqual(cl, { level: 'warn', text: 'WARN disk low' });
    assert.strictEqual(classifyLines('a\nERROR b\n').length, 3);

    const html = renderLogConsole({
      title: 'job/app · stdout',
      lines: [classifyLine('ERROR boom'), classifyLine('ok')],
      nonce: 'LOGNONCE',
      cspSource: '',
    });
    assert.ok(html.includes('nonce-LOGNONCE') && html.includes('Content-Security-Policy'));
    assert.ok(html.includes('id="filter"') && html.includes('id="follow"') && html.includes('id="wrap"'));
    assert.ok(html.includes('class="ln lvl-error"') && html.includes('ERROR boom'));
  });

  await test('live panels (NOM-28): body renderers vs full document + #root/update wiring', () => {
    const dJob: JobSummary = { id: 'web', name: 'web', type: 'service', status: 'running', running: 1, desired: 2, failed: 0 };
    const body = renderDashboardBody({ cluster: 'prod', jobs: [dJob], nodes: [], deployments: [], nonce: '', cspSource: '' });
    // the body is inner markup only — no document scaffolding
    assert.ok(!body.includes('<!doctype') && !body.includes('<script'));
    assert.ok(body.includes('Nomad · prod') && body.includes('id="live"'));
    // the full document wraps the body in #root and carries the update handler
    const full = renderDashboard({ cluster: 'prod', jobs: [dJob], nodes: [], deployments: [], nonce: 'N', cspSource: '' });
    assert.ok(full.includes('<!doctype html>') && full.includes('id="root"'));
    assert.ok(full.includes("m.type === 'update'"), 'live update handler present');

    const jbody = renderJobPanelBody({ job: dJob, allocs: [], nonce: '', cspSource: '' });
    assert.ok(!jbody.includes('<!doctype') && jbody.includes('data-cmd="nomadLens.stopJob"'));
    const jfull = renderJobPanel({ job: dJob, allocs: [], nonce: 'N', cspSource: '' });
    assert.ok(jfull.includes('id="root"') && jfull.includes("m.type === 'update'"));
    assert.ok(jfull.includes("closest('button[data-cmd]')"), 'delegated clicks survive body swaps');
  });

  await test('resource gauges: bars, %, flags, sparkline, empty case', () => {
    assert.ok(renderResourceGauges([]).includes('No statistics'));
    const html = renderResourceGauges([
      { task: 'app', cpuUsed: 120, cpuReq: 100, memUsed: 60, memReq: 64, cpuSamples: [100, 110, 120], memSamples: [50, 55, 60] },
      { task: 'side', cpuUsed: 5, cpuReq: 100, memUsed: 4, memReq: 64, cpuSamples: [5], memSamples: [4] },
    ]);
    assert.ok(html.includes('app') && html.includes('side'));
    assert.ok(html.includes('120/100 MHz (120%)'), 'cpu gauge value + pct');
    assert.ok(html.includes('60/64 MiB'), 'mem gauge value');
    assert.ok(html.includes('⚠ near limit'), 'app mem 60/64 ≥90% flagged over');
    assert.ok(html.includes('💤 oversized'), 'side mem 4/64 ≤20% flagged under');
    assert.ok(html.includes('<polyline'), 'sparkline for ≥2 samples');
  });

  await test('job panel: renders alloc rows + action buttons; command contract', () => {
    // message contract
    assert.ok(isAllowedPanelCommand('nomadLens.stopJob') && isAllowedPanelCommand('nomadLens.restartAlloc'));
    assert.ok(!isAllowedPanelCommand('nomadLens.somethingElse'), 'allowlist rejects unknown commands');
    assert.strictEqual(isAllocPanelCommand('nomadLens.restartAlloc'), true);
    assert.strictEqual(isAllocPanelCommand('nomadLens.stopJob'), false);

    const html = renderJobPanel({
      job: { id: 'packager', name: 'packager', type: 'service', status: 'running', running: 2, desired: 3, failed: 1 },
      allocs: [
        { id: 'aaaa1111bbbb', name: 'packager.web[0]', jobId: 'packager', taskGroup: 'web', clientStatus: 'running', nodeName: 'w1', tasks: ['app'], restarts: 4, oom: true },
      ],
      deployment: { id: 'd', jobId: 'packager', status: 'running', description: '', desired: 3, placed: 2, healthy: 1, unhealthy: 0, canaries: 1 },
      nonce: 'JOBNONCE',
      cspSource: 'vscode-resource:',
    });
    assert.ok(html.includes('nonce-JOBNONCE') && html.includes('Content-Security-Policy'));
    assert.ok(html.includes('packager'));
    assert.ok(html.includes('aaaa1111'), 'alloc id shortened');
    assert.ok(html.includes('⚠') && html.includes('OOM'), 'alloc warnings shown');
    assert.ok(html.includes('data-cmd="nomadLens.restartAlloc"') && html.includes('data-alloc="aaaa1111bbbb"'));
    assert.ok(html.includes('data-cmd="nomadLens.stopJob"'));
    assert.ok(html.includes('deploy') || html.includes('Deployment'), 'deployment section');
  });

  await test('renderDiffTree/Page: colour-coded collapsible diff (plan + version)', () => {
    assert.ok(renderDiffTree(undefined).includes('No differences'));
    assert.ok(renderDiffTree({ Type: 'None', Name: 'x' } as JobDiff).includes('No differences'));

    const jd: JobDiff = {
      Type: 'Edited',
      Name: 'demo',
      Fields: null,
      Objects: null,
      TaskGroups: [
        {
          Type: 'Edited',
          Name: 'web',
          Fields: [{ Type: 'Edited', Name: 'Count', Old: '2', New: '3' }],
          Objects: null,
          Tasks: [
            {
              Type: 'Edited',
              Name: 'app',
              Fields: null,
              Objects: [
                { Type: 'Edited', Name: 'Config', Fields: [{ Type: 'Added', Name: 'image', Old: '', New: 'nginx:1.27' }] },
              ],
            },
          ],
        },
      ],
    };
    const tree = renderDiffTree(jd);
    assert.ok(tree.includes('group web'), 'group name');
    assert.ok(tree.includes('task app'), 'task name');
    assert.ok(tree.includes('Count') && tree.includes('nginx:1.27'), 'field changes');
    assert.ok(tree.includes('class="o edit"'), 'edited class');
    assert.ok(tree.includes('f add'), 'added field class');

    const page = renderDiffPage({
      title: 'Plan — web',
      diff: jd,
      nonce: 'N0NCE',
      cspSource: 'vscode-resource:',
      warnings: 'be careful',
      failedPlacements: ['cache'],
    });
    assert.ok(page.includes('nonce-N0NCE') && page.includes('Content-Security-Policy'));
    assert.ok(page.includes('Plan — web'));
    assert.ok(page.includes('Placement failed for: cache'));
    assert.ok(page.includes('Warnings: be careful'));
  });

  await test('renderDashboard: sections, CSP nonce, problems, healthy case', () => {
    const nonce = 'TESTNONCE';
    const jobsD: JobSummary[] = [
      { id: 'web', name: 'web', type: 'service', status: 'running', running: 3, desired: 3, failed: 0 },
      { id: 'api', name: 'api', type: 'service', status: 'running', running: 1, desired: 3, failed: 1 },
    ];
    const html = renderDashboard({
      cluster: 'prod',
      jobs: jobsD,
      nodes: [{ id: 'n1', name: 'w1', status: 'ready', drain: false, eligibility: 'eligible' }],
      deployments: [
        { id: 'd1', jobId: 'api', status: 'running', description: '', desired: 3, placed: 1, healthy: 1, unhealthy: 0, canaries: 0 },
      ],
      nonce,
      cspSource: 'vscode-resource:',
    });
    assert.ok(html.includes('<!doctype html>'));
    assert.ok(html.includes(`nonce-${nonce}`), 'CSP carries the nonce');
    assert.ok(html.includes('Content-Security-Policy'));
    assert.ok(html.includes('Nomad · prod'));
    assert.ok(html.includes('api') && html.includes('degraded'), 'under-scaled api flagged as degraded');
    assert.ok(!html.includes('| web |'));
    assert.ok(html.includes('<svg'), 'donut present');
    // healthy cluster → all green
    const green = renderDashboard({
      cluster: 'dev',
      jobs: [{ id: 'ok', name: 'ok', type: 'service', status: 'running', running: 2, desired: 2, failed: 0 }],
      nodes: [],
      deployments: [],
      nonce,
      cspSource: '',
    });
    assert.ok(green.includes('All green'));
  });

  await test('snapshotFileName: cluster slug + date, .md extension', () => {
    assert.strictEqual(snapshotFileName('prod', '2026-07-24'), 'nomad-snapshot-prod-2026-07-24.md');
    assert.strictEqual(snapshotFileName('ovh cluster/1', '2026-07-24'), 'nomad-snapshot-ovh-cluster-1-2026-07-24.md');
    assert.strictEqual(snapshotFileName('', '2026-07-24'), 'nomad-snapshot-cluster-2026-07-24.md');
  });

  await test('renderImageInventory: job×cluster matrix and drift marker', () => {
    const md = renderImageInventory([
      { cluster: 'prod', jobs: [{ id: 'web', images: ['nginx:1.27'] }, { id: 'api', images: ['api:2.0'] }] },
      { cluster: 'dev', jobs: [{ id: 'web', images: ['nginx:1.25'] }] },
    ]);
    assert.ok(md.includes('| Job | prod | dev | drift |'));
    // web ha immagini diverse tra prod e dev -> drift
    const webRow = md.split('\n').find((l) => l.startsWith('| web |'))!;
    assert.ok(webRow.includes('nginx:1.27') && webRow.includes('nginx:1.25'));
    assert.ok(webRow.trimEnd().endsWith('≠ |'), 'web must be marked as drifted');
    // api exists only in prod -> '—' cell in dev, no drift
    const apiRow = md.split('\n').find((l) => l.startsWith('| api |'))!;
    assert.ok(apiRow.includes('—'));
    assert.ok(!apiRow.trimEnd().endsWith('≠ |'), 'api present in a single cluster: no drift');
  });

  await test('grepLogs: case-insensitive by default, line numbers, case-sensitive option', () => {
    const sources: LogSource[] = [
      { alloc: 'aaaa1111', task: 'app', type: 'stdout', text: 'ok\nERROR boom\nok again' },
      { alloc: 'bbbb2222', task: 'app', type: 'stderr', text: 'nothing here\nerror lower' },
    ];
    const m = grepLogs(sources, 'error');
    assert.strictEqual(m.length, 2, 'match su ERROR e error (case-insensitive)');
    assert.deepStrictEqual(
      m.map((x) => [x.alloc, x.type, x.line]),
      [['aaaa1111', 'stdout', 2], ['bbbb2222', 'stderr', 2]]
    );
    // case sensitive: only lowercase "error"
    const cs = grepLogs(sources, 'error', { caseSensitive: true });
    assert.strictEqual(cs.length, 1);
    assert.strictEqual(cs[0].alloc, 'bbbb2222');
    // empty query → no match
    assert.deepStrictEqual(grepLogs(sources, ''), []);
  });

  await test('renderGrepReport: header, counts and grouping by alloc', () => {
    const md = renderGrepReport('packager', 'timeout', [
      { alloc: 'aaaa1111', task: 'app', type: 'stdout', line: 5, text: '  timeout waiting  ' },
      { alloc: 'aaaa1111', task: 'app', type: 'stderr', line: 9, text: 'timeout again' },
    ]);
    assert.ok(md.includes('grep "timeout" — packager'));
    assert.ok(md.includes('2 matches in 1 allocation.'));
    assert.ok(md.includes('## alloc aaaa1111'));
    assert.ok(md.includes('`app/stdout:5` timeout waiting'), 'trimmed line with its position');
  });

  await test('deploy: aggregates the task groups, derives state and the status bar line', () => {
    const agg = aggregateDeployment({
      web: { DesiredTotal: 3, PlacedAllocs: 3, HealthyAllocs: 2, UnhealthyAllocs: 0, DesiredCanaries: 1 },
      api: { DesiredTotal: 2, PlacedAllocs: 2, HealthyAllocs: 2, UnhealthyAllocs: 0 },
    });
    assert.deepStrictEqual(agg, { desired: 5, placed: 5, healthy: 4, unhealthy: 0, canaries: 1 });
    assert.deepStrictEqual(aggregateDeployment(null), { desired: 0, placed: 0, healthy: 0, unhealthy: 0, canaries: 0 });

    const running = deployStatus('running', agg);
    assert.strictEqual(running.active, true);
    assert.strictEqual(running.done, false);
    assert.strictEqual(running.pct, 80); // 4/5

    assert.strictEqual(deployStatus('successful', agg).ok, true);
    assert.strictEqual(deployStatus('failed', agg).failed, true);
    assert.strictEqual(deployStatus('cancelled', agg).failed, true);
    assert.strictEqual(deployStatus('successful', { desired: 0, placed: 0, healthy: 0, unhealthy: 0, canaries: 0 }).pct, 100);

    const bar = deployStatusBar('web', 'running', agg);
    assert.ok(bar.includes('deploy web 4/5'));
    assert.ok(bar.includes('canary 1'));
    assert.ok(deployStatusBar('web', 'successful', agg).includes('$(check)'));
  });

  await test('deployNotification: notifies only on transitions to terminal states', () => {
    assert.strictEqual(deployNotification(undefined, 'web', 'running', ''), null); // primo giro
    assert.strictEqual(deployNotification('running', 'web', 'running', ''), null); // no change
    assert.strictEqual(deployNotification('running', 'web', 'successful', '')?.kind, 'success');
    assert.strictEqual(deployNotification('running', 'web', 'failed', 'boom')?.kind, 'failure');
    assert.strictEqual(deployNotification('running', 'web', 'cancelled', '')?.kind, 'failure');
    assert.strictEqual(deployNotification('pending', 'web', 'running', ''), null); // running does not notify
  });

  await test('isDeployStalled: only running and beyond the threshold', () => {
    assert.strictEqual(isDeployStalled('running', 5000, 3000), true);
    assert.strictEqual(isDeployStalled('running', 1000, 3000), false);
    assert.strictEqual(isDeployStalled('successful', 999999, 3000), false);
  });

  await test('actions: stop/restart destructive, stop requires typing, start does not', () => {
    assert.strictEqual(ACTIONS.stopJob.destructive, true);
    assert.strictEqual(ACTIONS.stopJob.requireType, true);
    assert.strictEqual(ACTIONS.restartAlloc.destructive, true);
    assert.strictEqual(ACTIONS.restartAlloc.requireType, false);
    assert.strictEqual(ACTIONS.startJob.destructive, false);
    assert.ok(confirmMessage('stopJob', 'packager').includes('packager'));
    assert.ok(confirmMessage('stopJob', 'packager').includes('mutates the cluster'));
    assert.ok(!confirmMessage('startJob', 'packager').includes('mutates the cluster'));
  });

  await test('actions: revert job is destructive and requires typing the id', () => {
    assert.strictEqual(ACTIONS.revertJob.destructive, true);
    assert.strictEqual(ACTIONS.revertJob.requireType, true);
    assert.ok(confirmMessage('revertJob', 'packager').includes('packager'));
  });

  // --- versions (NOM-14) -------------------------------------------------------
  // Versions come newest-first; Diffs[i] compares Versions[i] with Versions[i+1],
  // so the oldest one has no diff.
  const versionsFixture: JobVersionsResult = {
    Versions: [
      { Version: 2, Stable: true, SubmitTime: 1_700_000_002_000_000_000 },
      { Version: 1, Stable: false, SubmitTime: 1_700_000_001_000_000_000 },
      { Version: 0, Stable: true, SubmitTime: 1_700_000_000_000_000_000 },
    ],
    Diffs: [
      {
        Type: 'Edited',
        Name: 'Job',
        TaskGroups: [
          { Type: 'Edited', Name: 'web', Fields: [{ Type: 'Edited', Name: 'Count', Old: '2', New: '3' }] },
        ],
      },
      { Type: 'None', Name: 'Job' },
    ],
  };

  await test('parseVersions: sorts desc, pairs the diffs, converts nanoseconds', () => {
    const vs = parseVersions(versionsFixture);
    assert.deepStrictEqual(vs.map((v) => v.version), [2, 1, 0]);
    // SubmitTime is in nanoseconds: /1e6 before new Date().
    assert.strictEqual(vs[0].submitTimeMs, 1_700_000_002_000);
    assert.strictEqual(new Date(vs[0].submitTimeMs).toISOString(), '2023-11-14T22:13:22.000Z');
    assert.strictEqual(vs[0].previousVersion, 1);
    assert.ok(vs[0].diffToPrevious, 'v2 must carry the diff against v1');
    // the oldest one has no predecessor: no diff, and no off-by-one pairing
    assert.strictEqual(vs[2].previousVersion, null);
    assert.strictEqual(vs[2].diffToPrevious, undefined);
  });

  await test('parseVersions: empty response or missing diffs does not throw', () => {
    assert.deepStrictEqual(parseVersions({}), []);
    assert.deepStrictEqual(parseVersions({ Versions: null, Diffs: null }), []);
    const noDiffs = parseVersions({ Versions: [{ Version: 1 }, { Version: 0 }] });
    assert.strictEqual(noDiffs[0].diffToPrevious, undefined);
    assert.strictEqual(noDiffs[0].previousVersion, 0);
    assert.strictEqual(noDiffs[0].submitTimeMs, 0);
  });

  await test('versionPickItem: marks current and stable', () => {
    const vs = parseVersions(versionsFixture);
    const cur = versionPickItem(vs[0], 2);
    assert.strictEqual(cur.label, 'v2');
    assert.ok(cur.description.includes('current'));
    assert.ok(cur.description.includes('stable'));
    const old = versionPickItem(vs[1], 2);
    assert.ok(!old.description.includes('current'));
    assert.ok(!old.description.includes('stable'));
  });

  await test('renderVersionHistory: table with every version, current marked', () => {
    const md = renderVersionHistory('packager', parseVersions(versionsFixture), 2);
    assert.ok(md.includes('# Job history — packager'));
    assert.ok(md.includes('| v2 |') && md.includes('| v1 |') && md.includes('| v0 |'));
    assert.ok(/\| v2 \|.*current \|/.test(md), md);
    assert.ok(!/\| v1 \|.*current \|/.test(md), md);
  });

  await test('renderVersionDiff: changes, no changes, oldest version', () => {
    const vs = parseVersions(versionsFixture);
    const edited = renderVersionDiff('packager', vs[0]);
    assert.ok(edited.includes('v2 vs v1'), edited);
    assert.ok(edited.includes('Count'), edited);
    assert.ok(edited.includes('```diff'), edited);
    // Type=None → no changes, and no empty diff block
    const none = renderVersionDiff('packager', vs[1]);
    assert.ok(none.includes('No changes between v1 and v0'), none);
    assert.ok(!none.includes('```'), none);
    // the oldest one has no predecessor
    assert.ok(renderVersionDiff('packager', vs[2]).includes('Oldest version'));
  });

  // --- markdown renderer for the published guide (NOM-20) ----------------------

  await test('slugify: anchors from heading text', () => {
    assert.strictEqual(slugify('19. Settings reference'), '19-settings-reference');
    assert.strictEqual(slugify('`go.diagnostic.vulncheck` auto-fix'), 'go-diagnostic-vulncheck-auto-fix');
    assert.strictEqual(slugify('###'), 'section', 'never an empty anchor');
  });

  await test('renderMarkdown: headings collect a TOC with unique ids', () => {
    const { html, headings } = renderMarkdown('# Guide\n\n## One\n\n## One\n\n### Deep\n');
    assert.deepStrictEqual(
      headings.map((h) => [h.level, h.id]),
      [
        [1, 'guide'],
        [2, 'one'],
        [2, 'one-2'],
        [3, 'deep'],
      ]
    );
    assert.ok(html.includes('<h2 id="one-2">One</h2>'), html);
  });

  await test('renderMarkdown: inline code, bold, italic and links', () => {
    const { html } = renderMarkdown('A `code` and **bold** and *it* and [text](docs/X.md).');
    assert.ok(html.includes('<code>code</code>'));
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<em>it</em>'));
    assert.ok(html.includes('<a href="docs/X.md">text</a>'));
    // external links open in a new tab, internal ones do not
    assert.ok(renderMarkdown('[x](https://e.com)').html.includes('target="_blank"'));
    assert.ok(!renderMarkdown('[x](./a.html)').html.includes('target="_blank"'));
  });

  await test('renderMarkdown: markup inside code spans stays literal', () => {
    const { html } = renderMarkdown('Use `**not bold**` and `<script>` here.');
    assert.ok(html.includes('<code>**not bold**</code>'), html);
    assert.ok(html.includes('<code>&lt;script&gt;</code>'), html);
    assert.ok(!html.includes('<strong>'), 'bold must not apply inside a code span');
  });

  await test('renderMarkdown: raw HTML in the source is escaped, never passed through', () => {
    const { html } = renderMarkdown('Text <script>alert(1)</script> & more.');
    assert.ok(!html.includes('<script>'), html);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&amp; more'));
  });

  await test('renderMarkdown: fenced code keeps its content verbatim', () => {
    const { html } = renderMarkdown('```jsonc\n{ "a": "<b>" } // note\n```');
    assert.ok(html.includes('<pre><code class="language-jsonc">'), html);
    assert.ok(html.includes('{ &quot;a&quot;: &quot;&lt;b&gt;&quot; } // note'), html);
  });

  await test('renderMarkdown: pipe table with an alignment row', () => {
    const { html } = renderMarkdown('| A | B |\n|---|:-:|\n| 1 | `x` |\n| 2 | y |\n');
    assert.ok(html.includes('<div class="table-wrap"><table><thead><tr><th>A</th><th>B</th>'), html);
    assert.ok(html.includes('<td>1</td><td><code>x</code></td>'), html);
    assert.strictEqual((html.match(/<tr>/g) ?? []).length, 3, 'one header row + two body rows');
  });

  await test('renderMarkdown: nested lists, ordered lists and blockquotes', () => {
    const nested = renderMarkdown('- top:\n  - child one\n  - child two\n- second\n').html;
    assert.ok(nested.includes('<li>top:<ul><li>child one</li><li>child two</li></ul></li>'), nested);
    assert.ok(nested.includes('<li>second</li>'));
    assert.ok(renderMarkdown('1. first\n2. second\n').html.startsWith('<ol>'));
    assert.ok(renderMarkdown('> a note\n> continued\n').html.includes('<blockquote><p>a note continued</p>'));
  });

  await test('renderMarkdown: --- is a rule, but a table separator is not', () => {
    assert.ok(renderMarkdown('a\n\n---\n\nb').html.includes('<hr>'));
    assert.ok(!renderMarkdown('| A |\n|---|\n| 1 |\n').html.includes('<hr>'));
  });

  await test('renderMarkdown: the real guide renders with every section', () => {
    // The test bundle is ESM, so there is no __dirname: npm test runs from the root.
    const md = fs.readFileSync(path.join(process.cwd(), 'docs', 'GUIDE.md'), 'utf8');
    const { html, headings } = renderMarkdown(md);
    const h2 = headings.filter((h) => h.level === 2);
    assert.ok(h2.length >= 20, `the guide should have 20+ sections, found ${h2.length}`);
    assert.ok(headings.some((h) => h.id === '18-command-reference'), 'command reference anchor');
    assert.ok(headings.some((h) => h.id === '19-settings-reference'), 'settings reference anchor');
    // the anchors the landing page links to must exist, or those links 404 silently
    for (const id of [
      '2-configuring-clusters',
      '5-job-version-history-and-revert',
      '6-why-is-my-job-not-scheduling',
      '8-cross-allocation-grep',
      '11-node-drain-and-eligibility',
      '13-resource-usage-vs-requested',
      '14-compare-a-job-across-clusters-drift',
      '17-recipes',
      '21-troubleshooting',
      '22-security-in-short',
    ]) {
      assert.ok(headings.some((h) => h.id === id), `missing anchor linked from the landing page: ${id}`);
    }
    assert.ok(!html.includes('<script'), 'the generated page must contain no script tag');
  });

  // --- tree filter (NOM-18) ----------------------------------------------------

  await test('jobMatchesFilter: substring on the id, case-insensitive', () => {
    assert.ok(jobMatchesFilter(jobs[0], { text: 'TRANS', problemsOnly: false }));
    assert.ok(jobMatchesFilter(jobs[0], { text: 'code', problemsOnly: false }), 'substring, not prefix');
    assert.ok(!jobMatchesFilter(jobs[0], { text: 'packager', problemsOnly: false }));
    // empty or whitespace-only text is not a filter
    assert.ok(jobMatchesFilter(jobs[0], { text: '   ', problemsOnly: false }));
    assert.ok(jobMatchesFilter(jobs[0], EMPTY_JOB_FILTER));
  });

  await test('jobMatchesFilter: problemsOnly uses the effective health', () => {
    // transcoder is running, packager is degraded (running < desired), cleanup is dead
    assert.ok(!jobMatchesFilter(jobs[0], { text: '', problemsOnly: true }));
    assert.ok(jobMatchesFilter(jobs[1], { text: '', problemsOnly: true }), 'degraded is a problem');
    assert.ok(!jobMatchesFilter(jobs[2], { text: '', problemsOnly: true }), 'dead is not a problem');
    // the two criteria are ANDed
    assert.ok(!jobMatchesFilter(jobs[1], { text: 'transcoder', problemsOnly: true }));
    assert.ok(jobMatchesFilter(jobs[1], { text: 'pack', problemsOnly: true }));
  });

  await test('isFilterActive / filterLabel: describe what is being hidden', () => {
    assert.strictEqual(isFilterActive(EMPTY_JOB_FILTER), false);
    assert.strictEqual(isFilterActive({ text: ' ', problemsOnly: false }), false);
    assert.strictEqual(isFilterActive({ text: 'web', problemsOnly: false }), true);
    assert.strictEqual(isFilterActive({ text: '', problemsOnly: true }), true);
    assert.strictEqual(filterLabel(EMPTY_JOB_FILTER, 3, 3), '');
    const label = filterLabel({ text: 'web', problemsOnly: true }, 2, 24);
    assert.ok(label.includes('2/24'), label);
    assert.ok(label.includes('"web"'), label);
    assert.ok(label.includes('problems only'), label);
  });

  // --- nodes: drain / eligibility (NOM-17) -------------------------------------

  await test('drainBody: seconds → nanoseconds, and -1 stays "no deadline"', () => {
    assert.deepStrictEqual(drainBody('n1', 3600), {
      NodeID: 'n1',
      DrainSpec: { Deadline: 3_600_000_000_000, IgnoreSystemJobs: false },
    });
    // -1 means "no deadline": multiplying it would turn it into a huge negative
    assert.strictEqual(drainBody('n1', -1).DrainSpec!.Deadline, -1);
    assert.strictEqual(drainBody('n1', 600, true).DrainSpec!.IgnoreSystemJobs, true);
  });

  await test('stopDrainBody / eligibilityBody: shapes Nomad expects', () => {
    assert.deepStrictEqual(stopDrainBody('n1'), { NodeID: 'n1', DrainSpec: null });
    assert.deepStrictEqual(eligibilityBody('n1', true), { NodeID: 'n1', Eligibility: 'eligible' });
    assert.deepStrictEqual(eligibilityBody('n1', false), { NodeID: 'n1', Eligibility: 'ineligible' });
  });

  await test('countActiveAllocs: terminal allocations do not hold a drain back', () => {
    assert.strictEqual(
      countActiveAllocs([
        { ClientStatus: 'running' },
        { ClientStatus: 'pending' },
        { ClientStatus: 'complete' },
        { ClientStatus: 'failed' },
        { ClientStatus: 'lost' },
      ]),
      2
    );
    assert.strictEqual(countActiveAllocs([]), 0);
  });

  await test('nodeStateLabel / nodeNeedsAttention: drain, eligibility, healthy', () => {
    assert.strictEqual(nodeStateLabel({ status: 'ready', drain: false, eligibility: 'eligible' }), 'ready');
    assert.strictEqual(
      nodeStateLabel({ status: 'ready', drain: false, eligibility: 'ineligible' }),
      'ready · ineligible'
    );
    assert.strictEqual(
      nodeStateLabel({ status: 'ready', drain: true, eligibility: 'ineligible', drainRemaining: 1 }),
      'ready · draining (1 alloc left)'
    );
    // draining implies ineligible: saying both would be noise
    assert.ok(!nodeStateLabel({ status: 'ready', drain: true, eligibility: 'ineligible' }).includes('ineligible'));
    assert.strictEqual(nodeNeedsAttention({ status: 'ready', drain: false, eligibility: 'eligible' }), false);
    assert.strictEqual(nodeNeedsAttention({ status: 'ready', drain: false, eligibility: 'ineligible' }), true);
    assert.strictEqual(nodeNeedsAttention({ status: 'down', drain: false, eligibility: 'eligible' }), true);
  });

  await test('actions: drain is destructive and typed, undoing it is not', () => {
    assert.strictEqual(ACTIONS.drainNode.destructive, true);
    assert.strictEqual(ACTIONS.drainNode.requireType, true);
    assert.strictEqual(ACTIONS.stopDrain.destructive, false);
    assert.strictEqual(ACTIONS.nodeIneligible.requireType, false);
    assert.ok(confirmMessage('drainNode', 'worker-01').includes('worker-01'));
  });

  // --- resources (NOM-16) ------------------------------------------------------

  await test('taskRequests: CPU/memory per task from the job spec', () => {
    const req = taskRequests({
      TaskGroups: [
        { Tasks: [{ Name: 'app', Resources: { CPU: 500, MemoryMB: 256 } }, { Name: 'sidecar', Resources: null }] },
        { Tasks: null },
      ],
    });
    assert.deepStrictEqual(req.app, { cpuMhz: 500, memMib: 256 });
    assert.deepStrictEqual(req.sidecar, { cpuMhz: 0, memMib: 0 });
  });

  await test('parseAllocStats: bytes → MiB, joined with the requests', () => {
    const rows = parseAllocStats(
      'abcdef1234',
      {
        Tasks: {
          app: { ResourceUsage: { CpuStats: { TotalTicks: 480.6 }, MemoryStats: { RSS: 250 * 1024 * 1024 } } },
          probe: { ResourceUsage: null },
        },
      },
      { app: { cpuMhz: 500, memMib: 256 } }
    );
    assert.deepStrictEqual(rows.map((r) => r.task), ['app', 'probe']);
    assert.strictEqual(rows[0].memMib, 250);
    assert.strictEqual(rows[0].cpuMhz, 481);
    assert.strictEqual(rows[0].memRequestMib, 256);
    // a task with no usage and no request must not invent numbers
    assert.strictEqual(rows[1].memMib, 0);
    assert.strictEqual(rows[1].memRequestMib, 0);
  });

  await test('usageFlag: near the limit, oversized, and the cases to leave alone', () => {
    const base = { alloc: 'a', task: 't', cpuMhz: 0, cpuRequestMhz: 0 };
    assert.strictEqual(usageFlag({ ...base, memMib: 240, memRequestMib: 256 }), 'over');
    assert.strictEqual(usageFlag({ ...base, memMib: 20, memRequestMib: 256 }), 'under');
    assert.strictEqual(usageFlag({ ...base, memMib: 128, memRequestMib: 256 }), 'ok');
    // no request → nothing to compare against
    assert.strictEqual(usageFlag({ ...base, memMib: 500, memRequestMib: 0 }), 'ok');
    // not started yet (0 used) is not an oversized reservation
    assert.strictEqual(usageFlag({ ...base, memMib: 0, memRequestMib: 256 }), 'ok');
  });

  await test('renderResourceUsage: table, warnings, and the empty case', () => {
    const md = renderResourceUsage('packager', 'prod', [
      { alloc: 'aaaaaaaa11', task: 'app', cpuMhz: 480, memMib: 250, cpuRequestMhz: 500, memRequestMib: 256 },
      { alloc: 'bbbbbbbb22', task: 'idle', cpuMhz: 5, memMib: 10, cpuRequestMhz: 500, memRequestMib: 256 },
    ]);
    assert.ok(md.includes('| app | aaaaaaaa |'), md);
    assert.ok(md.includes('98%'), md);
    assert.ok(md.includes('Near the memory limit'));
    assert.ok(md.includes('Oversized reservation'));
    const empty = renderResourceUsage('packager', 'prod', []);
    assert.ok(empty.includes('No running allocation reported statistics'));
  });

  // --- placement (NOM-15) ------------------------------------------------------

  await test('explainMetric: turns the scheduler counters into reasons', () => {
    const f = explainMetric('web', {
      NodesEvaluated: 5,
      NodesFiltered: 3,
      NodesExhausted: 2,
      CoalescedFailures: 4,
      ConstraintFiltered: { '${attr.kernel.name} = plan9': 3 },
      DimensionExhausted: { memory: 2, cpu: 0 },
      QuotaExhausted: ['prod'],
      NodesAvailable: { dc1: 5, dc2: 0 },
    });
    assert.strictEqual(f.taskGroup, 'web');
    assert.strictEqual(f.coalescedFailures, 4);
    assert.ok(f.reasons[0].includes('constraint'), f.reasons[0]);
    assert.ok(f.reasons.some((r) => r.includes('memory')));
    assert.ok(f.reasons.some((r) => r.includes('quota exhausted')));
    assert.ok(f.reasons.some((r) => r.includes('dc2')));
    // counters at zero must not become noise
    assert.ok(!f.reasons.some((r) => r.includes('cpu')), f.reasons.join(' | '));
    assert.ok(!f.reasons.some((r) => r.includes('dc1')), f.reasons.join(' | '));
  });

  await test('explainMetric: never returns an empty explanation', () => {
    assert.ok(explainMetric('web', {}).reasons[0].includes('no nodes were evaluated'));
    assert.ok(explainMetric('web', { NodesEvaluated: 3, NodesExhausted: 3 }).reasons[0].includes('out of resources'));
    assert.strictEqual(explainMetric('web', { NodesEvaluated: 3 }).reasons.length, 1);
  });

  await test('latestPlacementFailures: picks the newest eval that actually failed', () => {
    const evals = [
      { ID: 'old', Status: 'complete', ModifyTime: 1_000_000_000_000_000, FailedTGAllocs: { web: { NodesExhausted: 1, NodesEvaluated: 1 } } },
      { ID: 'new', Status: 'blocked', ModifyTime: 2_000_000_000_000_000, FailedTGAllocs: { web: { DimensionExhausted: { memory: 2 } } } },
      // newest of all, but it placed fine: must not hide the failure above
      { ID: 'ok', Status: 'complete', ModifyTime: 3_000_000_000_000_000, FailedTGAllocs: null },
    ];
    const report = latestPlacementFailures(evals)!;
    assert.strictEqual(report.evalId, 'new');
    assert.strictEqual(report.timeMs, 2_000_000_000); // ns → ms
    assert.ok(placementSummary(report).includes('memory'));
    assert.strictEqual(latestPlacementFailures([{ ID: 'ok', FailedTGAllocs: {} }]), null);
    assert.strictEqual(latestPlacementFailures([]), null);
  });

  await test('renderPlacementReport: failure report and the healthy case', () => {
    const md = renderPlacementReport(
      'packager',
      latestPlacementFailures([
        { ID: 'e1', Status: 'blocked', ModifyTime: 2_000_000_000_000_000, FailedTGAllocs: { web: { DimensionExhausted: { memory: 2 }, NodesEvaluated: 4 } } },
      ])
    );
    assert.ok(md.includes('# Placement failures — packager'));
    assert.ok(md.includes('`web`'));
    assert.ok(md.includes('memory'));
    const ok = renderPlacementReport('packager', null);
    assert.ok(ok.includes('No placement failures'));
    assert.ok(ok.includes('allocations'), 'the healthy case should point elsewhere');
  });

  await test('desiredFromJob: sums the task groups Count (0 when absent)', () => {
    assert.strictEqual(desiredFromJob({ TaskGroups: [{ Count: 3 }, { Count: 2 }] }), 5);
    assert.strictEqual(desiredFromJob({ TaskGroups: [{ Count: 1 }, {}] }), 1); // Count mancante = 0
    assert.strictEqual(desiredFromJob({ TaskGroups: null }), 0);
    assert.strictEqual(desiredFromJob({}), 0);
  });

  await test('tokenSentInClear: cleartext only over http towards a non-local host', () => {
    assert.strictEqual(tokenSentInClear('http://nomad.example:4646', true), true);
    assert.strictEqual(tokenSentInClear('https://nomad.example:4646', true), false);
    assert.strictEqual(tokenSentInClear('http://127.0.0.1:4646', true), false);
    assert.strictEqual(tokenSentInClear('http://localhost:4646', true), false);
    assert.strictEqual(tokenSentInClear('http://nomad.example:4646', false), false); // no token
    assert.strictEqual(tokenSentInClear('non-un-url', true), false);
  });

  await test('vulncheck auto-fix: only acts on "Prompt", with the right scope and target', () => {
    const base: VulncheckState = {
      goExtensionInstalled: true,
      autoFixEnabled: true,
      fixTarget: 'Off',
      effectiveValue: 'Prompt',
    };
    // typical case: implicit "Prompt" default, no override -> global fix to Off
    assert.deepStrictEqual(decideVulncheckFix(base), {
      action: 'fix',
      from: 'Prompt',
      to: 'Off',
      scope: 'global',
    });
    // "Prompt" imposto a livello workspace -> si corregge nello stesso scope
    const ws = decideVulncheckFix({ ...base, workspaceValue: 'Prompt' });
    assert.strictEqual(ws.action === 'fix' ? ws.scope : undefined, 'workspace');
    // target configurabile
    const imp = decideVulncheckFix({ ...base, fixTarget: 'Imports' });
    assert.strictEqual(imp.action === 'fix' ? imp.to : undefined, 'Imports');
    // no-op: value already valid, auto-fix off, Go extension missing
    assert.strictEqual(decideVulncheckFix({ ...base, effectiveValue: 'Off' }).action, 'none');
    assert.strictEqual(decideVulncheckFix({ ...base, effectiveValue: 'Imports' }).action, 'none');
    assert.strictEqual(decideVulncheckFix({ ...base, effectiveValue: undefined }).action, 'none');
    assert.strictEqual(decideVulncheckFix({ ...base, autoFixEnabled: false }).action, 'none');
    assert.strictEqual(decideVulncheckFix({ ...base, goExtensionInstalled: false }).action, 'none');
  });

  // Regression: HCL2 (Nomad >= 1.x) rejects a single-line block with more than one
  // argument, e.g. `resources { cpu = 100, memory = 64 }`. It only surfaced in CI
  // (where `nomad` exists); this lint always runs and blocks the fixture upfront.
  await test('hcl fixture: no single-line block with multiple arguments (HCL2)', () => {
    const bad = HCL.split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      // ignore commas inside strings (e.g. a value "a,b")
      .filter(({ line }) => /\{[^{}]*,[^{}]*\}/.test(line.replace(/"[^"]*"/g, '""')));
    assert.deepStrictEqual(
      bad.map((b) => b.n),
      [],
      `single-line multi-arg blocks at lines: ${bad.map((b) => `${b.n} (${b.line.trim()})`).join(', ')}`
    );
  });

  // --- integration: throwaway nomad agent -dev ----------------------------------
  const bin = process.env.NOMAD_BIN || 'nomad';
  const port = 44000 + Math.floor(Math.random() * 1000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomadlens-'));
  let server: ChildProcess | null = null;

  try {
    if (spawnSync(bin, ['version'], { stdio: 'ignore' }).error) {
      throw new Error(`binary '${bin}' not available`);
    }
    fs.writeFileSync(
      path.join(tmp, 'config.hcl'),
      `ports { http = ${port} }\nplugin "raw_exec" {\n  config {\n    enabled = true\n  }\n}\n`
    );
    server = spawn(bin, ['agent', '-dev', `-config=${path.join(tmp, 'config.hcl')}`], { stdio: 'ignore' });
    server.on('error', () => {});

    const client = new NomadClient({ name: 'dev', address: `http://127.0.0.1:${port}` });
    let up = false;
    for (let i = 0; i < 100; i++) {
      try {
        await client.nodes();
        up = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!up) throw new Error('nomad agent -dev did not start');

    await test('integration: parse HCL + register + list jobs', async () => {
      const job = await client.parseHcl(HCL);
      assert.strictEqual((job as { ID?: string }).ID, 'lens-demo');
      await client.registerJob(job);
      for (let i = 0; i < 20; i++) {
        const list = await client.jobs();
        if (list.some((j) => j.id === 'lens-demo')) return;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.fail('lens-demo not in job list');
    });

    await test('integration: plan shows diff for modified spec', async () => {
      const modified = await client.parseHcl(HCL.replace('count = 2', 'count = 3').replace('nginx:1.25', 'nginx:1.27'));
      const plan = await client.plan(modified);
      const text = renderPlanDiff(plan);
      assert.ok(text.includes('Count') || text.includes('count'), `diff should mention count:\n${text}`);
      assert.ok(text.includes('nginx:1.27'), `diff should mention new image:\n${text}`);
    });

    await test('integration: plan with identical spec has no diff', async () => {
      const same = await client.parseHcl(HCL);
      const plan = await client.plan(same);
      assert.ok(renderPlanDiff(plan).includes('No differences'));
    });

    await test('integration: allocations listing does not throw', async () => {
      const allocs = await client.allocations('lens-demo');
      assert.ok(Array.isArray(allocs));
    });

    await test('integration: stopJob deregisters the job', async () => {
      const spec = await client.parseHcl(HCL.replace('lens-demo', 'lens-stopme'));
      await client.registerJob(spec);
      for (let i = 0; i < 20; i++) {
        if ((await client.jobs()).some((j) => j.id === 'lens-stopme')) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      await client.stopJob('lens-stopme');
      for (let i = 0; i < 20; i++) {
        const j = (await client.jobs()).find((x) => x.id === 'lens-stopme');
        if (!j || j.status === 'dead') return;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.fail('lens-stopme still active after stopJob');
    });

    await test('integration: job versions expose the diff, revert restores the old spec', async () => {
      const spec = HCL.replace('lens-demo', 'lens-hist');
      await client.registerJob(await client.parseHcl(spec));
      await client.registerJob(await client.parseHcl(spec.replace('count = 2', 'count = 3')));

      let versions = parseVersions(await client.versions('lens-hist'));
      for (let i = 0; i < 20 && versions.length < 2; i++) {
        await new Promise((r) => setTimeout(r, 200));
        versions = parseVersions(await client.versions('lens-hist'));
      }
      assert.ok(versions.length >= 2, `expected at least two versions, got ${versions.length}`);

      const current = versions[0];
      assert.strictEqual(current.previousVersion, versions[1].version);
      const diffText = renderVersionDiff('lens-hist', current);
      assert.ok(diffText.includes('Count'), `version diff should mention Count:\n${diffText}`);

      // revert to the oldest version: count must go back to 2
      const oldest = versions[versions.length - 1];
      await client.revertJob('lens-hist', oldest.version);
      for (let i = 0; i < 20; i++) {
        const job = (await client.job('lens-hist')) as { TaskGroups?: { Count?: number }[] | null };
        if (desiredFromJob(job) === 2) return;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.fail('revert did not restore count = 2');
    });

    await test('integration: placement diagnostics explain an impossible constraint', async () => {
      await client.registerJob(await client.parseHcl(UNPLACEABLE_HCL));
      let report = null;
      for (let i = 0; i < 40 && !report; i++) {
        report = latestPlacementFailures(await client.evaluations('lens-noplace'));
        if (!report) await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(report, 'the scheduler should record a placement failure for lens-noplace');
      const md = renderPlacementReport('lens-noplace', report);
      assert.ok(md.includes('kernel.name'), `report should name the failing constraint:\n${md}`);
      assert.ok(placementSummary(report).includes('constraint'), placementSummary(report));
    });

    await test('integration: restartAllocation + startJob on a running raw_exec alloc', async () => {
      const spec = await client.parseHcl(RAW_HCL);
      await client.registerJob(spec);
      // wait for a running allocation (raw_exec starts quickly)
      let allocId = '';
      for (let i = 0; i < 60; i++) {
        const running = (await client.allocations('lens-run')).find((a) => a.clientStatus === 'running');
        if (running) {
          allocId = running.id;
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      assert.ok(allocId, 'no running alloc for lens-run');

      // restart: must not throw
      await client.restartAllocation(allocId);

      // stop then start: the job must come back up
      await client.stopJob('lens-run');
      for (let i = 0; i < 20; i++) {
        const j = (await client.jobs()).find((x) => x.id === 'lens-run');
        if (!j || j.status === 'dead') break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await client.startJob('lens-run');
      for (let i = 0; i < 40; i++) {
        const j = (await client.jobs()).find((x) => x.id === 'lens-run');
        if (j && j.status !== 'dead') return;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.fail('startJob did not bring lens-run back up');
    });

    await test('integration: allocStats reports usage joined with the requests', async () => {
      const spec = RAW_HCL.replace('lens-run', 'lens-stats');
      await client.registerJob(await client.parseHcl(spec));
      let allocId = '';
      for (let i = 0; i < 60 && !allocId; i++) {
        const running = (await client.allocations('lens-stats')).find((a) => a.clientStatus === 'running');
        if (running) allocId = running.id;
        else await new Promise((r) => setTimeout(r, 500));
      }
      assert.ok(allocId, 'no running alloc for lens-stats');

      const requests = taskRequests(
        (await client.job('lens-stats')) as Parameters<typeof taskRequests>[0]
      );
      assert.strictEqual(requests.app.memMib, 32, 'the request should come from the spec');

      // The stats endpoint is served by the client node and can lag right after
      // the task starts, so retry before declaring failure.
      let rows: ReturnType<typeof parseAllocStats> = [];
      for (let i = 0; i < 20 && !rows.length; i++) {
        try {
          rows = parseAllocStats(allocId, await client.allocStats(allocId), requests);
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      const app = rows.find((r) => r.task === 'app');
      assert.ok(app, `stats should include the app task, got ${JSON.stringify(rows)}`);
      assert.strictEqual(app.memRequestMib, 32);
      assert.ok(app.memMib >= 0 && app.cpuMhz >= 0);
      assert.ok(renderResourceUsage('lens-stats', 'dev', rows).includes('| app |'));
    });

    // Last integration test: the drain moves the node's allocations (the only node in
    // the dev agent), so everything that needs something running must come first.
    await test('integration: node eligibility toggle and drain/stop-drain round trip', async () => {
      const node = (await client.nodes())[0];
      assert.ok(node, 'the dev agent should expose one node');
      assert.strictEqual(node.eligibility, 'eligible');

      await client.setNodeEligibility(node.id, false);
      let after = (await client.nodes()).find((n) => n.id === node.id)!;
      assert.strictEqual(after.eligibility, 'ineligible');
      assert.ok(nodeNeedsAttention(after), 'an ineligible node needs attention');
      assert.ok(nodeStateLabel(after).includes('ineligible'));

      await client.setNodeEligibility(node.id, true);
      after = (await client.nodes()).find((n) => n.id === node.id)!;
      assert.strictEqual(after.eligibility, 'eligible');

      // drain with a short deadline, then cancel it
      await client.drainNode(node.id, 600);
      for (let i = 0; i < 20; i++) {
        after = (await client.nodes()).find((n) => n.id === node.id)!;
        if (after.drain) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.strictEqual(after.drain, true, 'the node should be draining');

      await client.stopDrain(node.id);
      for (let i = 0; i < 20; i++) {
        after = (await client.nodes()).find((n) => n.id === node.id)!;
        if (!after.drain) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.fail('stopDrain did not cancel the drain');
    });
  } catch (err) {
    console.log(`skip integration tests (${err})`);
  } finally {
    server?.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} test failed`);
    process.exit(1);
  }
  console.log('\nall tests passed');
}

void main();
