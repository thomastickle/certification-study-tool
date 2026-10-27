# Request-local study history reuse (#81)

This delivers the request-local optimization slice of #81. Completed snapshots
remain authoritative. No persistent summary, schema change, worker pool or startup
rebuild is introduced. #81 remains open for the persistent-summary decision and
implementation, if accepted, and independent review.

## Cause and change

Quiz creation independently reconstructed saved identities for mastery and
variation recency. Incomplete scoring also caused mastery replay to reconstruct
the same saved identity a second time. Current-library identities were repeatedly
computed during boosting, variation draws and alternate checks. Review-mode
creation additionally loaded and replayed history again inside due selection.

`masteryHistory` now validates each saved identity once and derives both mastery
and recency in that traversal. Scoring validation remains separate: a valid
identity with incomplete scoring is still an unknown encounter, and recency still
accepts only completed snapshots with finite completion times. Contradictory keys
still supply no identity. The standalone recency implementation remains available
as a reference contract in tests.

Quiz start loads one history/library context after scoring expired attempts.
Due reads load theirs after expiry/purge. Review starts reuse the start context.
The current identity index uses exact question-record objects and validates each
occurrence with its source's provider/certification. It never deduplicates by an
untrusted saved fingerprint, question ID, or content alone. Invalid identities
are retained as null entries. Indexes live only in the current invocation; neither
snapshot evidence nor a service instance carries a cache into another request.

Selection quotas, deduplication, boost weights, random draws, direct concept
membership, and source preference remain in the existing selection algorithm.
Its optional identity index also lets deterministic tests compare indexed and
uncached draws with the same random inputs.

## Comparable measurements

Measured on 2026-10-27 using Node 24.22.1, Linux, an Intel i5-8265U (eight logical
CPUs), and existing lockfile dependencies. Base is merged master
`fe9fc2a8bc8cf0fc8d4e08770584140ed7f9fb94`; head uses this change. The same final
benchmark instrumentation was applied before measuring base: one standalone due
read, per-actor contention latency/service distributions, and process memory
sampling. Formatting subsequently changed no harness behavior.

Each profile has three sequential repetitions with fresh synthetic files and
OS-selected loopback ports. Runs were sequential: base history, base CPU profile,
base small, head history, head small, head CPU profile. Tests were not running
during these timed comparisons. They use the final PR #80 fixture and real HTTP
controller, bypass authentication, and exclude fixture construction. See
[the original methodology](performance-investigation.md) for boundaries,
closed-loop limitations, deletion workload, and correctness assertions. These
numbers supersede neither historical measurements nor production latency data.

The history profile has 2,000 busy-account completed attempts with 20 snapshots
each, a 1,000-question shared bank and matching imported bank, 100 owners, and a
100-event deletion backlog. Other accounts have ten histories. The small profile
has ten histories per account, 48-question banks, ten owners, and one backlog event.

All times below are milliseconds. For single-operation phases, values are the
median of three observations, followed by the observed range. A timer gap is the
maximum callback gap within each phase, including a drain after the last slice;
the table summarizes those three maxima. It is not a hard realtime limit.

| Workload / operation |              Base HTTP |           Head HTTP |           Base service |        Head service |         Base timer gap |      Head timer gap |
| -------------------- | ---------------------: | ------------------: | ---------------------: | ------------------: | ---------------------: | ------------------: |
| History quiz start   | 2545.7 (2523.7–2556.9) | 948.5 (946.9–995.8) | 2544.8 (2522.5–2554.3) | 947.6 (945.1–995.1) | 2545.9 (2523.8–2555.3) | 948.6 (945.4–996.0) |
| History due read     | 1521.9 (1470.5–1564.4) | 878.2 (850.7–879.2) | 1521.2 (1469.9–1562.7) | 875.1 (850.0–878.4) | 1522.1 (1470.7–1564.0) | 876.8 (850.8–879.3) |
| Small quiz start     |       47.7 (46.7–49.3) |    49.9 (19.8–53.6) |       46.0 (45.9–48.3) |    44.7 (19.1–50.4) |       46.7 (46.2–49.3) |    45.7 (19.9–52.0) |
| Small due read       |       25.5 (22.8–27.9) |    19.8 (19.6–32.2) |       23.9 (22.1–27.1) |    18.9 (18.2–30.9) |       25.2 (22.8–27.9) |    19.6 (19.5–32.4) |

