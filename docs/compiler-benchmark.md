# Compiler experiment — 2026-10-22

Follow-up: [resource measurements and current harness behavior](compiler-resource-benchmark.md).
The timing evidence below is retained from the earlier run.

After adding Vite's missing client declarations, all three compilers successfully check the same
project. Microsoft Go TypeScript reduces the median check + Vite pipeline by **66.1%**;
Rust tsrs reduces it by **72.8%** in this local sample. Vite itself is unchanged.
Default `typecheck` and `build` commands, root dependency lock, and compiler configuration remain
unchanged. This opt-in experiment is on a separate branch based on PR38 commit `31d0015`; it includes
that UI cleanup as its baseline and makes no changes to PR38's branch.

## Results

Wall-clock seconds, one warmup and five measured samples per case, all successful:

| Case                                | Median |      Min–max |
| ----------------------------------- | -----: | -----------: |
| TS 5.9.3 no-emit check              |  6.583 |  5.437–7.929 |
| TS 5.9.3 check + Vite               |  9.015 | 7.636–11.561 |
| Microsoft Go TS 7.0.2 no-emit check |  0.942 |  0.741–1.275 |
| Microsoft Go TS 7.0.2 check + Vite  |  3.057 |  2.669–4.047 |
| Rust tsrs no-emit check             |  0.249 |  0.225–0.319 |
| Rust tsrs check + Vite              |  2.456 |  2.098–2.640 |
| Vite 7.3.7 alone                    |  2.086 |  1.850–2.114 |

These measure this small repository on one laptop. tsrs is experimental and based on a TypeScript
7.1 development revision, while the Go package is stable 7.0.2 and the existing checker is 5.9.3.
This is a practical package comparison, not an isolated Rust-versus-Go language benchmark.
The modest absolute gap between native total builds matters more than their typecheck-only ratios:
the unchanged bundler now dominates the pipeline. Retain the production checker until a migration
is deliberately chosen; this experiment alone does not establish full diagnostic equivalence.

## Compatibility and correctness

