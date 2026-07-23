// Unit tests (pure renderers) + integration test against a throwaway local
// `nomad agent -dev` (skipped when the binary is not available).
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { NomadClient, JobSummary, PlanResult, desiredFromJob, tokenSentInClear, taskEventIsOom, mapPool } from '../src/core/api';
import { renderSnapshot, renderPlanDiff, buildIncidentBundle, jobHealth, allocWarnings } from '../src/core/report';
import { ACTIONS, confirmMessage } from '../src/core/actions';
import { aggregateDeployment, deployStatus, deployStatusBar } from '../src/core/deploy';
import { grepLogs, renderGrepReport, LogSource } from '../src/core/grep';
import { decideVulncheckFix, VulncheckState } from '../src/core/vulncheck';

// Spec di riferimento usato dai test di integrazione. A livello di modulo cosi'
// da poterlo lintare anche quando `nomad` non c'e' (integrazione skippata).
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
        { id: 'n1', name: 'worker-01', status: 'ready', drain: false },
        { id: 'n2', name: 'worker-02', status: 'ready', drain: true },
      ],
      [
        {
          id: 'd1',
          jobId: 'packager',
          status: 'running',
          description: 'canary in corso',
          desired: 3,
          placed: 2,
          healthy: 1,
          unhealthy: 0,
          canaries: 1,
        },
      ]
    );
    const problemsSection = md.split('## ⚠ Da guardare')[1].split('## Tutti i job')[0];
    assert.ok(problemsSection.includes('| packager |'), 'packager should be flagged');
    assert.ok(!problemsSection.includes('| transcoder |'), 'transcoder healthy, not in problems');
    assert.ok(md.includes('worker-02'), 'drain node listed');
    assert.ok(md.includes('canary in corso'));
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
    assert.ok(renderPlanDiff({}).includes('Nessuna differenza'));
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

  await test('taskEventIsOom: match stretto (no falsi da "zoom"/"room")', () => {
    assert.strictEqual(taskEventIsOom({ Details: { oom_killed: 'true' } }), true);
    assert.strictEqual(taskEventIsOom({ DisplayMessage: 'Out of memory (OOM) killed' }), true);
    assert.strictEqual(taskEventIsOom({ DisplayMessage: 'OOMKilled' }), true);
    assert.strictEqual(taskEventIsOom({ Type: 'Terminated', DisplayMessage: 'Exit Code: 0' }), false);
    assert.strictEqual(taskEventIsOom({ DisplayMessage: 'joined zoom room' }), false); // niente falso positivo
    assert.strictEqual(taskEventIsOom({}), false);
  });

  await test('mapPool: esegue tutto, in ordine, senza superare il limite di concorrenza', async () => {
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
    assert.ok(maxInFlight <= 3, `concorrenza max ${maxInFlight} deve essere <= 3`);
    assert.ok(maxInFlight >= 2, `deve girare in parallelo (max osservato ${maxInFlight})`);
    // limite maggiore del numero di item: nessun crash, tutti eseguiti
    assert.deepStrictEqual(await mapPool([1, 2], 10, async (n) => n + 1), [2, 3]);
    assert.deepStrictEqual(await mapPool([], 4, async (n) => n), []);
  });

  await test('allocWarnings: OOM e restart loop oltre soglia (default 3)', () => {
    assert.deepStrictEqual(allocWarnings({ restarts: 0, oom: false }), []);
    assert.deepStrictEqual(allocWarnings({ restarts: 2, oom: false }), []); // sotto soglia
    assert.deepStrictEqual(allocWarnings({ restarts: 5, oom: false }), ['restart loop ×5']);
    assert.deepStrictEqual(allocWarnings({ restarts: 0, oom: true }), ['OOM']);
    assert.deepStrictEqual(allocWarnings({ restarts: 4, oom: true }), ['OOM', 'restart loop ×4']);
  });

  await test('grepLogs: match case-insensitive di default, numeri di riga, opzione sensibile', () => {
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
    // case sensitive: solo "error" minuscolo
    const cs = grepLogs(sources, 'error', { caseSensitive: true });
    assert.strictEqual(cs.length, 1);
    assert.strictEqual(cs[0].alloc, 'bbbb2222');
    // query vuota → nessun match
    assert.deepStrictEqual(grepLogs(sources, ''), []);
  });

  await test('renderGrepReport: intestazione, conteggi e raggruppamento per alloc', () => {
    const md = renderGrepReport('packager', 'timeout', [
      { alloc: 'aaaa1111', task: 'app', type: 'stdout', line: 5, text: '  timeout waiting  ' },
      { alloc: 'aaaa1111', task: 'app', type: 'stderr', line: 9, text: 'timeout again' },
    ]);
    assert.ok(md.includes('grep "timeout" — packager'));
    assert.ok(md.includes('2 match in 1 allocation.'));
    assert.ok(md.includes('## alloc aaaa1111'));
    assert.ok(md.includes('`app/stdout:5` timeout waiting'), 'riga trimmata con posizione');
  });

  await test('deploy: aggrega i task group, deriva stato e riga status bar', () => {
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

  await test('actions: stop/restart distruttivi, stop richiede digitazione, start no', () => {
    assert.strictEqual(ACTIONS.stopJob.destructive, true);
    assert.strictEqual(ACTIONS.stopJob.requireType, true);
    assert.strictEqual(ACTIONS.restartAlloc.destructive, true);
    assert.strictEqual(ACTIONS.restartAlloc.requireType, false);
    assert.strictEqual(ACTIONS.startJob.destructive, false);
    assert.ok(confirmMessage('stopJob', 'packager').includes('packager'));
    assert.ok(confirmMessage('stopJob', 'packager').includes('mutativa'));
    assert.ok(!confirmMessage('startJob', 'packager').includes('mutativa'));
  });

  await test('desiredFromJob: somma i Count dei task group (0 se assenti)', () => {
    assert.strictEqual(desiredFromJob({ TaskGroups: [{ Count: 3 }, { Count: 2 }] }), 5);
    assert.strictEqual(desiredFromJob({ TaskGroups: [{ Count: 1 }, {}] }), 1); // Count mancante = 0
    assert.strictEqual(desiredFromJob({ TaskGroups: null }), 0);
    assert.strictEqual(desiredFromJob({}), 0);
  });

  await test('tokenSentInClear: token in chiaro solo su http verso host non locale', () => {
    assert.strictEqual(tokenSentInClear('http://nomad.example:4646', true), true);
    assert.strictEqual(tokenSentInClear('https://nomad.example:4646', true), false);
    assert.strictEqual(tokenSentInClear('http://127.0.0.1:4646', true), false);
    assert.strictEqual(tokenSentInClear('http://localhost:4646', true), false);
    assert.strictEqual(tokenSentInClear('http://nomad.example:4646', false), false); // nessun token
    assert.strictEqual(tokenSentInClear('non-un-url', true), false);
  });

  await test('vulncheck auto-fix: interviene solo su "Prompt", con scope e target giusti', () => {
    const base: VulncheckState = {
      goExtensionInstalled: true,
      autoFixEnabled: true,
      fixTarget: 'Off',
      effectiveValue: 'Prompt',
    };
    // caso tipico: default implicito "Prompt", nessun override -> fix globale a Off
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
    // no-op: valore gia' valido, auto-fix off, Go extension assente
    assert.strictEqual(decideVulncheckFix({ ...base, effectiveValue: 'Off' }).action, 'none');
    assert.strictEqual(decideVulncheckFix({ ...base, effectiveValue: 'Imports' }).action, 'none');
    assert.strictEqual(decideVulncheckFix({ ...base, effectiveValue: undefined }).action, 'none');
    assert.strictEqual(decideVulncheckFix({ ...base, autoFixEnabled: false }).action, 'none');
    assert.strictEqual(decideVulncheckFix({ ...base, goExtensionInstalled: false }).action, 'none');
  });

  // Regressione: HCL2 (Nomad >= 1.x) rifiuta un blocco single-line con piu' di
  // un argomento, es. `resources { cpu = 100, memory = 64 }`. Girava solo in CI
  // (dove `nomad` c'e'); questo lint gira sempre e blocca la fixture a monte.
  await test('hcl fixture: nessun blocco single-line multi-argomento (HCL2)', () => {
    const bad = HCL.split('\n')
      .map((line, i) => ({ n: i + 1, line }))
      // ignora le virgole dentro le stringhe (es. un valore "a,b")
      .filter(({ line }) => /\{[^{}]*,[^{}]*\}/.test(line.replace(/"[^"]*"/g, '""')));
    assert.deepStrictEqual(
      bad.map((b) => b.n),
      [],
      `blocchi single-line multi-arg alle righe: ${bad.map((b) => `${b.n} (${b.line.trim()})`).join(', ')}`
    );
  });

  // --- integration: throwaway nomad agent -dev ----------------------------------
  const bin = process.env.NOMAD_BIN || 'nomad';
  const port = 44000 + Math.floor(Math.random() * 1000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomadlens-'));
  let server: ChildProcess | null = null;

  try {
    if (spawnSync(bin, ['version'], { stdio: 'ignore' }).error) {
      throw new Error(`binario '${bin}' non disponibile`);
    }
    fs.writeFileSync(path.join(tmp, 'config.hcl'), `ports { http = ${port} }\n`);
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
      assert.ok(renderPlanDiff(plan).includes('Nessuna differenza'));
    });

    await test('integration: allocations listing does not throw', async () => {
      const allocs = await client.allocations('lens-demo');
      assert.ok(Array.isArray(allocs));
    });

    await test('integration: stopJob deregistra il job', async () => {
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
      assert.fail('lens-stopme ancora attivo dopo stopJob');
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
