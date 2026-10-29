# Nest conversion performance — 2026-10-28

The authenticated Nest path met the normal 300 ms target in this synthetic series:
**12/12** large-history quiz/due observations were below 300 ms, **10/12** below
200 ms, maximum **238.3 ms**. The pinned pre-Nest path had 12/12 below 300 ms,
11/12 below 200 ms, maximum 280.4 ms. Counts use unrounded values; tables round to
one decimal place. This is a budget observation, not a speedup, tail-latency or
production guarantee. Each normal cell contains only three observations.

Issue #81 stays open: Nest does not remove synchronous SQLite/history work.
Other-account HTTP reached 313.7 ms; private deletion/annotation reached 480.2 ms;
foreground backlog reconciliation reached 502.3 ms. First-use backfill reached
1036.6 ms, full version rebuild 1194.4 ms, seeded startup recovery 2419.9 ms.
The baseline's 16577.0 ms seeded-startup outlier is retained below. Recurring
large-owner upkeep medians were higher in the Nest series (history 712.1 vs
598.5 ms, diverse 704.9 vs 598.0 ms); this experiment does not isolate the cause.
Sampled HTTP-phase worker RSS reached 539.5 MiB on Nest versus 473.7 MiB on the
baseline. RSS is sampled, excludes the parent and idle deployment components,
and does not establish a production memory limit.

## Exact sources and method

- Pre-Nest: `fcf980bcc1f45e61a251cd3584fadb200e62a023` (origin/master at kickoff).
- Nest: `22ac48926710c8d475e0feaf0fcdaaa26d14f5df` (both migrations integrated,
  obsolete dispatchers removed). Later report/documentation edits do not change
  the measured production source, dependencies or harness.
- Common workload: `study-history-v2-answered`. Four profiles, three sequential
  fresh-fixture repetitions per revision: **24 fixtures, 696 measured HTTP requests**
  plus untimed verification calls. Every ordinary HTTP cell has n=3; busy-account
  reads have n=60 per profile/revision; other-account cells have n=30. Sampled p95
  uses nearest rank and is not a population tail estimate. All observations remain
  in the private logs; none were trimmed or retried for timing.
- Run order: all baseline small/bank/history/diverse, then all Nest
  small/bank/history/diverse. Fixed order, changing host load, no CPU pinning,
  warm setup/OS caches, local synthetic files and no injected disk/network faults.
  No other owned validation/benchmark task ran during sampling; this shared host
  was not otherwise idle. Profile timestamps/load/free memory appear below.
- Node 24.22.1; Linux 7.0.0-38-generic; Intel i5-8265U; eight logical/available CPUs;
  31.1 GiB total RAM. This is not an ARM/EC2/EBS or production-load measurement.
- Current lockfile-compatible node_modules are reused for both archived revisions;
  this is not an install of each revision's historical dependency graph. The
  dependency lock, runner snapshot, archives, exact common-harness patches, source
  SHA256 manifests, Nest emitted manifest and raw logs are retained privately at
  `/tmp/study-performance-2cpxjmb9` (0700/0600). Analysis and executed check records
  live at `/tmp/nest-final-integration` (0700/0600). Both archive-plus-patch source
  reconstructions and a fresh reconstructed Nest emit match the retained manifests.

The old adapter intentionally bypasses sessions. Nest samples include actual
cookie-session admission, guards, controllers and request-owned private storage;
OIDC login/provider traffic and public static/Vite serving are outside sampling.
This comparison cannot isolate pure framework overhead. Nest's service clock
covers scope open/body/service/observation/close, excluding admission and guards;
the legacy clock begins in its manual Node handler. Do not subtract service clocks
from HTTP clocks or compare them as identical boundaries. HTTP clocks on both
paths consume complete responses. See [harness migration](nest-benchmark-migration.md).

Both paths use explicit manual housekeeping with a deterministic monotonic clock;
production retains its real one-second background schedule. `startup-recovery`
measures a seeded upkeep pass, not process/Nest bootstrap. `initialSchemaOpenMs`
includes empty Nest runtime composition on the new path, whereas the baseline
measures legacy initialization; its boundary differs. Recovery phase timings are
in-process service probes, not authenticated HTTP requests. Aggregate decoding is
only a non-equivalent lower bound; it is not an implemented alternative cache.
Timer gaps include a final timer drain, but do not bound every possible stall.

