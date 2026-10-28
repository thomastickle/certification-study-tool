# HTTP test migration

This branch is incomplete. Production routing remains unchanged. These migrations
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
| `tests/compiled/vite-reload.spec.ts`        | Same file                                            | All gates/assertions retained; production factory now owns actual HTTP/HMR replacement, failure recovery, graph drain and roots                                   |
| `tests/compiled/vite-activation.spec.ts`    | Same file                                            | All gates/assertions retained; production factory now owns activation ordering, parallel failure, shutdown and recovery                                           |

The request helper supplies the real session cookie, workspace binding and browser
Origin. Explicit hostile Origin and forged role/account headers remain unchanged.
No assertion was removed as a duplicate. Report domain/export cases currently run
compiled alongside their migrated HTTP cases.

## Remaining work

Authentication and its full OIDC/security matrix, mixed certification/concept HTTP
sections, request-handler/web-handler tests, transport deferred-body/failure cases,
and Vite partial-initialization/watcher-disposal tests still need migration.
Consequently `legacy-transport.ts`, `request-handler.ts`,
`ApplicationAuthentication.handle` and `tests/support/api-test-handler.ts` remain
required by unmigrated tests. Do not remove them on the evidence of this partial
migration. The benchmark dispatcher dependency is outside this branch's ownership.

No benchmark, Docker/Keycloak, timing comparison, CI or independent review result
is claimed here. Parent review/integration is required before readiness.
