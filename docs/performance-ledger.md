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
