# Study performance ledger

Target: normal corrected large-history quiz creation and due HTTP reads **under
300 ms, preferably under 200 ms**. Track slow observations, first-use/rebuilds and
other-account contention separately. A favorable median does not establish a tail
or production guarantee. Budget misses trigger investigation; record the rationale
for any deliberate target/workload change here instead of changing the goalposts.

## Repeatable comparison

On repository-supported Node 24 with existing lockfile-compatible dependencies:

```sh
python3 scripts/compare-study-performance.py \
  --base <approved-base-sha> --head <candidate-sha> \
  --profiles small history diverse --repetitions 3
```

The script archives both exact commits into restricted temporary directories,
overlays the same current benchmark files on both, hashes all measured source,
retains exact patches, and runs each series sequentially against fresh synthetic
SQLite files and OS-selected loopback ports. It installs nothing. Run without
competing tests/benchmarks. Never substitute a personal database. Inspect raw logs
privately and append sanitized results; do not upload raw profiles or snapshots.
The printed evidence directory contains source manifests, common-harness patches,
run order/SHAs and every observation. The benchmark records Node, CPU, memory,
load, timestamp, HTTP/service distributions, drained timer gaps, sampled RSS,
connections, actors and semantic invariants. `evidence-costs` separates persisted
reads, reopen, invalidation, first-use/schema backfill, version rebuild, corruption
recovery and a nonfunctional aggregate-decode lower bound. Completion HTTP/service
time is the write-cost observation; do not treat setup or backfill as free work.

Current workload version: **study-history-v2-answered**. `history` retains the
corrected chronology and empty/null-confidence fixture; `diverse` adds accepted
answered hits/misses/confidence categories across a much larger identity pool,
with asserted recovery states and at least 100 due identities. It is still synthetic
and uses repeated timestamps. Small/history bank/owner sizes remain as in the
existing harness. Every completed question is checked through real scoring before
sampling and after recovery. The suite preserves snapshot/identity/provenance,
account, connection and worker-shutdown guards. CI tests semantic and work-count
invariants, without wall-clock pass/fail gates.

Rerun comparable profiles for changes affecting selection/history, storage,
concurrency, Node/runtime/framework, deployment hardware, and before relevant
releases. Record date, application commits, workload/harness version, Node,
hardware/load/cache conditions, sample counts, HTTP median/range and useful
sampled percentiles, service time, timer gaps, other-account latency, sampled memory,
completion/write cost and separated first-use/restart/rebuild observations. Label
synthetic versus production observations. Preserve prior entries. After fixture or
methodology changes, rerun a common baseline before drawing comparisons; include
an exact patch/hash manifest when measurements differ from a commit's harness.
No scheduler, telemetry platform or dependency is introduced.

## 2026-10-27 — historical boundary and approved request-local slice

[Original investigation](performance-investigation.md) used invalid completion
chronology: retain it only as malformed-workload evidence. The earlier 2.4-second,
42%-due-gain and CPU-proportion claims are not valid completed-history baselines.

[Corrected PR82 report](study-history-optimization.md) records three sequential
repetitions per profile/revision on Node 24.22.1, Intel i5-8265U, eight logical CPUs,
warm OS cache/shared host, pinned base `fe9fc2a8bc8cf0fc8d4e08770584140ed7f9fb94`
and request-local production implementation (approved final commit
`47a54e647c93ec0e0669d073ef3cb256baf07cbf`, with exact measured-source overlays
in its report). History HTTP medians: quiz-start 1860.6 → 936.3 ms; due 910.8 →
902.4 ms; other-account contention 887.8 → 925.5 ms. Targets unmet. See that report
for all ranges, gaps, memory and methodology limits; no answered/diverse claim.

The next entry reruns approved `47a54e6` using the common v2 harness before
comparing compact events. It must not imply a comparison across incompatible
fixtures. Detailed design/recovery boundaries: [persisted evidence report](study-evidence-performance.md).

## 2026-10-27 — compact validated events, workload v2