The history quiz-start median improved about 63%; due-read median improved about
42%. Small quiz-start HTTP samples overlap substantially and the median did not
improve; no general small-workload latency claim follows from these few runs.

Contention uses five sequential batches of four concurrent due requests,
alternating busy and other account: ten samples per actor per repetition. Below
are medians of the three per-repetition medians, plus the largest observed HTTP
sample across all repetitions. This is not an open-loop production tail estimate.

| Workload / actor      | Base HTTP median | Head HTTP median | Base HTTP max | Head HTTP max | Base service median | Head service median |
| --------------------- | ---------------: | ---------------: | ------------: | ------------: | ------------------: | ------------------: |
| History busy account  |           1674.1 |            883.7 |        3303.9 |        1779.5 |              1565.7 |               849.8 |
| History other account |           1700.3 |            892.5 |        3328.3 |        1789.2 |                10.6 |                 6.5 |
| Small busy account    |             24.7 |             13.4 |          62.4 |          44.4 |                11.7 |                 8.4 |
| Small other account   |             44.3 |             27.2 |          75.2 |          50.7 |                11.0 |                 6.9 |

History contention's median maximum timer gap fell from 3234.7 to 1710.3 ms;
the largest observed gap fell from 3290.2 to 1785.1 ms. The other account's small
service time alongside its much larger HTTP time demonstrates remaining shared
event-loop queueing.

Memory is whole-process RSS sampled at phase start and on the one-millisecond
probe, not allocation attribution or a guaranteed peak during a synchronous
slice. Median sampled peak RSS across three runs, in MiB:

| Phase      | Base small | Head small | Base history | Head history |
| ---------- | ---------: | ---------: | -----------: | -----------: |
| Quiz start |      123.9 |      121.8 |        317.0 |        343.4 |
| Due read   |      128.9 |      126.9 |        354.3 |        348.2 |
| Contention |      129.4 |      127.6 |        493.1 |        354.9 |

Start/end `process.memoryUsage()` fields are retained in the private logs. GC
placement varied: history head quiz-start ending heap ranged 16.4–141.6 MiB,
and head due-read ending heap ranged 16.5–102.8 MiB. Base ending heaps were about
64.5 and 16.5 MiB respectively. The higher head quiz-start RSS and heap variation
preclude a blanket memory-reduction claim. No cache survives a request.

## CPU attribution

One additional CPU-profiled history repetition per revision is diagnostic, not
part of the repeated timing comparison. The profiler is inherited by the fixture
worker. Analysis includes only `QuizService.start` or `QuizService.due` call trees
beneath `http-controller`; setup calls and submission/report paths are excluded.
Due attribution aggregates the standalone read and twenty contention reads
(eleven busy-account and ten other-account requests), separately from quiz start.
All categories include callees; nested categories must not be added together.

| Sampled inclusive CPU, seconds | Base start | Head start | Base due aggregate | Head due aggregate |
| ------------------------------ | ---------: | ---------: | -----------------: | -----------------: |
| Selected HTTP call tree        |      2.555 |      0.995 |             17.574 |              9.483 |
| Saved-question identity        |      1.863 |      0.666 |             13.940 |              6.583 |
| Current-question identity      |      0.287 |      0.026 |              0.386 |              0.167 |
| Completed SQL + JSON           |      0.193 |      0.168 |              1.828 |              1.633 |
| Mastery replay                 |      0.047 |      0.047 |              0.614 |              0.470 |

Saved identity validation remains about 69% of the head due call-tree samples;
SQL/JSON contributes about 17%. These are sampled inclusive categories, not
instrumented service durations, and GC/native attribution and host conditions
limit precision. Replay itself is much smaller than normalization. The due tree
shows its own measured proportions; it was not inferred from quiz start.

## Persistent-summary decision and remaining scope

