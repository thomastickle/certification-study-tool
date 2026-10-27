# Persisted study evidence (#81)

The target is **under 300 ms, preferably under 200 ms**, for normal large-history
quiz-start and due HTTP reads. First-use, rebuilds and contention are reported
separately. These are synthetic engineering targets on recorded hardware, not
production guarantees. Refs #81; parent independent review remains required.

The original pre-review three-run series kept all **12 normal large-history
quiz-start/due HTTP observations below 300 ms; 11 were below 200 ms**. The largest was 218.1 ms.
This meets the normal-request target in this bounded series, not a general latency
SLO. Other-account contention still reached 358.3 ms; full rebuilds reached
2301.3 ms, and large provenance annotation became slower. These are historical observations
for the pre-correction head; see the correction below. The issue stays open.

## Design and tradeoffs

The pre-edit design is retained in private evidence. Choose compact validated
per-attempt events before aggregate mastery. They remove repeated full-snapshot
JSON decoding, content normalization and identity hashing while preserving ordered
replay after earlier-attempt deletion/restore. An aggregate-only cache needs
additional invalidation/replay logic for those noncommutative transitions.
A focused aggregate JSON decode lower bound is measured for comparison; it is not
an implemented aggregate cache with equivalent recovery/mutation costs.

`quiz_sessions` remains authoritative and unchanged. The additive `quiz_evidence`
table stores a version, exact certification pair, attempt/time and ordered tuples
of validated identity, answered/correct/confidence/unknown evidence. It contains
no original question text, answers or untrusted fingerprint cache keys. Unknown
encounters and duplicate ordering retain full replay semantics. Namespaced source
provenance stays in the snapshot; content identities retain existing certification
scope and normalization. Source removal never deletes events or due obligations.

Every snapshot INSERT/UPDATE/DELETE has an SQLite invalidation trigger. This also
covers direct provenance annotation, existing legacy transfers and standalone SQL
writers. `QuizRepository.save` uses a savepoint around snapshot plus projection
replacement, even outside a caller-owned transaction. It derives from the exact
serialized snapshot, preserving JSON normalization. Enclosing completion, expiry,
delete/restore and library transactions keep ownership and roll back both rows.
Annotation writes proactively replace projections; the owned provenance-only path
retains validated identical rows as detailed in the correction below. Private
transfer copies only authoritative snapshots; destination invalidation and lazy reconstruction avoid
trusting the source's derived data. Shared physical cleanup also discards orphaned
projections after a legacy table replacement before the existing VACUUM gate.

Connection initialization installs the additive table/triggers without a history
scan. The authoritative schema/transfer version remains 4; derived extraction and
wire format have their own `evidenceVersion = 1`. Bump it when identity/scoring
validation or serialization rules change. Mastery rules have no persisted aggregate:
reads always run current replay, so rule changes cannot trust stale mastery state.
One immutable fixed-timezone formatter and a request-local timestamp/day map avoid
rebuilding ICU formatters for every answered encounter. Calendar/DST rules are
unchanged.

Missing/version-mismatched rows rebuild under a savepoint on first use. Each small
payload has a SHA-256 checksum binding account, row ID, extraction version, exact
scope and data. Corrupt rows rebuild from their exact authoritative row. Integrity
is checked before certification filtering, so corrupt scope cannot hide obligations.
SQL narrows by authenticated account and completed status; all of that account's
compact rows are integrity-checked before exact certification filtering. This
conservative choice preserves invalid legacy-scope errors, rather than relying on
SQLite JSON coercions or silently hiding malformed records. It leaves work linear
in account event count. No full snapshot scan/hashing occurs on normal reads.
Malformed legacy projections have explicit fallback sentinels; reads retain the
original authoritative replay/error boundary. Failed reconstruction propagates and
rolls back; it never produces an empty authoritative-looking summary.

The checksum detects accidental corruption, not a malicious database administrator
who can replace both snapshot and checksum. Database files remain trusted private
application storage. Missing schema is recreated on connection initialization;
live schema tampering is not an availability guarantee. No worker, framework,
provider, connection-ownership or engine change is included.

## Reproduction and ongoing tracking

Use [the performance ledger](performance-ledger.md). Keep exact source revisions,
common harness patches/manifests and raw logs private; publish sanitized aggregates.
All benchmark files/databases are synthetic and ephemeral, with OS-selected
loopback ports. No authentication provider or running user application is needed.

## Comparable series — 2026-10-27

Pinned approved baseline: `47a54e647c93ec0e0669d073ef3cb256baf07cbf`.
Pinned measured implementation: `0c10eb1e4e48903d4b152b0f356e7eb1e0b73ecf`.
Later report-only commits do not change measured production, tests or harness.
Workload/instrumentation version: `study-history-v2-answered`. The same six harness
files are byte-identical across sources. Exact source snapshots, SHA-256 manifests
and applicable patches from both pinned commits were reconstructed
by the implementer's audit script. This is source/results auditing, not the
separate independent-agent review still owned by the parent.

Node 24.22.1; Linux 7.0.0-38-generic; Intel i5-8265U (advertised 1.60 GHz), eight
logical CPUs, 31.1 GiB RAM. Local temporary SQLite files, shared host, warm OS cache
from setup, no CPU pinning/cache flush or production OIDC/network. Existing compatible
dependencies were copied without installation. Source/assertion work warms code;
there is no independent JIT warm-up or cold-process/disk experiment. Every HTTP
request opens/closes its owned private-library connection. Persisted state survives
those reopens; abrupt-process-exit/reopen correctness is covered separately by tests.
Initial schema creation and first-use backfill are measured outside normal HTTP.

Three fresh-fixture repetitions per profile/revision, sequential order: base
small/history/diverse, then head small/history/diverse (18 repetitions). No tests
or other benchmarks launched by this implementer ran concurrently. This is not an
exclusive host or randomized crossover. Initial one-minute load / free GiB at each
series start:

| Profile | Base load / free GiB | Head load / free GiB |
| ------- | -------------------: | -------------------: |
| small   |          4.78 / 13.4 |          2.05 / 13.4 |
| history |          4.48 / 13.4 |          2.18 / 13.4 |
| diverse |          2.05 / 13.5 |          2.58 / 13.6 |

