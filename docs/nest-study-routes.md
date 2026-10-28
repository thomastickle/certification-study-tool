# Focused study HTTP module

Compose with `createApplication(config, [StudyHttpModule])`, importing
`StudyHttpModule` from `src/server/study-http/study.module.ts`. The module
borrows the globally configured runtime and request-owned study context; it
does not register another runtime or close storage. Production now composes both feature modules through `createProductionApplication`.
Legacy HTTP tests and the old benchmark still await migration.

Explicit routes cover home, earned settings, reports, quiz recent/current/due/
deleted/start/read/answers/submit/pause/resume/abandon/restore/delete. No visibility
prefix aliases are introduced. Dynamic route guards validate the admitted,
still-encoded pathname against the legacy permissive 36-character lowercase
hex/hyphen pattern before parameters or bodies. Global authentication/workspace
policy runs first. Services retain DTO validation and all domain behavior.
Earned settings use a custom owned input to preserve expiry before body parsing.
Nullable current/abandon/delete results explicitly serialize JSON null, since Nest
otherwise emits an empty response.

## Retained and migrated tests

All legacy tests remain unchanged pending the next HTTP-test migration task;
production already uses Nest.

| Existing coverage                                        | New compiled Nest coverage in study-http.spec.ts                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| home-http.test.ts                                        | earned validation, readiness independence, actor isolation and restart persistence                                                                    |
| quiz-deletion-http.test.ts                               | soft-delete privacy/48-hour window, lists, restore, permanent option, foreign actor denials, purge                                                    |
| pause-history-http.test.ts                               | quiz/exam overdue paused snapshots, saved flags, no report grading, repeat pause/history and resume deadline                                          |
| application-authentication.test.ts study isolation cases | two real OIDC actors, colliding private/shared content, foreign read/answer/submit/restore, current/report/deleted/earned isolation                   |
| dispatcher URL/body contracts                            | malformed/encoded IDs before body, first query values, HEAD/OPTIONS/unknown methods, aliases, media/object validation, workspace/auth/origin ordering |

The owned fixture starts/listens sequentially, seeds synthetic content via existing
repository/ImportService seams, and closes only its app/issuer/temp directory.
Nullable deletion regressions assert literal JSON null, JSON/cache/security headers,
foreign-actor storage preservation and successful permanent removal. Irrelevant
malformed DELETE bodies remain unread.

Broad history/performance and complete expiry timing suites remain at their existing
domain/legacy seams for the parent's final migration. Shared security tests retain
their existing body size/cancellation and lifecycle coverage. Docker/Keycloak
packaging is unchanged; no fresh Docker or live Keycloak run is claimed here.
Independent review, CI monitoring and integration belong to the parent.

## Legacy test migration follow-up

The non-benchmark legacy suites described above have now moved to compiled Nest
HTTP fixtures, preserving their full assertions; native pure domain/helper cases
remain native. Obsolete transport/request-handler/authentication adapters are
removed. Earlier stage descriptions of retained legacy tests are historical.
See [the complete assertion mapping](nest-http-test-migration.md). The old
benchmark still retains the API/concept dispatcher until sibling integration;
this change makes no performance or final-review claim.