[Full results, all normal HTTP observations and remaining slow paths](study-evidence-performance.md#comparable-series--2026-10-27).
Approved base `47a54e647c93ec0e0669d073ef3cb256baf07cbf` versus measured
`0c10eb1e4e48903d4b152b0f356e7eb1e0b73ecf`; common
`study-history-v2-answered` harness, three fresh-fixture sequential repetitions per
revision/profile (18 total). Same Node 24.22.1 / i5-8265U / eight logical CPUs;
shared host, warm setup/OS cache, no CPU pinning or production authentication.
Exact load/free memory, sources, overlays and sample counts are in the report.

History HTTP medians: quiz-start 958.5 → 198.4 ms; due 926.9 → 171.4 ms.
Answered/diverse: quiz-start 3232.8 → 182.2 ms; due 3250.7 → 161.5 ms.
All 12 large-history normal samples were below 300 ms; 11 below 200 ms, max 218.1.
The target remains 300/preferred 200; it was not relaxed. Diverse was added because
empty answers missed answered replay/ICU costs and nonempty due obligations.

Pooled other-account HTTP p95/max: history 310.9/332.8 ms; diverse 341.4/358.3 ms.
Contention still misses 300 ms. Full rebuilds reached 2301.3 ms; provenance
annotation regressed and still blocks the shared loop. Normal completion write
cost, all first-use/restart/schema/rebuild/write observations, gaps and sampled
memory are reported separately. Aggregate JSON parsing is a lower-bound design
comparison, not an implemented equivalent cache. Keep issue #81 open; parent
review and CI/readiness remain pending. No scheduler or telemetry platform added.

## 2026-10-27 — correct the provenance extraction regression

Historical measured `9370c33` / documentation `ce8b092` series. The round2
concurrency correction below supersedes standalone safety claims; these timing
observations were not rerun as a twelve-sample current-head series.

Independent review P2 required avoiding redundant evidence extraction during
production deletion/reconciliation. The preceding regression and old 18-run
series remain historical evidence for the original PR83 head, not the correction.
[Correction design, measurements, every normal observation and limits](study-evidence-performance.md#2026-10-27--provenance-retention-correction-p2).

Before `13b83fda1f3dbc2cdc62662f553c40c55a0a412e` → measured correction
`9370c33a4e920cf9ee867580fe707d280cca329f`. Three fresh-fixture repetitions per
revision/profile, common unchanged `study-history-v2-answered` history/diverse
harness (12 runs; small not repeated), before history/diverse then correction
history/diverse. Same Node 24.22.1 / Linux 7.0.0-38 / i5-8265U / eight CPUs /
31.1 GiB RAM; shared host, warm setup/OS cache, no CPU pinning, no production
auth/network. Report and retained metadata include per-series load/free memory,
UTC timestamps, exact source/harness manifests/patches and raw samples.

HTTP milliseconds median (range), three samples per cell:

| Profile / operation                    |               Before |          Correction |
| -------------------------------------- | -------------------: | ------------------: |
| history quiz-start                     |  166.9 (157.2–170.5) | 177.1 (172.1–182.7) |
| history due-read                       |  160.0 (158.8–160.0) | 175.8 (159.6–179.0) |
| history foreground-reconcile-backlog   |  786.9 (784.1–856.4) | 444.5 (418.7–457.9) |
| history private-delete-with-annotation |  809.2 (729.4–842.7) | 402.1 (377.6–454.7) |
| diverse quiz-start                     |  187.1 (179.3–231.5) | 182.3 (171.0–187.4) |
| diverse due-read                       |  169.8 (158.7–246.0) | 178.3 (168.2–195.5) |
| diverse foreground-reconcile-backlog   | 881.7 (874.4–1089.3) | 469.4 (432.1–484.9) |
| diverse private-delete-with-annotation | 855.8 (820.4–1039.1) | 427.1 (411.0–442.5) |

Corrected normal target: 12/12 under 300 ms,
12/12 under preferred 200 ms, maximum 195.5 ms.
No target or timing-CI policy change. The dedicated three-pair
`annotation-v2-retained-bank-eager-repair` probe has 2,000 valid confident attempts /
40,000 snapshots referring to the deleted bank plus a surviving identical-content
1,000-question bank, explicitly added to permit measuring the next quiz/due calls.
It is compared only against its own before-source run. Deletion service median
1573.0 → 682.7 ms; other-account HTTP 1587.6 → 683.1 ms. All 6,000 retained
projection rows were byte-identical; next due/start succeeded with evidence INSERTs
prohibited (corrected HTTP maxima 169.9/225.2 ms). No deferred full rebuild.
This removes extraction work; annotation still blocks for hundreds of milliseconds.

The unchanged single-bank reviewer shape was also rerun in three pairs:
deletion service median 1460.9 → 678.0 ms; other-account HTTP 1460.4 → 679.9 ms;
all 6,000 projection comparisons were byte-identical. See the report for ranges.

The report includes current service/gaps/RSS, actor distributions, write cost and
first-use/reopen/rebuild/startup results. Historical 358.3 ms contention,
2301.3 ms rebuild and 5475.7 ms startup observations remain historical limits.
Issue #81 stays open for contention/first-use and remaining unbounded work; fresh
independent review/CI/readiness remain with the parent, PR83 stays draft.
`npm run check` passed all 354 tests, formatting, lint, native TypeScript and build;
red/green work evidence, focused 22 tests, manifest/sample audits, diff checks and
redacted installed Gitleaks scans are retained. Sources/logs:
`/tmp/pr83-correction` and `/tmp/study-performance-p4lzv7uq`, 0700/0600.
Original evidence is unchanged. GPT-6.1 Sol medium; no agents/watchers/installations.

## 2026-10-27 — protect standalone provenance annotation (round2 P2)

The round2 race at `ce8b092` committed new scoring between snapshot SELECT and
projection capture, then retained new evidence while rewriting the old snapshot.
Annotation now owns `BEGIN IMMEDIATE` before reading, or a savepoint inside any
existing SQLite transaction (including QuizRepository-owned outer transactions).
Real second-process test: baseline commits and survives restart with 19 due versus
20 authoritative; correction returns BUSY, gives 20/20 after restart, then permits
a successful retry with 19/19. Multirow failures roll back the whole annotation;
existing-lock failure, generic callbacks, nested/outer rollback, eager repair and
raw-writer invalidation remain covered. PR83 stays draft for parent fresh review/CI.

[Exact sources, all observations, methodology and limits](study-evidence-performance.md#2026-10-27--protect-standalone-annotation-against-concurrent-writers-round2-p2).
Baseline `ce8b092` versus that commit plus retained runtime.patch; four sequential
common runs, one repetition per revision/history/diverse profile, same unchanged
v2 harness on Node 24.22.1 / Linux 7.0.0-38 / i5-8265U / shared host. Corrected
normal start/due HTTP: history **168.2/159.3 ms**, diverse **213.9/163.3 ms**.
4/4 below 300 ms, 3/4 below 200 ms; baseline diverse start 209.9 ms. One sample per
operation is a budget check, not a distribution or speedup claim. Previous 12/12
below 200 ms is explicitly historical at `9370c33` / runtime-equivalent `ce8b092`.

Corrected annotation HTTP 392.6/453.2 ms, backlog 437.0/453.3 ms and other-account
contention maxima 290.2/296.7 ms (history/diverse). First-use 1046.6/971.9 ms,
version rebuild 1034.4/1125.3 ms, startup 2404.5/2424.4 ms; baseline diverse
startup outlier 21585.9 ms remains visible in the report. Older 314.9 contention,
1147.4 rebuild, 4101.1 startup and 1088.4 first-use limits stay pinned historical.
Two retained-bank probe pairs, opposite order, had deletion service base→head
1352.4→1941.1 and 683.7→704.4 ms; other HTTP 1382.6→1945.9 and 683.5→712.1 ms.
All 4,000 corrected rows stayed byte-identical and next due/start passed with
INSERTs forbidden. No deferred rebuild or annotation speedup claim. Shared-host
variation and only two pairs cannot isolate transaction overhead. Issue #81 remains
open for blocking work, recovery costs and unbounded production-scale behavior.
Sources/patches/manifests/raw logs and final checks: `/tmp/pr83-race-correction`,
0700/0600. Full report includes service/gap/RSS, write cost and exact methodology.
GPT-6.1 Sol medium; parent owns fresh review, CI and readiness; no approval claimed.

Final runtime `npm run check` passed formatting, ESLint, **356/356 tests**, native
TypeScript and Vite build; focused affected suite **37/37** passed. Deterministic
real-writer red/green and final standalone/outer replay controls passed with the
expected rejection before write, restart equivalence and post-release retry.
Source reconstruction/common-harness audit, final diff checks and redacted staged
Gitleaks passed. Independent review/CI remain pending with the parent; this is
local verification, not PR readiness. The measured-source to publication-source
code delta is one linter-required blank line, retained in `publication-format.patch`.