History/diverse: 100 owners; 2,000 busy-owner completed attempts × 20 snapshots,
ten histories per other owner; 1,000-question shared and imported banks plus
48-question private originals, 100 deletion events. Recovery adds one accepted
empty-answer completed history per owner; foreground completion adds another for
the busy owner. Small: ten owners, ten histories, 48-question banks, one event.
History keeps the corrected empty-answer/null-confidence fixture. Diverse changes
saved content across a 1,000-position question pool, with confident hits, low
confidence hits, misses, correct null-confidence answers and skips. Repeated
same-day encounters deliberately retain at least 100 due identities plus miss and
uncertainty states. It is not 40,000 unique questions or years of varied chronology.
All completed questions pass `completedEvidence` and coherent timer/pause guards
before sampling, after recovery and at final verification. Diverse foreground
submission answers 15 of 20 correctly with mixed confidence; empty profiles score
zero. Snapshot/key/provenance/account guards remain intact.

This series reruns the common approved baseline after the v2 fixture/instrumentation
change. The old malformed-chronology reports remain qualified historical evidence.
Exploratory diagnostics are retained separately and excluded from these tables,
including a run that overlapped focused tests. No CPU percentages or isolated
causal contribution are inferred from wall-clock time.

### Normal HTTP requests

Milliseconds: nearest-rank median (range) of three single requests per cell.
All single observations appear below; three values do not estimate production p95.

| Profile / operation   |              Base HTTP |           Head HTTP |
| --------------------- | ---------------------: | ------------------: |
| small quiz-start      |       18.3 (16.9–18.7) |    12.7 (11.7–29.4) |
| small due-read        |       20.9 (19.2–23.6) |       7.1 (6.3–8.4) |
| small quiz-complete   |          6.7 (6.7–7.1) |       7.9 (7.5–9.7) |
| history quiz-start    |    958.5 (945.2–982.0) | 198.4 (168.9–218.1) |
| history due-read      |    926.9 (913.9–982.7) | 171.4 (164.3–180.3) |
| history quiz-complete |          7.2 (7.1–8.6) |      9.9 (8.3–11.2) |
| diverse quiz-start    | 3232.8 (3175.9–3349.4) | 182.2 (179.3–186.3) |
| diverse due-read      | 3250.7 (2859.2–3443.5) | 161.5 (155.8–177.6) |
| diverse quiz-complete |         9.1 (7.5–14.2) |     10.0 (9.1–10.0) |

Completion is the observed write cost, including HTTP/service/commit overhead,
not isolated SQL/CPU attribution. Projection validation adds work to each normal
completion; in this series completion medians rose. Large-history ranges overlap; the small profile also regressed.

Individual HTTP observations, in repetition order:

| Profile / operation   |           Base 1 / 2 / 3 |        Head 1 / 2 / 3 |
| --------------------- | -----------------------: | --------------------: |
| small quiz-start      |       18.7 / 18.3 / 16.9 |    29.4 / 12.7 / 11.7 |
| small due-read        |       20.9 / 19.2 / 23.6 |       8.4 / 6.3 / 7.1 |
| small quiz-complete   |          7.1 / 6.7 / 6.7 |       9.7 / 7.5 / 7.9 |
| history quiz-start    |    982.0 / 945.2 / 958.5 | 198.4 / 168.9 / 218.1 |
| history due-read      |    913.9 / 982.7 / 926.9 | 164.3 / 171.4 / 180.3 |
| history quiz-complete |          8.6 / 7.1 / 7.2 |      11.2 / 9.9 / 8.3 |
| diverse quiz-start    | 3349.4 / 3232.8 / 3175.9 | 186.3 / 179.3 / 182.2 |
| diverse due-read      | 3250.7 / 2859.2 / 3443.5 | 161.5 / 155.8 / 177.6 |
| diverse quiz-complete |         9.1 / 14.2 / 7.5 |     10.0 / 10.0 / 9.1 |

### Service, event loop and sampled memory

Service is handler entry through awaited controller/cleanup; HTTP additionally
includes client transfer/queueing. Timer cells are the three phase maxima, including
the final drain, summarized as median (range), not response-time guarantees. RSS
is whole-process MiB sampled at start/one-millisecond callbacks; it can miss peaks
within synchronous work, includes prior phases/GC, and is not per-operation allocation.
Full start/end heap/external/ArrayBuffer values remain in private logs.

| Profile / operation        |        Base service ms |     Head service ms |        Base max-gap ms |     Head max-gap ms |   Base sampled RSS MiB | Head sampled RSS MiB |
| -------------------------- | ---------------------: | ------------------: | ---------------------: | ------------------: | ---------------------: | -------------------: |
| small quiz-start           |       16.8 (16.1–17.4) |    11.6 (10.9–24.7) |       17.2 (16.9–18.3) |    12.9 (11.7–26.3) |    123.3 (122.9–123.7) |  128.8 (127.3–129.3) |
| small due-read             |       18.9 (18.5–22.8) |       6.3 (5.6–6.7) |       20.4 (19.3–23.7) |       7.2 (6.3–8.1) |    128.4 (128.2–128.8) |  128.9 (127.3–129.4) |
| small quiz-complete        |          5.7 (5.4–5.7) |       7.0 (6.5–7.3) |          6.6 (5.7–6.7) |       7.9 (7.4–8.1) |    123.3 (122.9–123.7) |  128.8 (127.3–129.3) |
| small busy-account-reads   |         8.2 (6.6–27.4) |      3.2 (2.8–11.5) |       29.0 (27.6–35.2) |    14.2 (12.7–16.8) |    129.1 (128.4–129.3) |  129.1 (127.8–129.5) |
| history quiz-start         |    957.8 (944.2–979.9) | 195.4 (168.1–217.2) |    958.7 (945.3–980.5) | 196.8 (169.0–218.2) |    405.9 (372.1–427.5) |  369.6 (369.4–392.3) |
| history due-read           |    926.1 (912.1–982.0) | 170.7 (162.7–179.6) |    927.0 (913.6–982.8) | 171.7 (164.3–180.5) |    452.2 (418.3–473.9) |  380.4 (380.2–410.6) |
| history quiz-complete      |          6.3 (6.2–6.8) |       8.4 (7.0–9.2) |          7.1 (6.9–8.3) |       9.8 (8.2–9.8) |    404.1 (370.2–425.6) |  369.6 (369.4–392.3) |
| history busy-account-reads |      21.4 (6.6–1325.8) |    14.1 (2.8–171.7) | 1897.2 (1846.5–2392.2) | 284.3 (255.1–298.8) |    463.2 (449.4–476.2) |  443.9 (441.9–504.4) |
| diverse quiz-start         | 3231.7 (3175.1–3347.5) | 181.3 (178.5–184.5) | 3232.9 (3175.9–3348.0) | 182.3 (179.4–184.9) | 1675.1 (1675.1–1702.8) |  436.4 (410.8–472.0) |
| diverse due-read           | 3247.8 (2858.1–3442.8) | 159.8 (155.0–176.8) | 3249.4 (2859.3–3443.7) | 161.2 (156.0–177.8) | 2351.3 (1704.6–2361.3) |  438.2 (412.6–472.0) |
| diverse quiz-complete      |         7.4 (6.5–12.5) |       8.3 (8.2–8.7) |         8.7 (7.0–14.2) |       9.0 (8.7–9.9) | 1675.2 (1675.1–1702.8) |  436.4 (410.8–472.0) |
| diverse busy-account-reads |     45.7 (16.7–3588.4) |    24.6 (3.0–175.5) | 6230.5 (4121.0–6556.4) | 317.1 (286.5–340.4) | 3630.9 (3629.7–3634.1) |  501.2 (474.8–517.1) |

