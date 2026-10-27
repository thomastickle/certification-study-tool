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

## Corrected comparable measurements (2026-10-27)

Independent review round 1 found that the prior fixture captured its epoch before
templates started, then replaced clone completion times with that earlier epoch.
All ordinary cloned histories therefore had `finishedAt < startedAt`; scoring
was rejected as unknown. The overdue clone also finished before its start.
The old 63% quiz-start and 42% due-read gains, contention/memory tables and CPU
percentages are retired as valid completed-history claims. They describe only
the historical malformed-time workload retained in `/tmp/study-issue81-Nei9hV`.
They are not mixed with the corrected measurements below. The inherited
[performance investigation](performance-investigation.md) and issue #81 also
carry this qualification. Its historical tables remain historical flawed-workload
evidence, not a valid-history baseline.

The correction uses a fixed past service clock: templates start 60 seconds before
the epoch and are graded at the epoch, within their original 20-minute deadline.
Clones retain all of those timer fields. The active recovery attempt starts exactly
20 minutes before its already-expired deadline, with a matching server timestamp.
The expired deleted attempt completed before deletion, with the actual 48-hour
retention interval. These are unpaused attempts: complete empty pause histories,
no active pause, and coherent start/server/completion/deadline fields. There is no
separate persisted elapsed-time field. Before startup and again after recovery,
every completed question must pass the real `completedEvidence` boundary, in
addition to timing and pause checks. Snapshot-preservation checks remain intact.
No production scoring, validation, lifecycle or selection code changed here;
malformed/legacy regression tests remain separate and unchanged.

Both measured sources are pinned: base master
`fe9fc2a8bc8cf0fc8d4e08770584140ed7f9fb94` and reviewed optimization head
`9c7549686cc5f99957ef6e57b1d8819cf7a95159`, each with the same final corrected
fixture and instrumentation. Full source snapshots, SHA-256 manifests and exact
patches from each pinned revision are retained. `foreground-benchmark.ts` is
identical between them, including standalone due reads, per-actor service/HTTP
summaries and memory sampling. No other production-source edits were applied to
either snapshot. Node 24.22.1, existing lockfile-compatible dependencies, Linux
and an Intel i5-8265U with eight logical CPUs were used.

Final runs were sequential: base history 3, base small 3, head history 3, head
small 3. No tests or other benchmarks ran concurrently. A preliminary head series
predating the final expired-deletion retention adjustment is retained separately
and excluded. Each repetition uses fresh synthetic files and OS-selected loopback
ports, with the real HTTP controller and request-owned connections, bypassing
OIDC. Setup and pre-sampling evidence checks are excluded from HTTP timings.
Source snapshots and fixture assertions warm code/data; there is no independent
JIT warm-up, cold-disk experiment, exclusive host or CPU pinning. OS caches are
warm from setup. Host metadata is retained in each log.

Workload size and answer distribution are unchanged: history has 2,000 busy-owner
attempts × 20 snapshots, 100 owners, 1,000-question shared/imported banks and 100
backlog events; small has ten histories per owner, ten owners, 48-question banks
and one event. Other owners have ten histories. Histories repeat a small shared/
private template pool, all with empty answers, null confidence and score zero.
Accepted scoring evidence for an unanswered question is not an answered success
or miss. These histories do not create diverse mastery/review obligations. This
workload measures traversal/normalization, not years of varied learning or a
large nonempty due set. The recovered overdue attempt adds one history per owner;
the foreground submission adds one more for the busy owner.

All times are milliseconds. Single-operation cells give the median and range
of three observations. Timer cells summarize each repetition's largest callback
gap, including the post-operation drain; they are not realtime guarantees.

| Workload / operation |              Base HTTP |           Head HTTP |           Base service |        Head service |         Base timer gap |      Head timer gap |
| -------------------- | ---------------------: | ------------------: | ---------------------: | ------------------: | ---------------------: | ------------------: |
| history quiz-start   | 1860.6 (1858.3–1878.9) | 936.3 (930.7–996.9) | 1859.8 (1857.6–1877.0) | 935.6 (928.9–995.9) | 1860.6 (1858.4–1877.5) | 936.4 (929.3–997.0) |
| history due-read     |    910.8 (871.1–925.7) | 902.4 (881.3–971.2) |    910.1 (869.5–925.1) | 900.5 (880.7–970.4) |    910.9 (871.0–925.9) | 901.9 (881.7–971.4) |
| small quiz-start     |       47.5 (43.2–60.1) |    16.6 (15.5–16.8) |       46.6 (42.3–58.1) |    14.4 (14.4–15.8) |       47.6 (43.3–58.5) |    15.5 (15.1–16.7) |
| small due-read       |       19.7 (19.4–21.0) |    19.1 (18.7–21.4) |       19.0 (17.8–20.3) |    18.4 (18.0–19.3) |       19.7 (19.1–21.1) |    19.2 (18.7–19.9) |

History quiz-start HTTP median decreased 49.7% in this bounded series.
Standalone due-read HTTP median was 910.8 → 902.4 ms (about 0.9%), with
overlapping ranges: no substantial due-read gain was demonstrated. The former
42% claim is not representative valid-history evidence. No general small-workload gain
or machine-independent latency guarantee follows from these runs.

Contention uses five closed-loop batches of four due reads, alternating busy and
other owner: ten requests per actor per repetition. Cells are medians of the three
per-repetition medians; HTTP maxima are the largest of all thirty actor samples.
These are not open-loop production tail estimates.

