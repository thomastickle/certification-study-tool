# Focused Nest library controllers (stage 4A)

Compose `createApplication(config, [LibraryHttpModule])`, importing
`LibraryHttpModule` from `src/server/library-http/library-http.module.ts`.
Await startup sequentially (R1-N1). The module borrows the one configured global
runtime and singleton ImportPreviews. It never closes or retains repositories.
Production composes this module through `createProductionApplication`. Migrated
HTTP tests and the benchmark use Nest; obsolete dispatchers are removed. No ORM
or domain changes are included.

The controller declares only sources/questions reads, imports preview/confirm,
question/source deletes, concept reads/create/update/delete and suggestion
dismissal, under `/api`, `/api/shared`, and `/api/private`. Unsupported prefixed
resources remain absent. Unprefixed sources combine both libraries with prefixed
private IDs; unprefixed questions and content mutations select shared storage.

A local LibraryRouteGuard runs after global authentication/workspace policy and
before study scope/parameters. It checks the admitted normalized raw pathname
against the legacy patterns before checking the shared admin role. This deliberately
replaces LibraryWrite metadata for this controller: global write metadata would
produce 403 for invalid paths that must be 404. Digits-only deletion paths then
receive role checks before positive-safe-integer validation; UUID and digest
patterns retain their permissive legacy lowercase shape. Encoded IDs are not
accepted through Express decoding. Implicit HEAD remains rejected by global
method policy; there are no catch-all routes or legacy dispatcher calls.

All service work completes inside StudyRequest. JSON parsing uses the existing
owned JsonObjectBody input; domain validation remains in existing services.
Concept removal and dismissal explicitly serialize JSON null, because Nest's
normal null return emits an empty body. Question/source deletions remain 204.

## Retained and migrated test mapping

`tests/compiled/library-http.spec.ts` runs real compiled Nest controllers through
`createApplication` and a synthetic OIDC issuer. Its owned fixture starts app
initialization/listening sequentially and closes app, issuer and disposable files.

| Retained legacy tests                                                      | New compiled test and assertions                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http.test.ts`: preview/confirm/browse/scoped deletion                     | `real OIDC users isolate colliding content, ticket ownership and namespace swaps`: imports, listings, search/paging first values, 204 deletions; `library aliases preserve role ordering, raw path shapes and media contracts`: malformed bodies and paging                                                    |
| `private-libraries-http.test.ts`: colliding IDs and separate banks         | `real OIDC users isolate colliding content, ticket ownership and namespace swaps`: two students, private content isolation, combined source identity, unprefixed shared questions, foreign/replayed tickets and both role-denied and admin namespace swaps                                                     |
| `library-write-authorization.test.ts`: role checks for each mutation       | `library aliases preserve role ordering, raw path shapes and media contracts` and `concept create/update/removal and dismissal retain scoped JSON null responses`: shared denials before parsing, private student imports/deletes, all concept mutations, raw numeric/UUID negatives, zero validation ordering |
| `application-authentication.test.ts`: content admission and ticket binding | `compiled library lists authenticate and expose normalized first-value queries`, plus the ownership test: actual login, anonymous denial, admin/student roles and verified actor ticket ownership                                                                                                              |
| Concept route CRUD/status behavior                                         | `concept create/update/removal and dismissal retain scoped JSON null responses`: real suggestion creation, group rename/removal, dismissal, exact JSON null and selected namespace                                                                                                                             |

The table records the focused controller coverage added before the full legacy
test migration. The original suites' complete assertion mapping is linked below.
Domain tests remain authoritative for revision,
review, expiry, broad identity and mastery behavior; stage-three compiled security
tests retain exhaustive admission/OIDC/body-size/lifetime coverage. This stage
adds content route coverage without duplicating every protocol or lifetime probe.

Local evidence lives outside Git in `/tmp/stage4a-evidence` (directory 0700,
logs 0600). Initial compiled HTTP red was authenticated questions returning 404
without the feature module; registering the module made that assertion pass.
Fixture correction: an arbitrary digest is a domain 409, not successful dismissal;
successful dismissal now uses an actual suggestion. No fresh Docker/Keycloak or
performance run is claimed; inherited foundation evidence remains with its stages.
Parent owns independent review, CI, integration and final cutover.

## Legacy test migration follow-up

The non-benchmark legacy suites described above have now moved to compiled Nest
HTTP fixtures, preserving their full assertions; native pure domain/helper cases
remain native. Obsolete transport/request-handler/authentication adapters are
removed. Earlier stage descriptions of retained legacy tests are historical.
See [the complete assertion mapping](nest-http-test-migration.md). The benchmark
also uses Nest and the API/concept dispatchers are removed. This route document
makes no performance or final-review claim.