Answered baseline RSS is much larger in these samples; formatter reuse removes
per-encounter formatter construction by a deterministic work invariant. This does
not establish guaranteed memory peaks or fresh CPU attribution. Compact replay,
checksums, event sorting/deduplication and current-library identity reconstruction
remain synchronous and scale with history/library size.

### Other-account contention

Five closed-loop batches of four alternating busy/other due requests per repetition:
30 samples per actor/revision/profile, pooled across all three repetitions. All
numeric samples are retained privately. Nearest-rank median/p95/max below are
empirical sampled distributions, not open-loop production tails. This pooling is
explicitly different from PR82's median-of-per-repetition-medians; compare only
the new baseline/head columns using the same estimator.

| Profile / actor | Base HTTP median / p95 / max | Head HTTP median / p95 / max | Base service median / p95 / max | Head service median / p95 / max |
| --------------- | ---------------------------: | ---------------------------: | ------------------------------: | ------------------------------: |
| small busy      |           23.0 / 37.5 / 59.9 |           10.0 / 20.6 / 33.0 |               8.2 / 10.4 / 27.4 |                3.3 / 4.3 / 11.5 |
| small other     |           30.2 / 51.5 / 67.8 |           13.6 / 29.5 / 36.3 |               7.8 / 16.5 / 17.4 |                3.2 / 9.4 / 11.5 |
| history busy    |     1260.4 / 2220.0 / 2382.7 |        158.0 / 306.5 / 328.7 |         921.4 / 1258.6 / 1325.8 |           137.4 / 156.4 / 171.7 |
| history other   |     1267.3 / 2226.6 / 2398.6 |        164.1 / 310.9 / 332.8 |               7.5 / 21.3 / 21.4 |               3.2 / 11.4 / 14.1 |
| diverse busy    |     3406.3 / 6800.2 / 6808.4 |        178.4 / 337.5 / 352.2 |        3085.1 / 3533.7 / 3588.4 |           143.8 / 169.1 / 175.5 |
| diverse other   |     6119.2 / 7635.6 / 7779.3 |        203.1 / 341.4 / 358.3 |              20.1 / 42.5 / 45.7 |               3.5 / 18.6 / 24.6 |

Other-account history: 5/30 samples were at least 300 ms; observed range 128.7–332.8 ms. Other-account diverse: 8/30 samples were at least 300 ms; observed range 135.9–358.3 ms.
Other-account queueing and synchronous shared-loop stalls remain material despite
much smaller service times. The normal-request target is not a concurrency SLO.

### First use, restart, invalidation and rebuild

These are separate synchronous service-side experiments after normal sampling,
not HTTP timings and not startup work hidden from the request. Milliseconds,
median (range), three observations per cell. Reopen includes owner verification,
connection/schema setup and the due read. First-use deletes derived rows while
retaining authoritative snapshots; version rebuild marks every projection stale;
corruption recovery changes one payload; schema reopen drops only the synthetic
derived table, reopens to recreate it, then backfills on due read. Each experiment
has its own drained timer probe.

| Head experiment       |            Small |                History |                Diverse |
| --------------------- | ---------------: | ---------------------: | ---------------------: |
| restartOpenDueMs      |    3.2 (3.0–4.1) |    135.9 (128.3–144.8) |    147.4 (145.6–162.7) |
| persistedDueMs        |    2.7 (2.4–3.3) |    126.4 (123.9–127.8) |    126.4 (124.0–141.5) |
| invalidateAllMs       |    3.5 (3.1–3.6) |        11.4 (6.7–11.6) |       12.2 (12.1–38.8) |
| firstUseBackfillDueMs | 13.0 (12.5–13.7) | 1104.1 (1076.7–1158.3) | 1105.6 (1071.7–1665.8) |
| markVersionMs         |    4.2 (3.6–4.8) |       50.4 (49.0–51.5) |     81.1 (46.6–1280.0) |
| versionRebuildDueMs   | 13.9 (13.5–22.2) | 1214.6 (1111.7–1279.5) | 1225.2 (1196.3–2301.3) |
| corruptRowMs          |    3.4 (3.3–4.2) |          6.2 (6.2–6.7) |         6.5 (5.7–40.0) |
| corruptRecoveryDueMs  |    7.6 (6.7–8.6) |    159.0 (143.9–166.7) |    171.4 (143.9–180.9) |
| derivedSchemaReopenMs |    4.6 (4.2–5.5) |          4.8 (4.3–4.9) |         4.9 (4.6–35.1) |
| schemaBackfillDueMs   | 17.5 (12.1–31.6) | 1105.3 (1083.3–1125.7) | 1166.5 (1092.5–1660.4) |

Largest observed timer gap per experiment (ms), including slow I/O/host scheduling:

| Head experiment       | Small | History | Diverse |
| --------------------- | ----: | ------: | ------: |
| restartOpenDueMs      |   5.0 |   147.3 |   165.1 |
| persistedDueMs        |   3.6 |   129.1 |   143.7 |
| invalidateAllMs       |   4.8 |    12.8 |    38.9 |
| firstUseBackfillDueMs |  14.8 |  1163.3 |  1667.2 |
| markVersionMs         |   5.6 |    53.2 |  1281.2 |
| versionRebuildDueMs   |  23.4 |  1280.8 |  2302.1 |
| corruptRowMs          |   5.6 |     9.3 |    46.5 |
| corruptRecoveryDueMs  |   9.8 |   169.4 |   183.3 |
| derivedSchemaReopenMs |   6.7 |     6.1 |    36.4 |
| schemaBackfillDueMs   |  32.8 |  1126.8 |  1663.5 |

Full backfills/version rebuilds exceed 300 ms substantially. Marking versions
itself also had a large synchronous write outlier; no CPU/disk causal attribution
is claimed. A schema mismatch costs table recreation plus backfill, not just the
cheap DDL column. Normal reconnects do not rescan snapshots. Legacy rows with
invalid scope/layout retain the original replay/error path and its potentially
large cost; incomplete but interpretable scoring remains compact unknown evidence.

Initial whole-library schema creation/open (new synthetic shared file), ms:

| Profile |             Base |              Head |
| ------- | ---------------: | ----------------: |
| small   | 34.3 (33.8–36.6) |  51.0 (47.4–52.3) |
| history | 32.8 (30.9–33.3) |  55.3 (55.1–58.3) |
| diverse | 35.5 (32.9–43.3) | 66.2 (52.3–382.3) |

These include all initial schema setup, not just derived DDL. They include an
observed slow initial open and are not a cold deployment-readiness guarantee.

### Aggregate comparison and mutation tradeoff

Focused full replay includes authoritative loading/normalization; aggregate decode
is only JSON parsing a serialized replay result (maps encoded as arrays), excluding
map reconstruction, integrity, SQL, invalidation and ordered replay after mutations.
It is an intentionally favorable lower bound, not an equivalent implemented cache.

| Experiment / profile                |                Base ms |              Head ms |
| ----------------------------------- | ---------------------: | -------------------: |
| fullReplayMs small                  |          5.1 (4.8–5.8) |        5.3 (5.3–5.8) |
| aggregateDecodeLowerBoundMs small   |          0.1 (0.1–0.5) |        0.1 (0.1–0.1) |
| fullReplayMs history                |    889.0 (884.4–980.9) |  881.0 (845.5–966.7) |
| aggregateDecodeLowerBoundMs history |          0.1 (0.1–0.1) |        0.1 (0.1–0.2) |
| fullReplayMs diverse                | 2941.9 (2859.9–2976.1) | 906.6 (875.5–1070.5) |
| aggregateDecodeLowerBoundMs diverse |          1.3 (1.0–1.6) |        1.5 (1.5–1.8) |

An aggregate could reduce replay further, but compact events already meet the
normal-request target here with simpler authoritative deletion/restore recovery.
Do not infer that an aggregate with equivalent lifecycle guarantees costs only
its JSON parse. Keep ordered events and defer aggregate persistence unless the
remaining normal/concurrency budgets justify that extra design.

Head payload sizes after rebuild (bytes; SQLite pages/indexes/checksums excluded):

| Profile | Compact payload range | Aggregate JSON range |
| ------- | --------------------: | -------------------: |
| small   |         25,752–25,752 |        10,397–11,825 |
| history |   4,296,292–4,296,292 |        20,493–21,564 |
| diverse |   4,437,803–4,437,803 |      267,848–269,277 |

At the original pre-correction head, provenance annotation conservatively replaced
affected projections rather than assuming a generic callback cannot change scoring. This added substantial
work to large bulk annotations. It was a measured regression and the blocking P2 finding. The correction below
removes redundant extraction; the historical table is retained. Relevant non-target
HTTP operations, ms:

| Profile / operation                    |           Base HTTP |            Head HTTP | Head largest timer gap |
| -------------------------------------- | ------------------: | -------------------: | ---------------------: |
| history foreground-reconcile-backlog   | 285.3 (284.9–308.0) | 898.6 (879.4–1028.9) |                 1029.2 |
| history private-delete-with-annotation | 282.9 (280.7–289.4) |  882.9 (842.3–940.3) |                  941.0 |
| history foreground-reconcile-new-event | 139.1 (133.4–147.9) |  142.6 (122.3–151.0) |                  151.1 |
| diverse foreground-reconcile-backlog   | 301.1 (273.0–348.3) |  919.7 (805.9–941.4) |                  941.4 |
| diverse private-delete-with-annotation | 276.6 (262.3–310.1) |  878.7 (820.2–924.7) |                  925.1 |
| diverse foreground-reconcile-new-event | 137.5 (133.0–147.6) |  137.8 (134.6–164.3) |                  164.5 |

Maintenance remains separate from HTTP; elapsed ms median (range):

| Profile / maintenance            |           Base elapsed |           Head elapsed | Head largest gap |
| -------------------------------- | ---------------------: | ---------------------: | ---------------: |
| small startup-recovery           |    191.6 (177.1–242.9) |    212.0 (185.9–215.8) |             31.8 |
| small recurring-reconciliation   |       50.7 (50.7–52.4) |       48.5 (47.8–52.3) |             11.4 |
| history startup-recovery         | 1994.7 (1874.4–2059.5) | 3034.7 (2992.2–5475.7) |           1597.6 |
| history recurring-reconciliation |    614.6 (570.4–642.4) |    573.3 (562.0–607.4) |             23.4 |
| diverse startup-recovery         | 1982.3 (1928.1–2130.2) | 2917.8 (2897.7–3033.3) |            934.1 |
| diverse recurring-reconciliation |    622.5 (565.3–702.4) |   697.0 (623.5–3125.2) |             72.5 |

The correction below implements safe retention for proven provenance-only
mutations. Remaining compact replay/current-library costs still need investigation.
Do not weaken invalidation or move work into an unreported startup phase. Larger
histories, many distinct completion times, much larger due sets/banks, long text,
slow disks, lock contention, concurrent writers/upkeep, cold process/disk,
production authentication/network and deployment hardware remain unbounded or
unmeasured. There is no production latency guarantee or universal account limit.

## Verification and handoff