| Workload / actor | Base HTTP median | Head HTTP median | Base HTTP max | Head HTTP max | Base service median | Head service median |
| ---------------- | ---------------: | ---------------: | ------------: | ------------: | ------------------: | ------------------: |
| history busy     |            878.1 |            917.8 |        1878.2 |        1810.3 |               855.1 |               862.1 |
| history other    |            887.8 |            925.5 |        1892.5 |        1825.9 |                12.3 |                 6.9 |
| small busy       |             24.3 |             14.4 |          55.2 |          39.9 |                 8.6 |                 7.5 |
| small other      |             32.0 |             29.5 |          62.4 |          49.8 |                 8.4 |                 7.1 |

History contention timer-gap medians (largest observed gap in parentheses): base 1747.0 (1871.9) ms; head 1752.8 (1799.0) ms. The other owner's small service duration alongside much larger HTTP
latency shows substantial shared event-loop queueing remains.

Memory is whole-process RSS sampled at phase start and by the one-millisecond
probe. It cannot observe every peak inside a synchronous slice or attribute
allocations to an operation. Median sampled RSS in MiB:

| Phase              | Base small | Head small | Base history | Head history |
| ------------------ | ---------: | ---------: | -----------: | -----------: |
| quiz-start         |      123.0 |      123.1 |        425.0 |        404.3 |
| due-read           |      128.1 |      128.1 |        474.6 |        450.5 |
| busy-account-reads |      128.6 |      128.4 |        475.8 |        460.7 |

Start/end RSS, heap, external and ArrayBuffer fields remain in the private logs.
GC placement and retained heap vary; sampled RSS is neither a guaranteed peak nor
evidence for a blanket memory improvement. No cache survives a request.

## Cost interpretation and remaining scope

No fresh CPU percentages are claimed. The previous sampled start/due attribution
used malformed histories and is retired as representative valid-history evidence.
Reviewer's deterministic probe found one saved validation per valid question
in both base and head mastery, versus two/one for rejected scoring. That explains
why the old due-read benefit cannot be extrapolated. Quiz start additionally
avoids a separate recency pass and repeated current-library work; standalone due
already validated valid scoring once before this change.

The corrected timings still show substantial synchronous service and timer gaps.
`completed()` decodes every completed account snapshot before certification
filtering. Saved normalization/hashing and replay remain synchronous and linear
in history; library loading/identity work remains linear in bank size. This
supports evaluating persistent validated events or summaries next, but does not
establish either design's benefit. No persistence, schema, framework, provider,
worker or rebuild implementation is included; #81 remains open.

A parent design decision should compare validated per-attempt events with aggregate
mastery/recency. Events may avoid repeated normalization and allow replay after
older-event deletion; aggregates need enough ordering/evidence to recover
noncommutative transitions. Both require exact account/certification/provenance
scope, identity/mastery versions, snapshot staleness detection, transactional
completion/delete/restore/purge invalidation and bounded restart/rebuild behavior.
Source disappearance must preserve lifetime obligations, and unknown/contradictory
legacy evidence must retain its interpretation. SQL-side scope filtering also
needs separate legacy-compatibility measurement. None of those benefits or
recovery costs has been measured here.

## Verification and reproducibility

The new pre-sampling assertion reproduced red on the original fixture via
`node --test tests/foreground-benchmark.test.ts`: worker setup failed with
`Benchmark scoring evidence must be valid`. After the chronological correction,
`node --test --test-concurrency=1 tests/benchmark-history-evidence.test.ts tests/foreground-benchmark.test.ts`
passed 3/3. Negative guard cases reject backwards completion, premature deadline,
future server time, active pause, incomplete pause metadata and unknown scoring.
Existing malformed/legacy production regression tests were not weakened.

Final `npm run check` passed formatting, ESLint, all 341 tests, native TypeScript
typecheck and Vite build. A separate `node --test --test-concurrency=1` run of
benchmark-history-evidence, study-history-reuse, question-identity, quiz-selection,
quiz-deletion, mastery-history, concept-variations, certification-scoping and
foreground-benchmark tests passed 24/24. Both measured source manifests and patch
hashes were rechecked; all twelve measured repetitions passed their correctness,
request-count, connection, timer and per-actor checks. Publication scan results
are recorded in PR #82 and the private logs.
The parent owns fresh independent review and CI assessment; the PR remains draft.
No CI polling, watchers, new agents, merge or deployment was performed.

Private evidence: `/tmp/study-pr82-correction-MvTUfj` (0700 directories, 0600
files). It retains red/green and final check logs; `base/head-source`,
`base/head-manifest.json`, `base/head-measured.patch`, patch SHA-256 values,
`run.sh`, `run-order.txt`, raw `base/head-history/small.log`, `metrics.py` and
`metrics.json`. Apply each patch to its exact pinned revision to reproduce the
measured source; manifests hash every tracked source file, including the lockfile.
The same existing dependency tree is shared by the disposable source snapshots.
Do not upload raw logs/profiles without review. Old evidence directories remain
unchanged. No `.env`, private/attachment/personal databases, `.run`, real app,
Keycloak, Docker/volumes or ports 3000/8080 were accessed. No installation or
security gate change was made. No unrelated branch or worktree was edited.

Limits: only three fresh-fixture runs per profile/revision, repeated empty-answer
histories, short synthetic text, few identities, no production authentication,
network, cold disks, diverse long-lived histories, large reviewed-concept pool,
open-loop traffic, concurrent scheduled upkeep or many live writers. These runs
do not provide per-account latency or memory guarantees. Implementation correction:
one GPT-6.1 Sol agent, medium reasoning; parent arranges fresh review/readiness.