The remaining roughly 0.85–1.0 second synchronous operation and 1.79 second other
account contention sample are material. Measurements justify evaluating a
persistent validated-evidence/summary design next; they do not justify declaring
#81 fully solved. That is a distinct mutation/recovery outcome requiring the
parent's design decision before implementation, so this PR stops at request reuse.

A follow-up should compare persisting validated per-attempt events with storing
only aggregate mastery/recency. Validated events target the dominant normalization
cost and permit replay after removing an earlier attempt. Aggregate state alone
needs enough ordering/evidence to recover noncommutative mastery transitions.
Both add write coordination, version management, and failure recovery obligations.

Before implementing either, define account and exact provider/certification scope,
identity/evidence and mastery-rule versions, snapshot revision/staleness detection,
and an atomic boundary with completion, delete, restore and purge. Library/source
changes must resolve current availability without deleting lifetime obligations.
Unknown or contradictory legacy evidence must retain its existing interpretation.
Restart/version-mismatch reconstruction needs a bounded or lazy strategy, measured
rebuild cost and tests proving recovery; no rebuild cost has been measured here
because this slice persists nothing. The parent has been given the remaining
latency and these tradeoffs rather than an expanded implementation.

`completed()` still decodes every completed snapshot for the account before
certification filtering. Saved normalization/hashing and history replay remain
synchronous and linear in history; current library loading/identity construction
remain linear in bank size. SQL-side certification filtering merits separate
measurement and compatibility checks for legacy/malformed scope. No per-account
latency guarantee, large diverse concept-bank benchmark, cold-disk experiment,
authentication benchmark, production data test, or worker isolation is supplied.

## Verification and evidence

Stable tests cover one saved-content validation even for incomplete scoring,
contradictory keys, invalid timestamps, unfinished attempts, provider namespace
separation, exact-record current identity indexing (including changed keys and
null identities), deterministic indexed/uncached weighted concept draws, one
history/library load per quiz/review start, and fresh state across submit,
delete/restore, source removal/replacement and retention purge. Existing tests
cover SQLite persistence, shared/private provenance, account/certification
isolation, expiry, scheduling and legacy ambiguity. The benchmark retains exact
snapshot/evidence and annotation checks; no wall-clock CI threshold is added.

Executed with the supported Node 24.22.1 binary:

- Red checkpoint: `node --test tests/study-history-reuse.test.ts` failed because
  shared recency was absent and quiz start loaded questions three times and
  sources 22 times. Initial fixture mistakes were corrected before that checkpoint.
- Green focused checks: 22 tests passed using
  `node --test --test-concurrency=1` with study-history-reuse, question-identity,
  quiz-selection, quiz-deletion, mastery-history, concept-variations,
  certification-scoping, and foreground-benchmark test files.
- `npm run check`: formatting, ESLint, all 340 tests, TypeScript native typecheck
  and Vite production build passed. Its existing runner retains its normal file
  concurrency. The separate paired timing runs had no concurrent test runs.
- `node tests/foreground-benchmark.ts history 3` and `small 3` passed on both
  revisions, as did one CPU-profiled `history 1` run per revision. Every run
  completed its correctness assertions and normal child shutdown.
- `git diff --check` passed. Redacted staged Gitleaks and commit-range publication
  scans are required before pushing; their results are recorded in the PR.

An attempted `NODE_OPTIONS=--test-concurrency=1 npm run check` was rejected by Node
before execution because that flag is not allowed in `NODE_OPTIONS`. The actual
full check above ran unmodified; the separate focused command controls concurrency
through the supported CLI flag. No checks or gates were disabled.

Private synthetic evidence is retained outside Git at
`/tmp/study-issue81-Nei9hV` (directory 0700, logs/profiles 0600). It includes raw
base/head small/history logs, CPU profiles, attribution script, and red/green and
final verification logs. Do not upload raw logs/profiles without review. No `.env`,
private data, personal databases, running application, Docker volumes, or ports
3000/8080 were accessed. Root checkout and its `.run` were left untouched;
existing dependencies were copied into the isolated worktree.

Implementation provenance: one GPT-6.1 Sol agent, medium reasoning, with no
subagents, watchers, model escalation, installations or CI polling. Independent
review and CI assessment belong to the parent; this PR remains draft.