`npm run check` passed formatting, ESLint, **349 tests**, native TypeScript and
Vite build for the measured implementation. Focused red/green logs preserve the
missing persistence boundary, per-event formatter-construction regression, and
transactional initialization rollback failure before their corrections. Coverage
includes restart, corruption/missing/version rows, failed writes/rebuilds, outer
rollback, abrupt process exit before commit, standalone callers, raw SQL mutations,
embedded-ID/status mismatch, account/scope/legacy/unknown evidence, shuffled keys,
duplicate ordering, large due sets, source disappearance, deletion/restore/purge
and existing migration/physical-removal gates. The old history-read work assertion
was strengthened from one full snapshot load to zero; source/library counts remain.

An implementer-run probe imported the untouched approved original modules and
matched 60 varied histories plus 25 original/optimized due, deterministic full
question/key selection and earlier-delete/restore comparisons. This supplements,
and does not replace, independent review. The final comparison audited all 18
complete repetitions, all retained samples/counts, request-owned connections,
scoring/snapshot/provenance/account outcomes and exact measured-source manifests.
No flaky machine timings enter CI. Diff and redacted Gitleaks publication checks
are recorded in the draft PR. Parent owns independent review, CI and readiness.

Private evidence: `/tmp/study-evidence81-R0NYza` (design, red/green, checks, original
reference probe, audit/report scripts and publication records) and
`/tmp/study-performance-nt8k0nj8` (exact base/head sources/manifests/patches,
run order, all raw numeric observations and audited `metrics.json`), directories
0700/files0600. Retain for review; do not upload raw logs/profiles without review.
No real app, personal DBs, root `.env`/private/attachments/`.run`, Keycloak,
Docker/volumes or fixed ports 3000/8080 were accessed. No installation, system/gate
change, signing-key use, shared push, merge or deployment. One GPT-6.1 Sol medium
implementer; no child agents or watchers. This is a draft scoped follow-up, Refs #81.

## 2026-10-27 — provenance retention correction (P2)

Historical round1 correction at measured `9370c33` / documentation head `ce8b092`.
Round2 subsequently found a standalone concurrent-writer integrity defect; the
transaction correction below supersedes its standalone safety claim. All numbers
in this section remain pinned historical results, not current-head measurements.

The first independent review requested changes for unconditional evidence extraction
in production bank-deletion annotation. Its measurements and the preceding tables
remain historical evidence for `13b83fd`, not results for the correction. The
reviewer's approved-PR82 → original-PR83 deletion service median was
415.7 → 1487.5 ms, and other-account HTTP 425.8 → 1488.9 ms. It found no additional
substantiated correctness/isolation/migration/calendar defect. This correction is
implemented and locally verified; fresh independent review and CI belong to the
parent, and PR83 remains draft. Refs #81.

### Retention invariant

Both production callers now use repository-owned `annotateDeletedBanks`, which
accepts deletion data, never a caller-supplied mutation callback. Its only writes
are `deletedBankNames` and legacy question `sourceId` (via existing
`pinLegacySources`). Neither is read by `completedQuestionIdentity`,
`evidenceWithIdentity`, scope extraction or attempt/time serialization. All
content, keys, scoring/confidence, order, embedded ID/status, timestamps and scope
remain unchanged. If extraction ever starts using these provenance fields, this
retention proof must change along with the extraction-version policy.

Inside the same savepoint, capture the exact account/SQL-row-bound projection,
validate current version/checksum/JSON using the normal decoder, perform the
snapshot UPDATE (whose trigger still invalidates evidence), and reinsert the
validated row. Missing, stale or corrupt rows eagerly rebuild from the serialized
snapshot before annotation returns. Generic `annotateSnapshots` callbacks always
extract again. Sentinels and unknown/mismatched legacy evidence retain existing
fallback/replay/error behavior; a provenance label never upgrades scoring.
Standalone failures and enclosing rollback restore snapshots and projections
together. Raw-writer invalidation and schema versions are unchanged.

### Paired correction measurements

Pinned before: `13b83fda1f3dbc2cdc62662f553c40c55a0a412e`;
pinned measured correction: `9370c33a4e920cf9ee867580fe707d280cca329f`.
Later documentation-only changes do not change measured runtime/tests/harness.
Node 24.22.1, Linux 7.0.0-38-generic, i5-8265U/eight logical CPUs, 31.1 GiB RAM;
shared host, fresh synthetic files, warm setup/OS cache, no CPU pinning or cache
flush, no production authentication/network. No competing checks/benchmarks were
launched by this implementer. This is sequential sampling, not randomized crossover
or a production guarantee. Targets remain under 300/preferred under 200 ms.

The reviewer's original single-bank probe shape was also rerun separately with
three paired exact-before/correction repetitions: 2,000 valid confident answered
attempts/40,000 snapshots, all referencing the deleted source, no surviving bank.
It used the same retained common external driver/worker for each revision.
Initial load/free GiB: 1.09/13.5. Deletion service and
other-account HTTP milliseconds, median (range):

| Original single-bank shape |                 Before |          Correction |
| -------------------------- | ---------------------: | ------------------: |
| Deletion service           | 1460.9 (1443.7–1562.3) | 678.0 (671.6–687.6) |
| Other-account HTTP         | 1460.4 (1447.8–1571.7) | 679.9 (674.7–690.1) |
| Other-account service      |          3.8 (2.8–4.3) |       3.4 (3.2–4.6) |

All 6,000 projection comparisons were byte-identical. This directly reproduces
and corrects the original shape; next quiz/due is tested by the surviving-bank
variant below. The older approved-PR82 timings remain historical, not a new
approved-base comparison.

The dedicated `annotation-v2-retained-bank-eager-repair` probe runs three paired
before/after repetitions. Each has 2,000 accepted, correctly timed, confident
answered attempts × 20 snapshots, all referencing deleted source 1; a second
identical-content 1,000-question bank survives so the next quiz can be measured.
A separate small account/library requests due while real `LibraryService.deleteSource`
blocks the same server. The extra surviving bank, fixed post-history clock and
subsequent requests are a declared methodology boundary from the reviewer's
single-bank probe: compare only this probe's paired before/after, not its numbers
directly with the reviewer's old timings. Initial load/free GiB: 3.23/13.5.

Milliseconds, median (range), three samples each:

| Dedicated annotation probe         |                 Before |          Correction |
| ---------------------------------- | ---------------------: | ------------------: |
| Deletion service                   | 1573.0 (1566.4–1599.8) | 682.7 (680.1–761.2) |
| Other-account HTTP during deletion | 1587.6 (1570.2–1608.4) | 683.1 (681.0–763.6) |
| Other-account service              |          4.2 (3.7–6.7) |       3.2 (3.0–4.2) |
| Next due HTTP                      |    154.8 (149.8–175.8) | 161.5 (160.7–169.9) |
| Next quiz HTTP                     |    168.8 (156.6–180.0) | 170.8 (168.1–225.2) |
| Next due service                   |    153.7 (148.0–174.5) | 160.6 (159.6–168.1) |
| Next quiz service                  |    166.5 (151.2–178.9) | 169.0 (166.9–223.1) |

All 6,000 corrected projection rows were byte-identical before/after deletion.
Before the next due/quiz calls, a BEFORE INSERT trigger rejects any evidence
rebuild: every call still succeeds with 20 due/eligible questions and 20 selected
questions. No full rebuild was deferred. These are service-boundary synthetic HTTP
handlers; the common benchmark below exercises actual API routing/reconciliation.
Bulk annotation still costs hundreds of milliseconds and delays the other account;
this removes repeated extraction, not synchronous snapshot rewriting or all stalls.

The unchanged common `study-history-v2-answered` harness ran three repetitions per
revision/profile in order: before history/diverse, then correction history/diverse
(12 complete runs). It retains the corrected chronology/scoring/timer guards,
empty-answer history and answered/diverse due obligations, connection/worker cleanup,
snapshot/key/provenance/account assertions, timer-drain and sampled-memory metrics.
The small profile and the old approved-PR82 comparison were not repeated; their
preceding results remain explicitly historical. No flaky timing CI gate was added.

| Common workload / operation            |          Before HTTP |     Correction HTTP |  Correction service | Largest corrected timer gap |
| -------------------------------------- | -------------------: | ------------------: | ------------------: | --------------------------: |
| history quiz-start                     |  166.9 (157.2–170.5) | 177.1 (172.1–182.7) | 176.3 (170.1–180.6) |                       181.9 |
| history due-read                       |  160.0 (158.8–160.0) | 175.8 (159.6–179.0) | 174.3 (159.0–177.4) |                       178.8 |
| history foreground-reconcile-backlog   |  786.9 (784.1–856.4) | 444.5 (418.7–457.9) | 447.7 (418.7–461.3) |                       462.3 |
| history private-delete-with-annotation |  809.2 (729.4–842.7) | 402.1 (377.6–454.7) | 402.3 (378.1–455.2) |                       456.1 |
| history foreground-reconcile-new-event |  130.2 (127.6–139.2) | 131.4 (129.5–154.1) | 130.7 (128.0–153.2) |                       154.2 |
| history quiz-complete                  |        9.5 (8.6–9.6) |     10.4 (8.5–14.7) |      9.3 (7.0–12.3) |                        13.2 |
| diverse quiz-start                     |  187.1 (179.3–231.5) | 182.3 (171.0–187.4) | 181.4 (170.4–185.2) |                       185.9 |
| diverse due-read                       |  169.8 (158.7–246.0) | 178.3 (168.2–195.5) | 177.6 (167.5–193.8) |                       195.1 |
| diverse foreground-reconcile-backlog   | 881.7 (874.4–1089.3) | 469.4 (432.1–484.9) | 470.6 (436.4–489.9) |                       490.7 |
| diverse private-delete-with-annotation | 855.8 (820.4–1039.1) | 427.1 (411.0–442.5) | 427.6 (411.4–443.2) |                       444.0 |
| diverse foreground-reconcile-new-event |  134.3 (134.3–199.5) | 140.7 (139.3–147.7) | 140.0 (138.8–146.4) |                       147.7 |
| diverse quiz-complete                  |       8.4 (8.2–12.0) |       8.4 (8.2–9.7) |       7.5 (7.3–8.1) |                         9.4 |

Corrected normal quiz/due samples: **12/12 under 300 ms; 12/12 under 200 ms**, max 195.5 ms. All observations (sorted; raw run order retained privately):

- history quiz-start: 172.1, 177.1, 182.7 ms.
- history due-read: 159.6, 175.8, 179.0 ms.
- diverse quiz-start: 171.0, 182.3, 187.4 ms.
- diverse due-read: 168.2, 178.3, 195.5 ms.

Common series initial one-minute load / free GiB / UTC timestamp:

- base history: 2.81 / 13.4 / 2026-10-27T16:46:14.571Z.
- head history: 3.83 / 13.3 / 2026-10-27T16:50:07.007Z.
- base diverse: 2.29 / 13.5 / 2026-10-27T16:48:01.621Z.
- head diverse: 3.13 / 13.4 / 2026-10-27T16:51:49.787Z.

Other-account due contention (30 samples per profile/revision), HTTP median (range),
then corrected p95/max and corrected service median (range):

| Profile |         Before HTTP |     Correction HTTP | Correction p95/max | Correction service |
| ------- | ------------------: | ------------------: | -----------------: | -----------------: |
| history | 159.3 (125.6–310.0) | 156.6 (127.7–286.5) |        286.3/286.5 |     3.1 (2.9–15.9) |
| diverse | 214.7 (127.4–426.2) | 169.7 (128.3–314.9) |        310.7/314.9 |     3.3 (3.0–22.6) |

Sampled peak RSS during normal quiz/due phases, MiB (min–max across both phases
and all three repetitions); this samples phase boundaries/requests/timers rather
than an OS high-water mark:

- history: base 401.5–413.9; head 379.6–413.5.
- diverse: base 419.4–439.2; head 419.7–424.7.

Separated slow paths, elapsed milliseconds median (range), plus largest corrected timer gap:

| Profile / operation              |                 Before |             Correction | Correction largest gap |
| -------------------------------- | ---------------------: | ---------------------: | ---------------------: |
| history firstUseBackfillDueMs    |   973.1 (968.6–1040.9) |   986.5 (957.2–1088.4) |                 1091.7 |
| history versionRebuildDueMs      | 1075.4 (1068.3–1079.0) | 1110.2 (1070.5–1147.4) |                 1147.8 |
| history restartOpenDueMs         |    125.0 (123.5–131.6) |    128.5 (125.5–150.9) |                  153.5 |
| history corruptRecoveryDueMs     |    141.9 (134.3–158.9) |    137.7 (135.9–153.7) |                  157.1 |
| history schemaBackfillDueMs      |   985.5 (972.8–1001.4) |   993.5 (981.6–1008.9) |                 1009.5 |
| history startup-recovery         | 2946.6 (2927.5–2950.0) | 2356.9 (2133.5–2411.4) |                  544.7 |
| history recurring-reconciliation |    675.9 (649.9–677.5) |    655.4 (576.6–676.5) |                   20.5 |
| diverse firstUseBackfillDueMs    | 1067.1 (1009.2–1383.2) |  1016.0 (999.0–1030.6) |                 1031.8 |
| diverse versionRebuildDueMs      | 1355.9 (1075.9–1432.5) | 1111.9 (1073.7–1143.9) |                 1144.8 |
| diverse restartOpenDueMs         |    131.9 (130.7–180.7) |    139.7 (129.9–151.7) |                  154.0 |
| diverse corruptRecoveryDueMs     |    180.1 (157.8–182.4) |    157.4 (140.9–163.1) |                  165.7 |
| diverse schemaBackfillDueMs      | 1239.9 (1006.2–1298.0) |  1010.6 (995.4–1048.9) |                 1049.6 |
| diverse startup-recovery         | 3132.2 (3031.0–3164.3) | 2479.9 (2422.0–4101.1) |                  550.0 |
| diverse recurring-reconciliation |    684.7 (603.0–805.6) |    679.5 (642.5–680.8) |                   22.2 |

The target applies to bounded normal reads; contention, eager rebuild/first-use,
startup and bulk annotation remain separate gaps. Earlier outliers (contention
358.3 ms, rebuild 2301.3 ms, startup 5475.7 ms) remain historical limits, not
remeasured claims for this commit. Larger histories, distinct timestamps, slower
disks, production auth/network, concurrent writers/upkeep and deployment hardware
remain unbounded/unmeasured. Issue #81 remains open.

### Executed verification and retained evidence

`npm run check` passed formatting, ESLint, **354/354 tests**, native TypeScript and
Vite build. The new work regression was red on the old implementation (20 saved
question content hashes, expected zero), then green. The focused 22-test suite
passed production deletion, eager invalid-row repair, generic content/key/scoring/
scope/time/ID/status mutations, account/SQL-row mismatch, legacy pinning/unknown
scoring, standalone insertion failures and outer rollback. Existing raw-SQL,
replay/lifecycle, migration and physical-cleanup tests also passed in the full suite.
Source-manifest reconstruction, common-harness identity and all 12 measured-run
semantic/request/actor/connection/timer/sample-count assertions passed. Diff checks
and redacted installed Gitleaks staged/range scans are recorded before publication.
Fresh independent review and CI are pending with the parent; no readiness claim.

Private 0700 directories/0600 files: `/tmp/pr83-correction` contains red/green,
checks, exact before/after archives/manifests, implementation patch, common external
annotation harness and hashes, measurements and audits; `/tmp/study-performance-p4lzv7uq`
contains pinned common-run sources/manifests/patches, metadata, every numeric sample
and audited `metrics.json`. Original `/tmp/pr83-review-round1`,
`/tmp/study-evidence81-R0NYza` and `/tmp/study-performance-nt8k0nj8` are retained
unchanged. No dependencies installed, agent delegation/watchers, real application,
personal databases, forbidden fixed ports, deployment or merge. Implementation:
GPT-6.1 Sol, medium reasoning. Parent owns fresh review/CI.

## 2026-10-27 — protect standalone annotation against concurrent writers (round2 P2)

The round2 reviewer reproduced a persistent mismatch at `ce8b092`: annotation
read authoritative snapshots before its savepoint, a separate repository writer
committed new scoring, then annotation wrote the old snapshot while retaining the
new valid projection. A checksum authenticates the projection's payload and scope;
it does not establish association with the earlier unprotected snapshot.

`updateSnapshots` now enters the existing nestable library transaction before its
SELECT. Standalone calls acquire `BEGIN IMMEDIATE`; calls inside any active SQLite
transaction (including QuizRepository callers) use a savepoint and retain the outer lock/commit/rollback boundary.
The protected view spans snapshot read, projection capture, update-trigger
invalidation, restoration or eager rebuild, and all annotated rows. A later-row
failure rolls back the entire annotation. Busy acquisition propagates without
writes and restores transaction depth; no caller transaction precondition, retry,
deferred repair, schema/version or checksum relaxation was added. Generic callbacks
still rebuild. Standalone success uses the normal library revision increment;
nested calls leave revision/commit to their owner. Existing production callers
already held the outer write lock; their only extra boundary is a savepoint.

The deterministic test pauses immediately after the real snapshot SELECT and
runs a separate Node process through `QuizRepository.save` against a disposable
file. On `ce8b092` it committed, and the original reviewer probe reproduced
19 persisted due versus 20 from untouched PR82 full replay after restart. With the
correction, the writer receives SQLite BUSY and restart produces 20/20. Retrying
the writer after annotation returns succeeds, and another restart matches full
replay with 19 due. Additional tests cover existing-lock acquisition failure,
later-row rollback, a caught nested failure followed by a successful outer write,
and recovery after trigger failure. Existing generic mutation, legacy, eager
repair, raw-writer and outer rollback tests remain intact.

Fresh independent review and CI/readiness belong to the parent. PR83 stays draft;
PR82's prior approval is unaffected. Issue #81 stays open for remaining contention,
first-use/rebuild/startup and unbounded history work. The previous 12/12 under
200 ms series belongs to `9370c33` (runtime-equivalent to `ce8b092`), not this
correction. Its limits remain historical: contention 314.9 ms, version rebuild
1147.4 ms, startup 4101.1 ms and first use 1088.4 ms. Round2's fresh approved82
versus `ce8b092` three-pair annotation comparison found deletion medians
402.8 → 675.1 ms and other-account HTTP 412.5 → 677.0 ms. Integrity validation,
reinsertion and trigger/write costs remain; this correction does not optimize them.

### Bounded final-runtime comparison