Every repetition checked real scoring/chronology, answered confidence diversity,
replay equality, saved identities/digests, exact deletion annotations/cursors,
actor-specific history results, private isolation, request connection counts and
zero active connections after each measured phase. Nest additionally required
observation before close for every request. Version/corruption/schema recovery
was rechecked against authoritative history, including final post-probe replay.
The parent watchdog and SIGTERM/SIGKILL escalation remained active; normal workers
exited cleanly. Forced termination can still leave synthetic artifacts.

## Reproduction and validation

```sh
# Use supported Node 24 and existing repository-local dependencies.
umask 077
/usr/bin/flock /tmp/study-nest-final-check.lock python3 scripts/compare-study-performance.py \
  --base fcf980bcc1f45e61a251cd3584fadb200e62a023 \
  --head 22ac48926710c8d475e0feaf0fcdaaa26d14f5df \
  --profiles small bank history diverse --repetitions 3
```

This command exited 0. The independent sample/count/arithmetic audit and exact
source/emitted reconstruction also passed. Fresh clean-start `npm run check` at
the measured Nest head passed formatting/lint, **293 native +180 compiled tests**,
typecheck and server/frontend builds. Diff checks and redacted staged/hook/full
conversion-range Gitleaks passed before publication. The benchmark and test
migrations were independently approved at their own exact child heads; final
whole-conversion review and CI remain separate gates.

Earlier intermittent development-supervisor startup/shutdown test failures remain
unexplained. Final author, child reviewer and integrated checks passed without
altering script behavior, test assertions or bounds. That does not prove the
intermittent issue is fixed. No cold-disk, production authentication-provider,
real bank or concurrent production-background workload claim is made here.

## HTTP milliseconds: median (range)

| Profile / operation                      |            Pre-Nest |                Nest |
| ---------------------------------------- | ------------------: | ------------------: |
| small / import-preview                   |    16.9 (12.7–67.6) |    25.2 (18.7–64.5) |
| small / import-confirm                   |    25.6 (18.2–37.3) |    28.5 (18.4–36.9) |
| small / quiz-start                       |    16.0 (13.6–23.5) |    13.6 (13.1–20.7) |
| small / quiz-complete                    |      8.7 (8.2–10.0) |      9.3 (8.8–11.3) |
| small / due-read                         |       8.3 (6.7–8.5) |      8.7 (8.0–10.0) |
| small / foreground-reconcile-backlog     |       9.3 (8.5–9.3) |    10.2 (10.0–11.0) |
| small / private-delete-with-annotation   |      9.1 (8.5–10.8) |    11.2 (11.1–12.7) |
| small / shared-delete-event              |       6.7 (6.5–8.1) |      8.3 (7.1–17.3) |
| small / foreground-reconcile-new-event   |       8.2 (7.3–8.8) |      8.7 (8.4–19.1) |
| small / busy-account-reads               |     10.4 (4.1–26.1) |     11.5 (4.7–30.3) |
| bank / import-preview                    |    49.4 (46.0–84.4) |   51.1 (50.9–128.1) |
| bank / import-confirm                    | 119.0 (106.7–130.0) |  106.1 (98.3–128.1) |
| bank / quiz-start                        |    73.4 (61.1–78.0) |    72.6 (66.9–80.6) |
| bank / quiz-complete                     |      8.6 (8.5–11.7) |     10.6 (9.4–14.7) |
| bank / due-read                          |    53.9 (48.2–55.8) |    54.4 (53.7–79.9) |
| bank / foreground-reconcile-backlog      |    27.0 (24.0–57.5) |    28.8 (27.4–40.6) |
| bank / private-delete-with-annotation    |    29.9 (29.3–47.1) |    31.3 (29.7–49.7) |
| bank / shared-delete-event               |    14.1 (13.9–29.0) |    15.3 (14.6–28.1) |
| bank / foreground-reconcile-new-event    |    12.8 (12.7–14.6) |    15.2 (13.6–15.4) |
| bank / busy-account-reads                |    42.9 (25.9–79.1) |    49.4 (28.2–80.7) |
| history / import-preview                 |    51.5 (48.1–88.8) |    52.4 (47.8–94.1) |
| history / import-confirm                 |  102.1 (94.6–355.7) |  100.1 (97.2–101.9) |
| history / quiz-start                     | 181.9 (165.1–280.4) | 183.9 (180.8–199.3) |
| history / quiz-complete                  |      8.9 (8.4–48.2) |       8.8 (8.8–9.6) |
| history / due-read                       | 163.1 (157.2–176.6) | 157.2 (155.3–175.1) |
| history / foreground-reconcile-backlog   | 451.9 (442.8–479.4) | 467.8 (431.9–473.5) |
| history / private-delete-with-annotation | 417.5 (392.1–418.2) | 445.2 (417.1–476.0) |
| history / shared-delete-event            |    14.4 (14.2–14.6) |    14.6 (14.3–16.5) |
| history / foreground-reconcile-new-event | 133.9 (126.9–146.4) | 133.4 (126.0–134.4) |
| history / busy-account-reads             | 154.9 (124.1–312.6) | 177.7 (126.8–305.9) |
| diverse / import-preview                 |    40.0 (39.7–84.0) |    55.2 (45.6–94.5) |
| diverse / import-confirm                 | 116.3 (103.2–125.3) | 105.3 (100.1–109.8) |
| diverse / quiz-start                     | 173.3 (170.6–200.0) | 177.4 (176.7–233.6) |
| diverse / quiz-complete                  |     11.5 (9.3–25.7) |       9.1 (8.6–9.4) |
| diverse / due-read                       | 175.6 (169.4–177.4) | 186.2 (171.8–238.3) |
| diverse / foreground-reconcile-backlog   | 470.5 (436.0–541.9) | 480.3 (460.3–502.3) |
| diverse / private-delete-with-annotation | 445.5 (400.0–475.7) | 420.3 (393.4–480.2) |
| diverse / shared-delete-event            |    13.9 (13.8–14.0) |    14.7 (14.5–14.9) |
| diverse / foreground-reconcile-new-event | 144.5 (134.7–144.6) | 138.8 (128.4–139.6) |
| diverse / busy-account-reads             | 180.7 (126.8–318.7) | 165.1 (132.0–313.7) |

