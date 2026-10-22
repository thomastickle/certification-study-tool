# Compiler resource experiment — 2026-10-22

This is a new resource-instrumented run of the existing comparison. The previous
[timing report](compiler-benchmark.md), [successful timing samples](compiler-benchmark-results.json),
and [initial failed native-check samples](compiler-benchmark-initial-results.json) are preserved.
The source, tests, TS/Vite configuration, root lockfile, and Vite client declaration are unchanged
from benchmark commit `a51f903`. Production compiler selection is unchanged.

## Measured results

Medians of five successful runs per case (all 35 measured cases and seven warmups passed).

| Case            | Wall s | User CPU s | System CPU s | Avg CPU % | RSS high-water KiB | Input ops | Output ops | Input ops/s | Output ops/s |
| --------------- | -----: | ---------: | -----------: | --------: | -----------------: | --------: | ---------: | ----------: | -----------: |
| TS 5.9.3 check  |  5.082 |       9.47 |         0.33 |     192.6 |             485696 |         0 |          0 |         0.0 |          0.0 |
| TS 5.9.3 + Vite |  6.787 |      11.99 |         0.58 |     184.8 |             484188 |         0 |        808 |         0.0 |        119.0 |
| Go 7.0.2 check  |  0.742 |       3.12 |         0.24 |     452.8 |             285280 |         0 |          0 |         0.0 |          0.0 |
| Go 7.0.2 + Vite |  2.473 |       5.50 |         0.48 |     240.9 |             352724 |         0 |        808 |         0.0 |        326.8 |
| tsrs check      |  0.215 |       0.61 |         0.08 |     320.9 |             110516 |         0 |          0 |         0.0 |          0.0 |
| tsrs + Vite     |  1.964 |       3.08 |         0.29 |     171.4 |             352212 |         0 |        808 |         0.0 |        411.5 |
| Vite alone      |  1.669 |       2.40 |         0.18 |     154.6 |             354508 |         0 |        808 |         0.0 |        484.1 |

| Case            | Major faults | Minor faults | Voluntary switches | Involuntary switches |
| --------------- | -----------: | -----------: | -----------------: | -------------------: |
| TS 5.9.3 check  |            0 |       114484 |               7002 |                  279 |
| TS 5.9.3 + Vite |            0 |       185095 |               9615 |                  421 |
| Go 7.0.2 check  |            0 |        82285 |               1001 |                 1119 |
| Go 7.0.2 + Vite |            0 |       152822 |               3456 |                  833 |
| tsrs check      |            0 |        17729 |                362 |                  837 |
| tsrs + Vite     |            0 |        88622 |               2879 |                  960 |
| Vite alone      |            0 |        70835 |               2545 |                  114 |

Run started `2026-10-22T07:28:49.368Z` at harness commit `853d2118ed85e19f9aa245144db2d029049b7596`.
Host: linux 7.0.0-38-generic x64; Intel(R) Core(TM) i5-8265U CPU @ 1.60GHz; 8 logical CPUs; 31.07 GiB RAM.
Load averages (1/5/15 minutes): start `[2.61, 1.98, 1.76]`, end `[2.83, 2.32, 1.92]`.
Free RAM: 10.88 GiB at start, 10.95 GiB at end.
Node v24.17.0, npm 11.13.0, Vite 7.3.7.

Exact compiler version output:

- ts59: `Version 5.9.3`; project accepted and TS2322 probe rejected.
- ts7: `Version 7.0.2`; project accepted and TS2322 probe rejected.
- tsrs: `Version 7.1.0-dev.20260930.4 (tsrs 0.18.0-ts7.1.0-dev.20260929, microsoft/TypeScript@b85298b6a81f)`; project accepted and TS2322 probe rejected.

All 20 measured builds plus four build warmups matched the reference manifest, which also matches
the previous successful timing run. [Sanitized per-run and per-phase results](compiler-resource-benchmark-results.json)
include complete counters, timing ranges, config/lock hashes, order, and artifact hashes.