Baseline `ce8b092a08dbad8d2cdb2a0c5cf73ea0132fd4d8` versus that commit plus
`/tmp/pr83-race-correction/runtime.patch`. Exact archive, per-file SHA256 manifests,
patch reconstruction and identical six-file common harness are retained and
verified. The final commit is recorded in the PR. A final publication patch adds only the linter-required blank line; its exact
diff is retained as `publication-format.patch`. No behavior changed after
these measurements. Unchanged `study-history-v2-answered` harness, one fresh-file
repetition per revision/profile (four complete runs), sequential base history,
base diverse, final history, final diverse. An intermediate wrapper failed the
startup semantic assertion because it did not recognize QuizRepository's outer
transaction; its exact source/patch/failed log are retained separately and excluded
from measurements. The corrected boundary checks SQLite's actual transaction state.

Node 24.22.1, Linux 7.0.0-38-generic, i5-8265U/eight logical CPUs, 31.1 GiB RAM,
shared host, warm setup/OS cache, OS-selected loopback ports. Starting common-run
load averages ranged 1.57–4.45 (one minute); free memory about 13 GiB. No tests or
other benchmarks launched by this agent overlapped the measurement runs. Base
preceded correction; drift/order and the shared host limit comparison. History
uses coherent repeated empty answers; diverse uses validated graded answers and
larger due sets. Limited identities/repeated timestamps, warmed recovery, synthetic
auth and local transport remain boundaries. One observation per cell supports no
percentile/distribution or speedup claim. All sample/actor/timer/service/memory,
write, startup and rebuild records remain in the private logs/metrics.

HTTP milliseconds, baseline → correction (startup is service elapsed):

| Profile |    Quiz start |      Due read | Backlog reconcile | Private annotation | Complete write | Startup recovery |
| ------- | ------------: | ------------: | ----------------: | -----------------: | -------------: | ---------------: |
| history | 170.6 → 168.2 | 154.5 → 159.3 |     436.1 → 437.0 |      382.4 → 392.6 |      9.3 → 9.6 |  2393.8 → 2404.5 |
| diverse | 209.9 → 213.9 | 175.9 → 163.3 |     461.5 → 453.3 |      403.7 → 453.2 |      8.7 → 9.3 | 21585.9 → 2424.4 |

Corrected normal HTTP observations: **168.2, 159.3, 213.9, 163.3 ms**
(history start/due, diverse start/due). **4/4 below 300 ms, 3/4 below preferred
200 ms**, max 213.9 ms. Baseline diverse start was 209.9 ms; the preferred budget
miss remains visible. These four samples do not replace the historical twelve.
The baseline diverse startup outlier of 21585.9 ms is retained, not pooled away
or attributed to this correction. Target and timing-CI policy are unchanged.

Corrected normal service / maximum sampled event-loop gap / sampled peak RSS:

| Profile / request  | Service ms | Gap ms | RSS MiB |
| ------------------ | ---------: | -----: | ------: |
| history quiz-start |      166.4 |  166.8 |   397.3 |
| history due-read   |      157.7 |  159.1 |   407.1 |
| diverse quiz-start |      211.8 |  212.5 |   393.3 |
| diverse due-read   |      161.6 |  163.0 |   398.3 |

Other-account contention maxima were 290.2 ms (history) and 296.7 ms (diverse)
in the corrected common runs (ten samples per actor/profile). Corrected first-use
backfill was 1046.6/971.9 ms, version rebuild 1034.4/1125.3 ms, reopen+due
142.5/132.9 ms, and schema-backfill due 1069.4/1056.0 ms (history/diverse).
Recovery remains expensive. Memory is sampled RSS, not a guaranteed peak; event-loop
gaps include synchronous work and shared-host scheduling, not isolated CPU time.

Two additional fresh-file pairs use the retained-bank probe: 2,000 valid confident
attempts / 40,000 question snapshots, 250-question deleted source plus a surviving
identical-content source. Pair one runs baseline then correction; pair two reverses
order. Real deletion service / other-account HTTP milliseconds, with an independent
client and another account; the external HTTP wrapper is not the production router:

| Pair / order       | Deletion baseline → correction | Other HTTP baseline → correction | Next corrected due / start HTTP |
| ------------------ | -----------------------------: | -------------------------------: | ------------------------------: |
| 1 / base then head |                1352.4 → 1941.1 |                  1382.6 → 1945.9 |                   183.2 / 182.7 |
| 2 / head then base |                  683.7 → 704.4 |                    683.5 → 712.1 |                   142.1 / 177.2 |

All 4,000 corrected projection rows were byte-identical before/after annotation.
Next due/start succeeded with evidence INSERTs prohibited, proving no deferred
reconstruction in either corrected run. Pair one's high values are retained;
reverse order was a bounded follow-up, not a replacement. Two pairs cannot isolate
host/order effects or establish the cost of one savepoint; no annotation performance
improvement is claimed. Bulk work still misses the responsiveness goal. The
reviewer's approved82-versus-ce8b three-pair comparison above remains the stronger
historical baseline-regression evidence. No statement-preparation or architecture
rewrite was included in this correctness correction.

Evidence directory `/tmp/pr83-race-correction` (0700/0600): baseline archive,
source manifests and exact runtime patch; original red and final green real-process
interleaving logs, standalone/outer control probes, 100-history / 12-selection /
384-DST / raw-writer / abrupt-exit / migration/cleanup probes, focused tests,
four common raw logs and derived metrics, both annotation pairs, source
reconstruction audit and final publication checks. Earlier evidence directories
are unchanged. Implementation: GPT-6.1 Sol, medium reasoning. No agents/watchers,
installations, personal databases, real application, forbidden ports, merge or
deployment. Fresh independent review and CI remain pending with the parent.

Final runtime `npm run check` passed formatting, ESLint, **356/356 tests**, native
TypeScript and Vite build; focused affected suite **37/37** passed. Deterministic
real-writer red/green and final standalone/outer replay controls passed with the
expected rejection before write, restart equivalence and post-release retry.
Source reconstruction/common-harness audit, final diff checks and redacted staged
Gitleaks passed. Independent review/CI remain pending with the parent; this is
local verification, not PR readiness. The measured-source to publication-source
code delta is one linter-required blank line, retained in `publication-format.patch`.