## Normal large-history observations

base: 12/12 below 300 ms; 11/12 below 200 ms; max 280.4 ms.

- base history quiz-start: 181.9, 280.4, 165.1
- base history due-read: 163.1, 176.6, 157.2
- base diverse quiz-start: 173.3, 170.6, 200.0
- base diverse due-read: 169.4, 177.4, 175.6
  head: 12/12 below 300 ms; 10/12 below 200 ms; max 238.3 ms.
- head history quiz-start: 183.9, 199.3, 180.8
- head history due-read: 175.1, 155.3, 157.2
- head diverse quiz-start: 177.4, 233.6, 176.7
- head diverse due-read: 171.8, 238.3, 186.2

## Sampled service milliseconds: median (range)

These service clocks have different boundaries; do not interpret them as identical operations.

| Profile / operation                      |      Legacy handler |    Nest owned scope |
| ---------------------------------------- | ------------------: | ------------------: |
| small / import-preview                   |     10.5 (8.7–12.8) |      7.2 (6.9–10.8) |
| small / import-confirm                   |    24.6 (16.0–34.2) |    25.7 (15.9–33.0) |
| small / quiz-start                       |    13.8 (12.8–20.9) |    11.1 (10.6–15.3) |
| small / quiz-complete                    |       7.7 (6.6–8.5) |       6.8 (6.4–7.1) |
| small / due-read                         |       6.6 (6.0–7.5) |       6.2 (5.7–7.9) |
| small / foreground-reconcile-backlog     |       7.9 (7.8–8.4) |       8.1 (7.5–9.0) |
| small / private-delete-with-annotation   |      8.3 (8.1–10.3) |       9.2 (8.9–9.6) |
| small / shared-delete-event              |       5.9 (5.8–7.6) |      6.5 (5.2–12.6) |
| small / foreground-reconcile-new-event   |       7.2 (6.2–7.3) |      6.6 (5.9–13.8) |
| small / busy-account-reads               |       3.3 (2.8–9.5) |       3.0 (2.7–9.2) |
| bank / import-preview                    |    40.0 (36.9–44.4) |    38.1 (38.0–48.2) |
| bank / import-confirm                    | 116.8 (105.1–128.2) |  101.6 (94.0–122.7) |
| bank / quiz-start                        |    72.3 (60.4–76.3) |    68.9 (62.4–77.7) |
| bank / quiz-complete                     |      7.5 (6.9–10.1) |       7.7 (6.4–9.4) |
| bank / due-read                          |    53.4 (47.5–54.1) |    52.7 (50.9–76.8) |
| bank / foreground-reconcile-backlog      |    26.6 (23.5–54.8) |    25.5 (24.9–36.7) |
| bank / private-delete-with-annotation    |    29.5 (29.1–46.7) |    29.2 (28.0–47.3) |
| bank / shared-delete-event               |    13.5 (13.2–26.3) |    13.9 (13.1–23.4) |
| bank / foreground-reconcile-new-event    |    12.2 (11.8–13.2) |    12.8 (11.9–13.5) |
| bank / busy-account-reads                |     13.1 (2.8–34.6) |     18.2 (2.7–38.3) |
| history / import-preview                 |    43.5 (39.3–45.0) |    34.1 (33.8–34.6) |
| history / import-confirm                 |  101.0 (94.2–355.6) |    95.9 (93.2–96.4) |
| history / quiz-start                     | 180.0 (164.4–278.7) | 180.5 (178.4–197.0) |
| history / quiz-complete                  |      7.5 (7.3–45.2) |       6.4 (5.6–6.9) |
| history / due-read                       | 160.9 (156.6–175.1) | 155.3 (153.4–171.6) |
| history / foreground-reconcile-backlog   | 452.2 (442.5–475.9) | 463.7 (429.0–470.9) |
| history / private-delete-with-annotation | 418.1 (392.2–419.2) | 438.0 (414.7–474.0) |
| history / shared-delete-event            |    13.7 (13.5–13.8) |    12.8 (12.7–14.7) |
| history / foreground-reconcile-new-event | 133.5 (126.4–145.0) | 130.7 (124.4–132.5) |
| history / busy-account-reads             |    14.9 (2.8–172.3) |    19.1 (2.8–153.6) |
| diverse / import-preview                 |    34.7 (34.5–35.7) |    36.4 (32.4–37.0) |
| diverse / import-confirm                 | 115.6 (101.2–124.5) |   99.8 (95.9–104.1) |
| diverse / quiz-start                     | 171.5 (169.5–199.2) | 174.4 (174.0–230.6) |
| diverse / quiz-complete                  |      9.8 (7.7–24.6) |       6.4 (5.9–6.5) |
| diverse / due-read                       | 174.9 (167.3–176.5) | 184.2 (168.9–236.2) |
| diverse / foreground-reconcile-backlog   | 476.0 (439.3–542.1) | 477.4 (457.2–499.4) |
| diverse / private-delete-with-annotation | 446.0 (400.6–476.4) | 418.5 (391.4–477.9) |
| diverse / shared-delete-event            |    13.4 (13.0–13.5) |    13.1 (12.9–13.4) |
| diverse / foreground-reconcile-new-event | 143.7 (132.5–143.7) | 136.3 (126.5–137.5) |
| diverse / busy-account-reads             |    18.7 (2.8–165.7) |    13.5 (2.8–154.4) |