## Accounting and reproducibility

Run `npm run benchmark:compilers` with the existing isolated compiler dependencies installed.
Linux `/usr/bin/time` is required. The harness launches that binary around each checker and Vite
phase; counters come from kernel resource accounting, not process sampling. GNU time reports
`time (GNU Time) UNKNOWN` on this host; its executable SHA-256 is
`3b11dec50514a8473e9f6efa7a34d584d0657538c09988f61b72d38ad4991a10`.

CPU seconds and counters include threads and waited children. Descendants are included only when
the intermediate parents wait for them. The installed Go launcher uses `execFileSync`; the tsrs
launcher spawns and observes its child's exit. This captures their short-lived compiler children.
A harness integration test exercises a CPU-consuming waited child. Detached or un-reaped descendants
are outside this accounting guarantee; this is not a validated census of every Vite descendant.

Linux RSS is in **KiB**, and child RSS is the largest child's high-water mark, not the simultaneous
resident size of the whole tree. Pipeline `peakRssKiB` is the **maximum of the sequential phase
high-water marks**, not their sum. CPU, faults, context switches, and filesystem counters are summed
across phases. Filesystem input/output counters are **operations**, not logical bytes, read/write
syscall counts, or verified device transfers. Zero input operations does not mean no files were read.
These boundaries follow the [Linux rusage documentation](https://man7.org/linux/man-pages/man2/getrusage.2.html).
No `/proc` byte sampling, host-wide I/O attribution, or MB/s estimate is presented.

Wall time uses Node's monotonic clock around each GNU-time-wrapped command and around the pipeline.
Pipeline wall time includes wrapper launch, phase transitions, and reading the small counter files;
it excludes artifact hashing and private log writing. CPU time is printed by GNU time to hundredths
of a second. Average CPU percent is `100 * (user + system CPU seconds) / wall seconds`, and can exceed
100 for parallel work. Operation rates divide each run's summed counters by that run's wall seconds.
Every summary column is the median of per-run values, including rates and CPU percent; ratios of
unrelated medians are not used. Phase values remain available in the sanitized JSON.

There is one warmup followed by five sequential, rotating/interleaved measured rounds per case.
Processes are fresh and filesystem caches warmed. No caches, scheduler settings, permissions, or
compiler worker settings were changed. No tests/builds/installations from this task ran concurrently
with the benchmark. Other desktop applications and an existing dev server were present; host load,
frequency and thermals were not controlled. This is a local sample, not a general throughput claim.

## Validation and failure behavior

All compiler version/project preflights must succeed, and each intentional bad assignment must be
rejected specifically with TS2322 while resource collection remains valid. Emitted files are hashed
against the unchanged Vite reference after each build. Failed runs are excluded from successful
medians. Baseline warmup/measured failures and missing or malformed resource measurements now cause
a nonzero exit **after saving the summary**. Experimental measured checker failures remain visible
without being counted as successful timings. Preflight failures and artifact mismatches abort early;
private phase logs preserve the diagnostic evidence.

Raw command output and red/green test evidence stay in ignored `private/ai-runs/`, with directories
restricted to the owner. Sanitized results contain counters, versions, hashes, order and manifests,
without raw compiler output or absolute checkout paths. Retain private evidence for 90 days.
Independent review approved the resource accounting and verified all 42 warmup/measured samples
against the private logs. The parent also passed the integrated full check and eight harness tests.

## Executed checks

`npm run check` passed: formatting, project lint, 156 tests, TS 5.9 typecheck and Vite build.
`npm run benchmark:compilers:test` passed all eight harness tests, including preserved red/green
regressions for baseline exit behavior and resource collection. Explicit benchmark ESLint and
`git diff --check` passed. Gitleaks scanned the scoped patch with redaction and found no secrets.
The resource benchmark exited 0. No container build or independent review was run by this sub-agent.
