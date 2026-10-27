# Foreground and within-owner SQLite measurements (#67)

This is a bounded synthetic investigation of the current per-user architecture,
not a capacity guarantee. No runtime behavior, scheduler, storage layout or
transaction boundary changes in this investigation.

## Reproduction and safety

Use the supported Node 24 executable and existing project dependencies. From an
isolated checkout, create an output directory outside Git with mode 0700, then run
sequentially (substitute that directory for `/restricted/path`):

```sh
umask 077
node tests/foreground-benchmark.ts small 3 > /restricted/path/small.log 2>&1
node tests/foreground-benchmark.ts bank 3 > /restricted/path/bank.log 2>&1
node tests/foreground-benchmark.ts history 3 > /restricted/path/history.log 2>&1
```

Each repetition launches one disposable server process on an OS-selected IPv4
loopback port and creates new synthetic files under the OS temporary directory.
It does not load `.env`, run `main.ts`, contact Keycloak, start Docker, or use the
application's configured data directory. Files are removed on worker exit and
connections close after requests and upkeep slices. SIGKILL or a machine crash
can leave disposable `study-foreground-benchmark-*` directories for manual cleanup.
The client enforces a three-minute worker limit per repetition; profiles and
repetition counts are bounded. Do not run timing profiles concurrently with one
another or intentionally add load to a production host.

The server calls the real `apiController` with synthetic pre-established actors,
opens `PrivateLibraries` per request, and runs `observeRequest` and connection
cleanup as `main.ts` does. It bypasses OIDC, sessions, static assets, Vite, TLS,
reverse proxies and network distance. A fixture-only header selects one of its
precreated actors; this is not an authentication implementation or a deployable
server. The positional `apiController(repository, actor, origin, previews,
privateLibrary)` call is the HTTP integration seam to update if #62 changes it.
Fixture construction uses stable service/repository boundaries.

## Workload and measurement boundaries

| Profile | Persisted owners | Completed histories for busy owner | Shared / imported bank questions | Shared deletion backlog |
| ------- | ---------------: | ---------------------------------: | -------------------------------: | ----------------------: |
| small   |               10 |                                 10 |                               48 |                       1 |
| bank    |               10 |                                100 |                            1,000 |                      25 |
| history |              100 |                              2,000 |                            1,000 |                     100 |

Other owners each start with ten histories. Each history contains 20 question
snapshots. Half reference the deleted shared bank and half reference that owner's
48-question private bank, with distinct namespaced source IDs. Questions use short
synthetic text and repeated templates, not real question-bank payload sizes or
arbitrary large attachments. Each owner also has an overdue active attempt and an
expired retained deletion. Only one backlog event matches the old shared
snapshots; the remainder exercise irrelevant-event filtering. The live shared
bank is restored after generating those events, with a new source identity.