The initial unchanged-source run passed TS 5.9 but failed both native compilers on four CSS
side-effect imports (TS2882). Their initial 0.716 s / 0.229 s check latencies were failures, not
successful-build speedups. [Initial samples](compiler-benchmark-initial-results.json) are retained.
Microsoft documents that
[`noUncheckedSideEffectImports` defaults to true starting in TS 6](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html#simple-default-changes).
Enabling that option on TS 5.9 reproduced the four missing-declaration errors (TS2307).

The experiment branch adds only `/// <reference types="vite/client" />` in `src/web/vite-env.d.ts`,
following [Vite's client type documentation](https://vite.dev/guide/features.html#client-types).
This declares assets the bundler already supports; it does not disable side-effect import checking
or change runtime behavior. The Go check was reproduced red before that addition; both native checks
then passed. The complete timed comparison was rerun with the declaration present for **all** compilers.

All three preflights now exit 0 without diagnostics. Each checker also rejects a temporary private
`string = 123` assignment specifically with TS2322. This is a basic correctness guard, not proof of
compiler-wide semantic equivalence. Every successful output manifest matches the same Vite reference.

## Official packages and exact versions

- Existing locked `typescript@5.9.3`, root `node_modules/.bin/tsc`.
- Microsoft `typescript@7.0.2`, isolated `tools/compiler-benchmark/node_modules/.bin/tsc`.
  Microsoft's [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
  identifies the Go implementation and npm `typescript`/`tsc` distribution. The
  [archived staging repository](https://github.com/microsoft/typescript-go#readme) says the command
  changed from `tsgo` to `tsc` for 7.0 RC and later. This uses the current stable release, not the old
  `@typescript/native-preview` package or the 7.1 beta.
- `tsrs@0.18.0-ts7.1.0-dev.20260929`, isolated `.bin/tsrs`. Its executable reports
  `Version 7.1.0-dev.20260930.4 (tsrs 0.18.0-ts7.1.0-dev.20260929, microsoft/TypeScript@b85298b6a81f)`.
  Cloudflare's [October 20 announcement](https://blog.cloudflare.com/typescript-rust-port) links
  [oxc-project/tsrs](https://github.com/oxc-project/tsrs) and npm `tsrs`. This is not the similarly named
  Rust-to-TypeScript binding generator `ts-rs`.

Registry metadata was checked on October 22; exact experimental versions and integrity hashes are
pinned in the separate package and lockfile. They are opt-in dependencies, never installed by root
`npm ci`, and cannot shadow the root TS 5.9 binary.

## Reproduce

From the repository root, using Node 24:

```sh
npm ci
npm ci --prefix tools/compiler-benchmark
npm run benchmark:compilers:test
node_modules/.bin/eslint tools/compiler-benchmark/*.mjs --max-warnings 0
npm run benchmark:compilers
```

Do not run concurrent benchmarks or modify project inputs during measurement. The harness invokes
absolute local binaries, never `npx` or an automatic download. Missing binaries are preflight failures.
It writes full output to a unique, ignored `private/ai-runs/compiler-benchmark-*/` directory with
restricted permissions. Inspect `preflight.json`, per-command logs, and `summary.json` locally.
Failed samples are excluded from successful medians; a median is null only when no sample succeeds.
Their individual latency samples remain available. The current resource harness aborts on any compiler
preflight/probe failure or artifact mismatch. Baseline warmup/measured failures and instrumentation
failures save the summary before failing; experimental measured checker failures remain recorded
without counting as successful timings. Each child command has a 120-second timeout. See the
[resource report](compiler-resource-benchmark.md#validation-and-failure-behavior) for current behavior.

The Vite build replaces the normal ignored `dist/` directory just as `npm run build` does. The temporary
private bad-type fixture and its extending config are removed after preflight. No application data
is used. Keep original private logs locally for the standards' 90-day retention target; review and
sanitize any results before committing them.

## Measurement boundaries

- Same repository, root `tsconfig.json`, source, tests, and root dependency tree for all compilers.
  Commands use `--project tsconfig.json --noEmit --pretty false`. Each compiler retains its own shipped
  standard library and default scheduling/options; identical config text does not equal identical
  compiler defaults. No worker-count tuning or compatibility overrides were applied.
- A fresh process per invocation, warmed filesystem cache, no watch/incremental mode, no OS cache
  flushing. These are **cold-process, warm-filesystem** measurements, not cold-cache benchmarks.
  Preflight and an artifact-reference Vite build precede the warmup.
- One warmup round, then five rounds, executing cases sequentially. The starting case rotates each
  round to interleave order. All seven cases run in each round; five measured rounds do not cover every possible starting position. All orders and individual measurements are in the sanitized results JSON.
- Timings use Node's monotonic `performance.now()` around synchronous child processes. End-to-end
  timing includes check and subsequent unchanged `vite build`, launching the bundler only if checking
  succeeds. It excludes npm command-wrapper overhead, artifact hashing, and log writing. Vite alone
  uses the same command/configuration. “Build/assembly” here means Vite frontend asset generation;
  TypeScript emits nothing and the server runs TypeScript directly.
- SHA-256 manifests include every emitted file and relative path. All twenty successful measured builds
  (five per checker + Vite, five Vite-only), plus build warmups, match the initial Vite reference.
- Linux `7.0.0-38-generic` x64, Intel Core i5-8265U @ 1.60 GHz, 8 logical CPUs / available parallelism 8,
  31.07 GiB reported RAM; Node 24.17.0, npm 11.13.0, Vite 7.3.7. Host load, CPU frequency and thermal
  behavior were not controlled. This is a small local experiment, not a general throughput claim.

[Sanitized samples, versions, config/lock hashes, order and artifact manifest](compiler-benchmark-results.json)
are committed separately from raw logs. Harness tests retain private red/green evidence for excluding
failed timings and preventing the bundler from running after a rejected check. Independent review approved the timing comparison; this local experiment does not authorize
replacing production TypeScript.

Verification: `npm run check` passed (Prettier, ESLint, 156 tests, TS 5.9 check and Vite build).
`npm run benchmark:compilers:test` passed both harness tests, and explicit ESLint checking of the
benchmark `.mjs` files passed. Runtime application source, tests, root lockfile, and TS/Vite configuration
remain unchanged against the starting commit; the only application typing addition is `src/web/vite-env.d.ts`. Container builds were not run for this optional
local tooling experiment.