## Other-account contention, 30 samples per profile/revision

| Profile | Pre-Nest median / sampled p95 / max | Nest median / sampled p95 / max |
| ------- | ----------------------------------: | ------------------------------: |
| small   |                  13.6 / 21.9 / 26.1 |              14.6 / 29.8 / 30.3 |
| bank    |                  42.9 / 72.4 / 79.1 |              49.4 / 80.3 / 80.7 |
| history |               154.9 / 288.0 / 312.6 |           177.7 / 305.5 / 305.9 |
| diverse |               180.7 / 315.9 / 318.7 |           165.1 / 305.8 / 313.7 |

## Timer gaps and sampled RSS across HTTP phases

| Profile | Pre-Nest max gap ms / sampled peak MiB | Nest max gap ms / sampled peak MiB |
| ------- | -------------------------------------: | ---------------------------------: |
| small   |                           35.1 / 128.3 |                       35.0 / 136.9 |
| bank    |                          126.3 / 200.4 |                      122.1 / 194.2 |
| history |                          476.6 / 456.0 |                      476.0 / 483.7 |
| diverse |                          542.8 / 473.7 |                      501.8 / 539.5 |

## Recovery and recurring work milliseconds: median (range)

| Profile / operation                   |                Pre-Nest |                   Nest |
| ------------------------------------- | ----------------------: | ---------------------: |
| small / startup-recovery              |     212.1 (177.6–212.1) |    171.7 (168.9–192.2) |
| small / recurring-reconciliation      |        59.0 (55.9–78.5) |       64.7 (58.2–66.6) |
| small / initialSchemaOpenMs           |        55.7 (43.0–55.9) |     104.4 (86.1–116.6) |
| small / fullReplayMs                  |           5.0 (4.9–5.1) |          5.5 (5.4–6.3) |
| small / aggregateDecodeLowerBoundMs   |           0.1 (0.1–0.4) |          0.1 (0.1–0.1) |
| small / restartOpenDueMs              |          2.8 (2.8–14.8) |         3.3 (3.2–11.0) |
| small / persistedDueMs                |           2.4 (2.3–8.5) |          2.6 (2.5–5.7) |
| small / invalidateAllMs               |          7.7 (5.0–16.9) |        10.1 (9.6–15.9) |
| small / firstUseBackfillDueMs         |        11.2 (11.2–29.1) |       14.0 (12.6–16.6) |
| small / markVersionMs                 |           4.1 (3.2–4.2) |          4.9 (3.3–6.2) |
| small / versionRebuildDueMs           |        13.0 (12.5–16.3) |       30.1 (13.3–32.7) |
| small / corruptRowMs                  |           4.4 (3.3–4.5) |          3.5 (3.3–4.8) |
| small / corruptRecoveryDueMs          |           7.6 (6.8–8.1) |          6.6 (6.2–7.4) |
| small / derivedSchemaReopenMs         |           5.5 (5.2–7.5) |          4.4 (4.0–4.4) |
| small / schemaBackfillDueMs           |        31.3 (11.6–33.0) |       12.3 (12.1–12.7) |
| bank / startup-recovery               |     270.6 (214.2–283.0) |    195.3 (187.4–248.8) |
| bank / recurring-reconciliation       |        65.2 (50.5–87.1) |       54.9 (53.5–63.6) |
| bank / initialSchemaOpenMs            |        54.5 (47.4–62.8) |      92.2 (86.7–118.1) |
| bank / fullReplayMs                   |        42.3 (39.8–52.3) |       41.7 (39.6–43.3) |
| bank / aggregateDecodeLowerBoundMs    |           0.1 (0.1–0.2) |          0.1 (0.1–0.1) |
| bank / restartOpenDueMs               |        27.2 (26.6–34.5) |       54.4 (32.1–73.1) |
| bank / persistedDueMs                 |        23.8 (23.2–26.1) |       31.0 (30.8–31.5) |
| bank / invalidateAllMs                |         12.6 (9.8–20.0) |        11.7 (9.8–16.3) |
| bank / firstUseBackfillDueMs          |        82.2 (73.2–93.5) |       82.3 (77.2–96.8) |
| bank / markVersionMs                  |           5.6 (5.2–5.8) |          5.6 (5.1–7.7) |
| bank / versionRebuildDueMs            |        90.4 (75.6–90.7) |     108.0 (94.4–126.9) |
| bank / corruptRowMs                   |           3.7 (3.6–4.6) |          4.5 (3.5–4.6) |
| bank / corruptRecoveryDueMs           |        33.9 (29.7–38.4) |       40.8 (33.7–44.4) |
| bank / derivedSchemaReopenMs          |           4.9 (4.1–5.2) |          4.8 (4.0–5.0) |
| bank / schemaBackfillDueMs            |       92.4 (87.9–100.6) |      95.9 (84.4–102.0) |
| history / startup-recovery            | 2488.1 (2202.2–16577.0) | 2325.8 (2274.0–2419.9) |
| history / recurring-reconciliation    |     598.5 (589.0–609.4) |    712.1 (635.8–742.2) |
| history / initialSchemaOpenMs         |        49.8 (42.6–55.3) |       98.6 (86.8–99.8) |
| history / fullReplayMs                |     808.2 (805.3–833.1) |    853.8 (805.2–883.6) |
| history / aggregateDecodeLowerBoundMs |           0.2 (0.2–0.2) |          0.1 (0.1–0.1) |
| history / restartOpenDueMs            |     124.8 (123.4–155.9) |    131.9 (125.5–135.0) |
| history / persistedDueMs              |     118.8 (115.3–128.6) |    133.5 (120.3–140.6) |
| history / invalidateAllMs             |        11.7 (11.0–15.1) |       12.2 (10.4–17.7) |
| history / firstUseBackfillDueMs       |     972.5 (949.4–985.8) |   989.0 (964.4–1007.9) |
| history / markVersionMs               |        46.5 (45.0–49.1) |       66.7 (50.4–81.8) |
| history / versionRebuildDueMs         |  1057.1 (1051.3–1100.8) | 1079.5 (1072.8–1194.4) |
| history / corruptRowMs                |           5.9 (5.0–6.4) |          7.5 (6.9–7.9) |
| history / corruptRecoveryDueMs        |     136.5 (128.8–150.3) |    145.9 (135.5–146.8) |
| history / derivedSchemaReopenMs       |           5.1 (5.1–6.4) |          5.1 (4.2–5.9) |
| history / schemaBackfillDueMs         |   1003.8 (979.6–1013.4) | 1019.7 (1005.8–1058.2) |
| diverse / startup-recovery            |  2265.7 (2232.3–2291.9) | 2380.4 (2320.1–2389.7) |
| diverse / recurring-reconciliation    |     598.0 (587.9–615.1) |    704.9 (634.0–718.4) |
| diverse / initialSchemaOpenMs         |        42.8 (37.3–42.9) |     104.2 (98.2–111.8) |
| diverse / fullReplayMs                |     883.8 (842.4–906.4) |    878.2 (859.0–884.6) |
| diverse / aggregateDecodeLowerBoundMs |           1.3 (1.0–1.4) |          1.0 (1.0–1.1) |
| diverse / restartOpenDueMs            |     139.1 (138.5–144.3) |    140.0 (137.8–152.2) |
| diverse / persistedDueMs              |     135.1 (121.6–168.6) |    126.0 (124.5–127.2) |
| diverse / invalidateAllMs             |         11.6 (6.6–14.1) |        11.1 (9.9–12.3) |
| diverse / firstUseBackfillDueMs       |  1029.9 (1016.9–1332.3) |  1017.6 (990.9–1036.6) |
| diverse / markVersionMs               |        46.9 (46.4–47.5) |       46.9 (44.6–53.0) |
| diverse / versionRebuildDueMs         |  1188.2 (1120.4–1211.6) | 1154.5 (1135.2–1192.4) |
| diverse / corruptRowMs                |           7.2 (5.9–7.4) |          7.2 (7.0–8.1) |
| diverse / corruptRecoveryDueMs        |     145.5 (145.4–153.1) |    147.0 (141.8–165.0) |
| diverse / derivedSchemaReopenMs       |           5.4 (4.8–7.1) |          5.1 (4.1–5.3) |
| diverse / schemaBackfillDueMs         |  1124.2 (1072.8–1138.0) | 1098.2 (1091.4–1122.9) |

