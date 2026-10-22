# Compiler experiment — 2026-10-22

The unchanged project passes TypeScript 5.9.3 but fails both native compilers on four CSS
side-effect imports. **This experiment does not establish a successful-build speedup.**
Default `typecheck`, `build`, project configuration, source, and root dependency lock remain unchanged.
The experiment starts from `31d0015ccdc8cb22962f7600c711a542e4552358`; it does not include PR38 UI cleanup.

## Results

Wall-clock seconds, one warmup and five measured samples per available case:

| Case                             | Median |     Min–max | Outcome                                   |
| -------------------------------- | -----: | ----------: | ----------------------------------------- |
| TS 5.9.3 no-emit check           |  5.140 | 4.993–5.609 | 5/5 pass                                  |
| TS 5.9.3 check + Vite            |  6.677 | 6.422–6.732 | 5/5 pass; identical artifacts             |
| Microsoft TS 7.0.2 no-emit check |  0.716 | 0.712–0.842 | 5/5 fail; failure latency only            |
| Microsoft TS 7.0.2 check + Vite  |      — |           — | Blocked by preflight errors; Vite not run |
| tsrs no-emit check               |  0.229 | 0.202–0.283 | 5/5 fail; failure latency only            |
| tsrs check + Vite                |      — |           — | Blocked by preflight errors; Vite not run |
| Vite 7.3.7 alone                 |  1.729 | 1.696–2.034 | 5/5 pass; identical artifacts             |

The native compilers both report TS2882 at `CertificationPicker.tsx:5`, `ReportsPage.tsx:11`,
and `main.tsx:4–5`, for `certification-picker.css`, `reports.css`, `styles.css`, and `workspace.css`.
Go exits 1; Rust exits 2. TS 5.9 exits 0 with no diagnostics. The native diagnostic text and locations
match each other; status and diagnostics do not match TS 5.9.

This is a compiler-default compatibility difference: Microsoft documents that
[`noUncheckedSideEffectImports` defaults to true starting in TS 6](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html#simple-default-changes).
As a separate, untimed diagnostic experiment, enabling that option on TS 5.9 reproduces the same four
missing-CSS declaration failures (older diagnostic code TS2307). No config or declarations were
changed to bypass them. A future migration could supply appropriate Vite asset declarations and
repeat this experiment; that is outside this unchanged-source comparison.

Each checker also rejected a temporary private `string = 123` assignment with TS2322. Native
compilers reported that additional diagnostic alongside their four existing CSS errors. Merely
returning a nonzero status was insufficient for the probe. This is a basic correctness guard,
not proof of compiler-wide semantic equivalence.

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
Failed timing cases have null successful medians in the summary; their individual latency samples
remain available. Expected experimental failures do not abort the experiment; baseline/probe failures
and artifact mismatches do. Each child command has a 120-second timeout.

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
  round to interleave order. With two blocked build cases, five remaining cases cover every measured
  starting position once. All orders and individual measurements are in the sanitized results JSON.
- Timings use Node's monotonic `performance.now()` around synchronous child processes. End-to-end
  timing includes check and subsequent unchanged `vite build`, launching the bundler only if checking
  succeeds. It excludes npm command-wrapper overhead, artifact hashing, and log writing. Vite alone
  uses the same command/configuration. “Build/assembly” here means Vite frontend asset generation;
  TypeScript emits nothing and the server runs TypeScript directly.
- SHA-256 manifests include every emitted file and relative path. All ten successful measured builds
  (five TS 5.9 + Vite, five Vite-only), plus both build warmups, match the initial Vite reference.
  No artifact-equivalence claim is possible for the blocked native pipelines.
- Linux `7.0.0-38-generic` x64, Intel Core i5-8265U @ 1.60 GHz, 8 logical CPUs / available parallelism 8,
  31.07 GiB reported RAM; Node 24.17.0, npm 11.13.0, Vite 7.3.7. Host load, CPU frequency and thermal
  behavior were not controlled. This is a small local experiment, not a general throughput claim.

[Sanitized samples, versions, config/lock hashes, order and artifact manifest](compiler-benchmark-results.json)
are committed separately from raw logs. Harness tests retain private red/green evidence for excluding
failed timings and preventing the bundler from running after a rejected check. Independent review is
pending the parent agent's review gate; this local experiment does not authorize replacing production
TypeScript.

Verification: `npm run check` passed (Prettier, ESLint, 156 tests, TS 5.9 check and Vite build).
`npm run benchmark:compilers:test` passed both harness tests, and explicit ESLint checking of the
benchmark `.mjs` files passed. Application source, tests, root lockfile, and TS/Vite configuration
were verified unchanged against the starting commit. Container builds were not run for this optional
local tooling experiment.
