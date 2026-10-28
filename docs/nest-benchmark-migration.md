# Foreground benchmark transport migration

This is harness correctness work, not a comparative timing report. Issue #81
remains open; the normal quiz/due target remains below 300 ms, preferably 200 ms.
Do not run comparative series while sibling checks or other benchmarks compete.

## Nest execution

Use supported Node 24.22.1 and repository-local dependencies:

```sh
export PATH=/home/ttickle/.nvm/versions/node/v24.22.1/bin:$PATH
npm ci
npm run build:server
node tests/foreground-benchmark.ts small 1
```

The native parent selects `build/tests/foreground-benchmark-worker.js`. TS6 emits
that worker and its imports through `tsconfig.server.json`; native stripping cannot
execute decorated Nest modules. There is no loader, Jest or Vite in this profile.
The worker calls `createApplication` with the same LibraryHttpModule and
StudyHttpModule as production, with one ApplicationRuntime. Public web serving is
excluded because the workload is API-only. No old dispatcher is mounted.

Synthetic issuer/subject identities and durable sessions are seeded through
AccountRepository outside samples. Only random session cookies and account
workspace bindings cross private IPC. Requests use normal Cookie,
X-Study-Account, Host and Origin policy. No provider or cloud request occurs.
The configured origin URL is finalized with the OS-selected loopback port before
any HTTP request. Credentials are never written to benchmark JSON.
The compiled boundary regression proves actor headers cannot authenticate, a real
session succeeds with security response headers, and a stale workspace fails 409.

The instance's real PrivateLibraries.open and StudyLibraryScope are observed.
Each sampled request must open one connection, observe its actor while storage
is still open, and finish with zero active connections. Body/service/observation/
close remain inside the real scope. Its service metric excludes admission/guards;
the legacy service metric began at its manual Node handler. HTTP samples on both
paths consume the entire response, including authentication and transport costs.
Do not compare these service metrics as identical boundaries.

## Scheduling and phases

Production defaults still await startup upkeep and run the unreferenced one-second
interval using the real monotonic clock. An explicit app-local
`housekeepingSchedule` disables automatic interval ticks and supplies the benchmark
monotonic clock. This is necessary to preserve exact work-count assertions without
racing background sweeps. It does not stop upkeep observation or change services,
authentication, security or request ownership. The benchmark advances the clock
5000 ms for each explicit reconciliation, just as the legacy adapter did.

Fixture seeding uses the actual runtime graph after its empty initial startup.
`startup-recovery` measures the explicit seeded recovery pass, not process/Nest
bootstrap. `initialSchemaOpenMs` now includes empty runtime composition; it is
not an isolated SQLite schema comparison. Full fixture creation/compilation are
outside HTTP samples. Both adapters retain separate recurring, write, reopen,
replay, schema/backfill/version/corruption recovery, timer delay and RSS phases.
The automatic production background workload is deliberately not measured here.

Chronology/scoring, answered confidence diversity, due/recovery states, history
IDs/digests, deletion labels/cursors, actor-specific returned summaries and
persisted/current projection checks are retained. Recovery is checked again after
evidence-cost probes. Parent deadline and SIGTERM/SIGKILL escalation remain in
force. Normal IPC disconnect awaits app closure before removing files; roots close
last through Nest. Forced kills cannot guarantee artifact cleanup.

## Pinned reconstruction and later measurement

The runner exports exact revisions with git archive, never Git worktrees. It
selects a native legacy adapter for the pre-Nest baseline and a compiled Nest
adapter for Nest revisions. The legacy adapter is an inert `.ts.fixture` snapshot
so removed legacy modules are not compiled by the current project. It intentionally
retains the old authentication bypass; it is not evidence of equivalent auth cost.
The parent/workload/history/lifetime/metrics overlays are common. Archive tarballs,
source SHA256 manifests, exact overlay patches, emitted manifests, build logs,
runner snapshot and dependency lock are retained in restricted evidence directories.
Dependencies are reused from the current harness node_modules rather than installed
per revision; dependency-lock.json records that policy's lockfile. Historical reports
remain historical and are not relabeled as Nest results.

After parent integration and independent review, with no competing work:

```sh
umask 077
/usr/bin/flock /tmp/study-nest-final-check.lock python3 scripts/compare-study-performance.py \
  --base fcf980bcc1f45e61a251cd3584fadb200e62a023 --head <integrated-exact-sha> \
  --profiles small bank history diverse --repetitions 3
```

For reconstruction correctness only use `--profiles small --repetitions 1`.
Shared-host smoke times are not comparative evidence. Final timing, CI,
independent review, integration and readiness belong to the parent.