## Host observations per profile/revision

- base small: 2026-10-28T05:24:41.092Z; load [4.71, 4.62, 5.27]; free 13.32 GiB; {'owners': 10, 'histories': 10, 'questions': 48, 'backlog': 1}.
- base bank: 2026-10-28T05:24:48.707Z; load [4.31, 4.53, 5.23]; free 13.29 GiB; {'owners': 10, 'histories': 100, 'questions': 1000, 'backlog': 25}.
- base history: 2026-10-28T05:25:02.695Z; load [4.17, 4.5, 5.21]; free 13.29 GiB; {'owners': 100, 'histories': 2000, 'questions': 1000, 'backlog': 100}.
- base diverse: 2026-10-28T05:27:07.754Z; load [3.15, 3.81, 4.85]; free 13.30 GiB; {'owners': 100, 'histories': 2000, 'questions': 1000, 'backlog': 100, 'answered': True}.
- head small: 2026-10-28T05:29:06.932Z; load [2.19, 3.4, 4.59]; free 13.28 GiB; {'owners': 10, 'histories': 10, 'questions': 48, 'backlog': 1}.
- head bank: 2026-10-28T05:29:15.777Z; load [2.16, 3.35, 4.56]; free 13.30 GiB; {'owners': 10, 'histories': 100, 'questions': 1000, 'backlog': 25}.
- head history: 2026-10-28T05:29:31.235Z; load [2.26, 3.32, 4.53]; free 13.28 GiB; {'owners': 100, 'histories': 2000, 'questions': 1000, 'backlog': 100}.
- head diverse: 2026-10-28T05:31:24.885Z; load [2.26, 2.97, 4.26]; free 13.41 GiB; {'owners': 100, 'histories': 2000, 'questions': 1000, 'backlog': 100, 'answered': True}.