Setup, imports used for setup, fixture checks and cleanup are outside measured
regions. Before quiz creation the combined pool contains twice the profile bank size
plus 48 questions (shared bank, confirmed private import and original private bank).
The startup recovery measurement is the first complete
`StudyHousekeeping.tick()` after all files and missed work exist, before HTTP
listens. It includes discovery, owned connection opens, deletion reconciliation,
expiry/scoring, retention purge, deadline reconstruction and inter-owner yields.
It excludes process launch, initial schema installation, legacy upgrades and
migration/VACUUM. The recurring measurement forces the next five-second discovery
sweep after foreground work; it does not simulate five real seconds of idle time.
No automatic upkeep timer runs during the foreground phases; the named maintenance
measurements run separately. Concurrent upkeep/request interference is not measured.
The earlier [housekeeping investigation](private-libraries.md#synthetic-housekeeping-measurements)
continues to cover twenty scheduled ticks, idle intervening ticks and due cohorts.

Foreground phases perform one real HTTP request each: private import preview and
confirmation, quiz creation and submission, replay of a shared-event backlog on
a read, private bank deletion with snapshot annotation, shared bank deletion with
an outbox event, and reconciliation of that new event. Outside measurements, the
fixture clears only the busy owner's deletion annotations/cursor to recreate a
lagging owner against the original backlog. No runtime reset or rescan mechanism
is introduced. Private deletion follows replay so its indicators remain available
for final checks. The confirmed import uses a new key and stays present after the
original private bank is deleted.

Busy reads issue five sequential batches of four concurrent `/api/quizzes/due`
requests, alternating the busy owner and a ten-history owner. This is a bounded,
closed-loop concurrency experiment: twenty samples per repetition, ten per owner,
with no offered request rate or coordinated-omission correction. The other owner
can lazily reconcile the single new shared event on its first read. This is not a
steady-state saturation test and does not estimate open-loop production p95/p99.

The JSON output distinguishes:

- `httpLatencyMs`: independent **client-process** monotonic clock immediately before
  `fetch` through full response-body consumption. Includes loopback connection
  setup/reuse, transport, server queueing and response transfer. Client assertion
  and JSON decoding are inside this boundary. Body objects/answer records are
  prepared first; request serialization is included. It is observed HTTP latency
  for this harness, not production end-user latency.
- `requestServiceMs`: server handler entry through awaited controller and
  `observeRequest`/connection cleanup. Includes body reading, synchronous database
  work and response construction; it is not pure SQL time and excludes time
  queued before the handler starts. It is never labeled HTTP latency.
- `workloadElapsedMs`: complete client phase elapsed time, including concurrent
  requests and gaps between closed-loop batches. It is not a sum of latencies.
- `timerDelay`: server one-millisecond interval sample count, maximum observed
  callback gap and excess beyond the requested one millisecond. The probe starts
  before the measured work and drains for five milliseconds before cancellation,
  **including after the final synchronous operation**. Drain time is excluded
  from phase/maintenance elapsed time. Scheduling, GC and competing host load can
  contribute; this is neither SQL attribution nor a hard time budget.
- Opens, active/peak owned connections and correctness counts are separate from
  timing. Nearest-rank distributions retain sample counts: a one-request phase's
  median/p95/max all describe that one observation.

Files and SQLite connections are fresh per repetition, but the OS page cache is
not flushed and setup has just written/read them. These are warm-OS-cache,
process-cold then progressively warmed JavaScript/HTTP measurements, with no
separate JIT warm-up. The first preview can include the first HTTP connection.
No exclusive host, pinned CPU, cold-disk or cache-independent claim is made.

## Correctness and scope

The fixture asserts every startup owner's cursor, completed/active/deleted counts,
then checks final account isolation, zero shared histories, private bank ownership,
new-event cursor progress, deletion indicators and snapshot question/key/options/
score digests. The original completed evidence survives deletion and replay.
Every foreground phase asserts a successful status and counts one owned open per
request with zero connections left active. Submission is checked for its completed
state and expected score. Automated tests cover these stable result/count
invariants and deterministic clock-based probe draining; they impose no machine
latency thresholds. Existing application tests remain the authority for legacy
ambiguity, authorization and rollback semantics; the benchmark does not replace
those contracts.

The completed templates are graded through `QuizService` with empty answers
(score zero) before cloning; the overdue attempt starts from an ungraded template.
Histories share synthetic timestamps and a small repeated question pool. This
exercises large JSON/history traversal but not years of diverse mastery states,
large answer text, highly varied concept mappings, slow disks or many live writers.
A larger diverse pool can cost more. Profile differences change multiple workload
axes and do not isolate a causal scaling coefficient for each axis.

## Captured baseline (2026-10-27)

Three sequential repetitions per profile used Node 24.17.0 on Linux 7.0.0-38-generic,
an Intel Core i5-8265U (advertised 1.60 GHz), eight logical CPUs, 31.1 GiB RAM,
and a local ext4 filesystem for temporary SQLite files. The user’s unrelated local
app and other host tasks remained running. No host services were stopped or controlled.
Initial one-minute host load averages were 2.1 / 1.6 / 1.3 for small/bank/history;
initial free RAM was 13.2 / 13.2 / 13.2 GiB. Load was not isolated or held constant.
Profiles ran sequentially; the captured series began at 2026-10-27T05:45:30.196Z, 2026-10-27T05:45:59.987Z, 2026-10-27T05:46:46.800Z.
Variation includes shared-host load, process warm-up and cache effects. Values below
are milliseconds rounded to one decimal; slash-separated triples are repetitions 1 / 2 / 3.

Observed HTTP latency (one request per phase per repetition; busy row shows the
per-repetition nearest-rank p95 of twenty actual requests):

| Foreground phase                    |              small |                  bank |                  history |
| ----------------------------------- | -----------------: | --------------------: | -----------------------: |
| import-preview                      | 53.4 / 11.8 / 11.9 |    85.8 / 50.6 / 42.5 |       84.6 / 47.4 / 49.0 |
| import-confirm                      | 15.0 / 16.7 / 22.8 |  94.8 / 100.1 / 110.2 |       93.1 / 94.1 / 96.1 |
| quiz-start                          | 68.3 / 50.7 / 52.9 | 523.0 / 515.2 / 483.1 | 2394.3 / 2438.1 / 2480.7 |
| quiz-complete                       |    9.1 / 8.4 / 8.0 |       8.3 / 7.1 / 8.4 |          9.5 / 8.9 / 8.8 |
| foreground-reconcile-backlog        |    7.8 / 9.8 / 9.1 |    23.6 / 27.6 / 20.6 |    284.0 / 267.2 / 267.4 |
| private-delete-with-annotation      |   10.5 / 8.9 / 9.6 |    29.1 / 28.5 / 26.1 |    251.6 / 245.5 / 271.4 |
| shared-delete-event                 |    8.3 / 8.3 / 7.2 |    15.3 / 16.8 / 14.8 |       17.6 / 15.5 / 14.7 |
| foreground-reconcile-new-event      |    9.1 / 8.3 / 8.5 |    17.9 / 34.0 / 20.7 |    128.1 / 134.0 / 132.6 |
| busy-account-reads (20-request p95) | 54.4 / 78.7 / 55.3 | 282.9 / 279.5 / 291.7 | 2920.9 / 2903.8 / 3115.1 |
| busy-account-reads (20-request max) | 65.2 / 90.8 / 67.5 | 292.2 / 291.6 / 293.7 | 2941.4 / 2906.2 / 3194.4 |

Maximum observed **service duration / timer callback gap**, across the three runs.
These two separate server observations are not HTTP latencies:

| Foreground phase               |       small |          bank |         history |
| ------------------------------ | ----------: | ------------: | --------------: |
| import-preview                 |  9.3 / 11.9 |   43.4 / 39.3 |     43.4 / 40.4 |
| import-confirm                 | 20.6 / 21.6 | 106.3 / 104.9 |     93.9 / 92.6 |
| quiz-start                     | 65.1 / 65.5 | 519.7 / 520.2 | 2478.5 / 2479.5 |
| quiz-complete                  |   6.4 / 7.3 |     6.4 / 6.9 |       6.8 / 8.1 |
| foreground-reconcile-backlog   |   7.6 / 8.6 |   25.4 / 26.6 |   278.8 / 280.4 |
| private-delete-with-annotation |   8.3 / 9.5 |   27.0 / 28.1 |   269.7 / 270.3 |
| shared-delete-event            |   6.7 / 7.4 |   15.0 / 15.4 |     15.6 / 16.3 |
| foreground-reconcile-new-event |   6.7 / 7.6 |   31.9 / 32.8 |   131.7 / 132.6 |
| busy-account-reads             | 31.4 / 46.8 | 159.6 / 232.7 | 1653.5 / 3097.2 |

Maintenance elapsed times and timer-gap maxima remain separate from HTTP:

| Work                                                  |                 small |                     bank |                     history |
| ----------------------------------------------------- | --------------------: | -----------------------: | --------------------------: |
| startup-recovery elapsed (three runs)                 | 146.6 / 145.5 / 215.7 |    185.5 / 178.8 / 188.6 |    2064.2 / 2084.6 / 1929.6 |
| startup-recovery maximum timer gap                    |                  26.9 |                     30.3 |                       329.3 |
| recurring-reconciliation elapsed (three runs)         |    48.7 / 54.4 / 58.6 |       52.4 / 51.7 / 54.2 |       569.7 / 581.3 / 603.0 |
| recurring-reconciliation maximum timer gap            |                  18.4 |                     16.2 |                        17.8 |
| Sum of foreground phase workload elapsed (three runs) | 448.7 / 427.0 / 396.5 | 2081.7 / 2070.8 / 2016.6 | 17543.8 / 17691.0 / 18488.4 |

The sum above excludes fixture setup, IPC controls, timer drains, recovery and
verification. Concurrent-request latencies are not summed to derive it. Every run
performed eight single foreground requests plus twenty busy reads (28 owned opens),
and each startup/recurring sweep opened exactly 10 / 10 / 100 owners respectively.
Every phase had timer samples and zero remaining owned connections. Correctness
checks passed in all nine captured runs: the busy owner ended with 12 / 102 / 2,002
histories and cursors 2 / 26 / 101; the other owner retained eleven histories and
its original private bank; the shared database contained no histories. Full synthetic
execution logs are retained in restricted local storage outside Git; only aggregate
measurements are included here. The general tests add a separate small-fixture run
outside this timing series.

## Decision and deployment assumptions

Keep the current storage and scheduler architecture in this PR. The measured
foreground stalls justify a focused optimization follow-up, rather than treating
#70's owner yielding as proof of interactive responsiveness. Start with profiling
and reducing work in quiz creation and due reads: those paths load completed
snapshots and construct mastery/selection state synchronously. Narrow by the
already-authorized owner and certification before decoding unnecessary histories,
and measure reuse of derived state within one request. Investigate candidate
selection for deletion annotation/reconciliation at the source/certification
boundary, retaining exact namespaced provenance and the explicit legacy ambiguity
fallback. These are recommendations, not an attribution of all elapsed time to a
particular SQL query. No query-count or CPU profiler data were collected here.

At the measured 100-history/1,000-question profile, quiz creation already approaches
or exceeds a **proposed** 500 ms interactive-response budget. At 2,000 histories,
multiple foreground operations and an individual recovery slice exceed a
**proposed** 100 ms event-loop-gap budget by substantial margins. These are useful
investigation triggers, not new application SLOs, supported account limits or
machine-independent thresholds. Operators should choose their actual budgets and
rerun on target hardware. Prioritize narrowing when accounts approach these shapes,
or sooner when observed production tails exceed the deployment's budget. The
small profile alone does not justify the maintenance cost of worker infrastructure.

A worker-thread database owner deserves a bounded comparison if focused narrowing
still leaves material server-loop gaps (for example, repeated gaps above that
100 ms budget). Compare latency, throughput, queue wait, memory and restart behavior
before selecting it. A queue on the same event loop does not remove synchronous
blocking; it can only change when work is admitted. Any future worker must own its
connections and preserve request ownership, transactions, snapshot provenance,
cursor durability and isolation. Do not casually yield inside a live transaction,
move borrowed views across threads, or split private deletion's atomic annotation.
No worker, queue, ORM, external database or asynchronous runtime abstraction is
introduced by these measurements.

Assume one application process with persistent local SQLite storage and moderate
concurrency; all foreground requests still share its JavaScript event loop. There
is no demonstrated multi-instance or network-filesystem scaling contract. More
idle account files primarily grow discovery/recovery/sweep work; a single busy
owner can still delay unrelated users. Startup recovery must finish before serving
HTTP and needs a deployment-specific readiness timeout with headroom above these
samples. A five-second sweep is a discovery cadence, not a reconciliation latency
ceiling or a guarantee that a large population fits within five seconds.
Directory enumeration, deadline selection, per-owner histories, bank import and
individual SQLite busy waits remain unbounded in time. These results justify
neither a universal account cap nor claims that broad import/query latency is
solved. Diverse long-term histories, larger banks, lock contention, slow/cold disks,
legacy migration/VACUUM and production authentication/network costs remain outside
this bounded investigation.
