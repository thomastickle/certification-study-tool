# Persisted study evidence (#81)

The target is **under 300 ms, preferably under 200 ms**, for normal large-history
quiz-start and due HTTP reads. First-use, rebuilds and contention are reported
separately. These are synthetic engineering targets on recorded hardware, not
production guarantees. Refs #81; parent independent review remains required.

The final three-run series kept all **12 normal large-history quiz-start/due HTTP
observations below 300 ms; 11 were below 200 ms**. The largest was 218.1 ms.
This meets the normal-request target in this bounded series, not a general latency
SLO. Other-account contention still reached 358.3 ms; full rebuilds reached
2301.3 ms, and large provenance annotation became slower. The issue stays open.

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
Annotation writes proactively replace projections. Private transfer copies only
authoritative snapshots; destination invalidation and lazy reconstruction avoid
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

Provenance annotation conservatively replaces affected projections rather than
assuming a generic annotation callback cannot change scoring. This adds substantial
work to large bulk annotations. It is a measured regression/tradeoff, not a solved
write path. Relevant non-target HTTP operations, ms:

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

A possible follow-up is safe projection retention for proven provenance-only
mutations, plus investigation of remaining compact replay/current-library costs.
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
