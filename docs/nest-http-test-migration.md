# HTTP test migration

Production routing remains unchanged. The legacy HTTP test migration is implemented;
final verification and parent review remain separate gates. These migrations
replace fixed-actor dispatcher fixtures with compiled Nest controllers and actual
synthetic OIDC sessions. The compatibility fixture seeds shared content through
the runtime shared repository and study evidence through the real account's
personal storage. It does not install bypass guards or a dispatcher.

## Assertion mapping

All cases and assertions in these files are retained in their compiled replacement.
Only imports, fixture setup, seeding ownership, requests and disposal change.

| Original                                    | Maintained compiled replacement                      | Preserved contracts                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/http.test.ts`                        | `tests/compiled/http.spec.ts`                        | Preview/confirm, source/question browse and deletion, cross-site denial, malformed bodies, quiz/exam confidence, score, key privacy, pause/resume/history/abandon |
| `tests/home-http.test.ts`                   | `tests/compiled/home-http.spec.ts`                   | Earned validation, readiness independence, revision stability, idempotence, source deletion and persisted earned-only state across full application restart       |
| `tests/pause-history-http.test.ts`          | `tests/compiled/pause-history-http.spec.ts`          | Overdue paused snapshots, saved answers, empty report sections/export, pause history/cause validation, resume deadline/idempotence, eventual grading and mastery  |
| `tests/quiz-deletion-http.test.ts`          | `tests/compiled/quiz-deletion-http.spec.ts`          | Cross-site denials, soft deletion privacy/retention, filtered lists, restore, permanent option validation/removal and report exclusion                            |
| `tests/reports.test.ts`                     | `tests/compiled/reports.spec.ts`                     | All seven original HTTP/domain/export cases, including weighted outcomes, skipped questions, historical grouping, filters, expiry and source deletion             |
| `tests/private-libraries-http.test.ts`      | `tests/compiled/private-libraries-http.spec.ts`      | Both original cases: colliding IDs, actor isolation, private student mutation, namespace and foreign-ticket denials without consuming the rightful ticket         |
| `tests/library-write-authorization.test.ts` | `tests/compiled/library-write-authorization.spec.ts` | Entire 49-case matrix: roles, namespace aliases, every mutation, forged identity/payload fields and unknown-write behavior                                        |

The request helper supplies the real session cookie, workspace binding and browser
Origin. Explicit hostile Origin and forged role/account headers remain unchanged.
No assertion was removed as a duplicate. Report domain/export cases currently run
compiled alongside their migrated HTTP cases.

## Completed remaining families

The remaining migration is now implemented. No product route, authorization policy, database,
service, scheduler, benchmark or build configuration was changed.

| Original                                                            | Maintained coverage                                                       | Assertion/ownership mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `application-authentication.test.ts`                                | `compiled/application-authentication.spec.ts`                             | All 16 cases and assertions retained: actual OIDC identities/roles, import ticket binding/replay, role replacement, forged browser input, root issuer, persisted personal storage, restart/expiry/issuer change, logout/session replacement, callback expiry/browser binding/navigation/replay, 1001 sequential login attempts, no study provisioning by the auth core, workspace rejection, sanitized provider failures and normalized raw targets. Production composition uses an owned static HTML root. Admission observation wraps the actual admit method and perturbs the raw target before the Nest adapter restores its frozen context. |
| `login-capacity.test.ts`                                            | `compiled/login-capacity.spec.ts`                                         | Real Nest HTTP sends 1001 concurrent logins. A controlled external-provider begin gate proves 1000 reserved operations, exactly one 429 before release, then exactly 1000 redirects. An added count asserts the denied request never starts provider work.                                                                                                                                                                                                                                                                                                                                                                                       |
| HTTP test in `certification-scoping.test.ts`                        | `compiled/certification-scoping-http.spec.ts`                             | Complete original HTTP assertions retained, including full provider/certification pair, current/recent/due/report isolation, historical evidence and invalid filters. Native domain cases remain native. Shared content is seeded on the shared root; evidence uses the real account's personal scope.                                                                                                                                                                                                                                                                                                                                           |
| HTTP test in `concept-integration.test.ts`                          | `compiled/concept-integration-http.spec.ts`                               | Complete original HTTP assertions retained: mutation Origin gates, stale-save atomicity, rename/create/dismiss/delete and final group state. Native domain cases remain native. Setup stores attempt keys in the actual account scope.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `request-handler.test.ts`: authentication failure                   | `compiled/request-failures.spec.ts`: Nest authentication failure          | Injected actual admission failure returns exact generic sanitized JSON, 500/no-store and subsequent healthy HTTP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `request-handler.test.ts`: study failure                            | `compiled/request-failures.spec.ts`: Nest study failure                   | Actual decorated async controller failure returns 500/no-store and subsequent healthy HTTP. Uses the already-reviewed Nest study error envelope (`The local operation failed. No partial import was saved.`), also asserted by `security.spec.ts`, rather than the removed outer dispatcher's generic envelope. Sensitive detail is excluded by exact object equality.                                                                                                                                                                                                                                                                           |
| `request-handler.test.ts`: controller construction                  | `compiled/request-failures.spec.ts`: Nest controller construction failure | Actual request-scoped Nest provider construction throws before controller execution. Exact generic sanitized JSON, 500/no-store and subsequent healthy HTTP are retained. The separate `security.spec.ts` startup-DI failure test additionally covers failed application construction and root disposal.                                                                                                                                                                                                                                                                                                                                         |
| `request-handler.test.ts`: web failure, partial and ended responses | `compiled/request-failures.spec.ts`: web/partial/ended                    | All original status, exact generic JSON, no-store, terminated partial body, unchanged completed body and later healthy-request assertions retained through actual Nest admission and PublicWeb lifetime. A test-owned PublicWeb handler avoids external Vite allocation; no dispatcher is installed.                                                                                                                                                                                                                                                                                                                                             |
| `web-handler.test.ts`                                               | Same native static cases                                                  | Static assertions are retained. The obsolete development middleware rewrite seam is replaced by raw shared admission plus real public process/source tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `compiled/transport.spec.ts`                                        | Same compiled file                                                        | Deferred body/disconnect, private storage retained until observation, exactly-once observation, disposal and roots-last assertions retained. Actual OIDC sessions select personal storage. Listen/static failures now reject through production factory cleanup.                                                                                                                                                                                                                                                                                                                                                                                 |

Removed `src/server/legacy-transport.ts`, `src/server/request-handler.ts`,
`tests/support/api-test-handler.ts`, and authentication's obsolete `handle`,
`authorizeStudyRequest`, `authRoute`, result union and JSON helper. Useful
admission/session/workflow methods remain. Pure request-url/local-request/routed
handler modules remain. After integration of the separately reviewed authenticated
Nest benchmark, no executable old dispatcher callers remain. The unused
`http-controller.ts` and `concepts/concept-routes.ts` are removed. Negative source
assertions mentioning dispatcher names are retained. The inert legacy benchmark
fixture is used only with archived pre-Nest sources, as described in
`nest-benchmark-migration.md`.

Validation evidence is private in `/tmp/nest-test-migration-evidence` (0700/0600).
The first mixed-concept run exposed a fixture error: attempt keys were read from
the shared root instead of the actual personal study scope. The corrected fixture
reads the real scope; no production code or assertion was weakened. The failed
fixture process was stopped and its observed owned temporary roots removed.
Full-check and independent-review results must be taken from the final handoff;
this document makes no CI, performance or readiness claim.

## Stock Vite process replacement

The former graph lifecycle/reload/activation/watcher-disposal suites are superseded
by real child/process tests; their arbitrary in-process Vite/environment handles
are deliberately retired. See the detailed [assertion migration](development-process.md#assertion-migration).
Storage/security/domain assertions remain unchanged. Native compiled-main tests
retain SQLite roots-last, startup diagnostics, failure status and repeated-signal
checks; watcher acquisition plus process-group disappearance replaces internal
watcher metadata after child termination. Early startup no longer forwards main's
stdin into Vite: cancellation owns the pending child rather than releasing a remote
graph gate. No valid resource assertion is replaced solely by `close()` resolution.

## Native adapter deletion assertion map

The joined-input decorators were conversion-only test extensions with no product
callers. Native Nest resolves parameters concurrently and its fail-fast aggregate
does **not** join resource-using sibling factories/pipes. Such I/O must be returned
and awaited in controllers, services or route interceptors; coercion and validation
remain ordinary native parameter/DI/class/global pipe work.

- Former `input-factory` / `input-pipe` resource and original-400 probes now await
  business work in the controller. Their suspended-work, late SQLite read,
  shutdown lease, original status/envelope/header and storage-close assertions remain.
  These no longer assert sibling parameter ownership.
  Entry is observed once at the actual controller boundary; completion remains
  zero while work is suspended and becomes one only after both business branches settle.
- The partial-body probe injects cancellation before the real guarded reader,
  rather than using a sibling parameter failure. The same 15-second deadline,
  original 400 delivery, readable-listener cleanup before housekeeping, and root
  closure assertions remain. Existing product partial-body shutdown and malformed,
  oversized and media-error tests cover the real cancellation/error sources.
- Successful resource-input probes now use awaited controller I/O, retaining
  successful/disconnected late reads and close assertions. Cooperative sibling
  cancellation is retired; manual-response lifetime tests and guard-disconnect
  probes cover cooperative cancellation in awaited operations.
- Body/method/class-pipe rejection probes now positively accept native metadata.
  Global-pipe restriction assertions become pre-init global and injected APP_PIPE
  transformations over actual Body/Param HTTP inputs, with per-type execution checks.
  Ordered asynchronous local pipes, emitted data/types and inherited concrete
  metadata still compare with an independent native Nest composition.
- Public proxy identity/fluent assertions now include exact identity with the
  object returned by NestFactory. Startup failure/port collision/start-close probes
  exercise ApplicationOwner explicitly. Direct native init/listen callers must
  own cleanup; the factory only owns acquisition and post-create setup failure.
- Post-create cleanup still injects at real transport attachment/admission seams.
  Completed manual response versus premature disconnect, deep OIDC/security,
  housekeeping and real product business/storage assertions remain supported.
