# Nest conversion plan

## Scope and ownership

Start from `origin/master` at `fcf980bcc1f45e61a251cd3584fadb200e62a023`.
The overseer owns `t3/nest-conversion`; implementation agents own isolated task
branches targeting that integration branch. Reviewed task commits may be merged
into the integration branch. The final PR targets `master` and requires the
maintainer's merge decision.

Nest will own HTTP routing, dependency wiring, guards, request validation, error
translation, and application lifecycle. Keep explicit SQLite SQL, schemas,
repositories, domain services, DTOs, and the React application. Preserve existing
API behavior, account isolation, OIDC identity/session behavior, and saved history.
ORM adoption, database replacement, identity-provider changes, new product
features, and unrelated readability work are outside this conversion.

## Implementation stages

Each stage must build and pass its relevant checks before publication. Intermediate
work remains draft and is not described as a completed conversion. A temporary
legacy boundary may support an intermediate commit, but the final production
application must use feature controllers and guards rather than dispatching every
request through the old router.

### 1. Establish the compiled server and Nest foundation

- Verify current Nest/Express compatibility with supported Node 24 and the existing
  ESM project. Prefer the existing TypeScript compiler for decorator-capable emit
  before adding another compiler or a CLI scaffold.
- Define a server output directory and relative import rewriting. Keep native
  TypeScript type checking, the Node test runner, frontend Vite output, and CLI
  commands working. Decorated code must execute through a supported compilation
  path in tests and runtime.
- Add the smallest Nest module/application boundary and a real HTTP bootstrap
  test that proves decorators, dependency injection, and application closure.
  Do not switch production requests to a partial route set.
- Update scripts and Docker packaging for compiled server execution, including
  production-only dependencies and runtime schema assets. Verify development
  watch/restart and existing frontend serving.

Gate: full existing suite plus compiled-runtime/Nest smoke tests; independent
review of the actual diff. Record remaining wiring as incomplete.

### 2. Give application resources explicit Nest ownership

- Wire configuration, accounts/authentication, shared library, preview registry,
  private-library factory, and housekeeping through providers with clear owners.
- Preserve initialization order: migration and startup recovery finish before
  listening. Initialization or listen failure closes every acquired resource.
- Keep each private connection alive through request body reads, asynchronous
  work, failures, and cancellation. Observe mutation timing before closing it;
  dispose exactly once without closing shared roots.
- Preserve housekeeping scheduling/drain, Vite HMR sockets, HTTP shutdown, and
  final shared/account database closure. Test partial initialization and shutdown.

Gate: lifecycle, private-store, and concurrent-request tests, with no schema or
transaction changes. Agree concrete provider/controller interfaces before
parallel feature work starts.

### 3. Move authentication and security to Nest boundaries

- Keep OIDC protocol logic and account/session persistence. Expose workflows to
  auth controllers and bind verified actors through guards.
- Preserve host/origin policy, callback navigation, cookies, session expiration,
  workspace-change rejection, role checks, public health/session routes, and
  private account selection. Client input never selects another account.
- Explicitly handle parser ordering: an unauthorized shared mutation must be
  rejected before consuming its body or import ticket. Framework defaults must
  not turn these denials into parser errors or body buffering.
- Preserve normalized URL admission before routing, query semantics, security
  headers, status codes, and sanitized error bodies. Install an exception filter
  covering both expected domain failures and unexpected errors.

Gate: real Nest HTTP tests for public/authenticated/admin/student cases, malicious
URLs/origins, stale workspaces, malformed bodies, OIDC callback failures, and
failure cleanup. Retain meaningful assertions from the existing tests.

### 4. Convert feature routes and remove the legacy dispatcher

- Use focused controllers for library/import/concepts and quiz/home/reports.
  Controllers translate HTTP input and invoke existing services.
- Preserve unprefixed, shared, and private path behavior, import preview/confirm
  ownership and revision checks, body limits/media types, and answer-key privacy.
- Verify unknown API routes, unsupported methods/HEAD, redirects, duplicate query
  parameters, and static/SPA behavior against the baseline. Do not accept extra
  route forms accidentally through framework defaults.
- Move HTTP fixtures and the performance harness onto the actual Nest request
  stack. Remove obsolete dispatch code after its callers and tests are migrated;
  keep tests at domain/repository boundaries where those remain appropriate.
- Update architecture, toolchain, and operator instructions to describe the final
  build and lifecycle. Keep development Vite and production static delivery.

Gate: full checks, disposable OIDC and Docker smoke tests, production/development
entry-point probes, and independent review. Compare equivalent synthetic history
and answered/diverse workloads with the pinned baseline; record methodology,
samples, startup/rebuild/write costs, contention, event-loop delay, and memory in
the performance ledger. Issue #81 remains open for known residual stalls.

## Agent allocation and evidence

- Luna: bounded read-only route/test inventories and focused documentation work.
- Sol medium: implementation of a cohesive stage or agreed controller group.
- Sol high: independent review of material changes and corrections; the overseer
  retains integration and readiness decisions.

Parallel implementation is useful only after shared interfaces are committed and
file ownership is explicit. Avoid concurrent edits to bootstrap, authentication,
package/lock files, and common test helpers. Review each final SHA; blockers need
correction and fresh independent review. Passing tests alone do not satisfy review.

Use the required readability, TDD, diagnosis, and verification workflows. Preserve
red/green evidence and raw logs in restricted local storage, publish sanitized
results, and run the installed secret scanner before publication. Do not weaken
tests, bypass hooks, install global tools, use signing keys, or create cloud costs.

Use disposable data and ephemeral loopback ports. The main checkout, its `.env`,
personal databases, attachments, existing containers/volumes, and live ports
3000/8080 remain outside this work. Existing task archives contain private data and
must not be published. No deployment or merge into `master` is authorized here.
