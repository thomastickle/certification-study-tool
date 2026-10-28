# Stage three HTTP boundary and controller handoff

Production uses `main.ts` → `createProductionApplication(config)` → one configured
Nest application with both feature modules and public static/development serving.
The core `createApplication(config, featureModules)` remains useful for focused
integration/lifetime tests. Neither factory mounts a legacy API bridge.

Legacy HTTP/transport tests now use real Nest or maintained pure helpers, and the
obsolete transport/authentication and API/concept dispatchers are removed. See
`nest-http-test-migration.md` for the assertion mapping. The foreground benchmark
also uses authenticated Nest controllers; `nest-benchmark-migration.md` records
its boundaries and pinned legacy adapter. Historical results remain historical.
The [pinned comparison](nest-performance.md) records new measurements. Final
integrated review remains; #81 stays open.

## Composition and admission

Always create HTTP with `createApplication`; directly creating `ApplicationModule`
with `NestFactory` omits pre-routing admission and transport ownership. The factory
registers `RuntimeModule` once. Its configured exports are global to feature
modules, so they inject `ApplicationAuthentication`, `StudyLibraryScope`,
`ImportPreviews`, `PrivateLibraries`, `StudyHousekeeping`,
`SHARED_LIBRARY_REPOSITORY` and `RUNTIME_CONFIGURATION` without another
`RuntimeModule.register`. All aliases borrow one `ApplicationRuntime`; none closes
its roots. `RuntimeStartup` retains acquisition only until Nest can own shutdown,
including when a feature provider fails during construction. A failed startup
refuses delayed acquisition from another still-resolving provider.

The owned Node request listener calls admission before Express (Express can skip
all middleware for malformed absolute targets). Admission calls
`ApplicationAuthentication.admit` once against the original
request target, Host and origin headers. Its frozen `RequestUrl` contains WHATWG
normalized pathname/search. Only afterwards does admission rewrite `request.url`
for Express selection. Use `@NormalizedUrl()` for path consumers and
`@NormalizedQuery()` for a fresh `URLSearchParams` (`get` returns the first duplicate
value). Do not use Express `@Query`, mutate the admitted target, or parse the raw
request URL a second time. Path-specific ID validation stays with each controller
and existing domain parser; constrain accepted IDs/route forms to the legacy
contract. Malformed encoded Express parameters become route misses, through the
same auth/workspace ordering as other unknown API paths.

Express is configured **before its lazy router is created**: case-sensitive,
strict trailing slashes, trust proxy disabled. Original Host/authority validation
never trusts forwarding headers. `bodyParser: false` stays enabled. No automatic
JSON parser, CORS/OPTIONS handler, catch-all API controller or global prefix is installed.
The production composition serves public paths outside `/api/` and `/auth/` through
owned public middleware, including bare `/api` and `/auth` as in the baseline. Nest's terminal not-found filter runs after all controllers;
it invokes the same guard policy before returning API JSON 404. Thus adding later
feature modules cannot be shadowed by a security catch-all route.

`SecurityGuard` is the first global guard. It verifies workspace binding using
only admission's durable verified session; `X-Study-Account` is a consistency
check, never an account selector. Unknown API methods/paths authenticate first.
`@PublicMethod('GET' | 'POST')` is handler-only metadata, honored only when both
Nest's declared method and the actual request method match. It is used for GET
health/session/login/callback and POST logout. Implicit HEAD cannot inherit public
GET access or execute a GET handler. Unsupported authenticated API methods return
JSON 404; anonymous ones return 401. Public GET navigation retains the legacy
cross-site exception for callback and non-API/non-auth paths, but this partial app
has no shell route. Foreign Origin/Host remain denied.

Auth controllers invoke `startLogin`, `completeLogin` and `logout` directly. These
are the original workflows, including pending-capacity reservation, PKCE/nonce,
browser binding, single-use callback, cookies, issuer/session checks, role fixation
and revocation. The obsolete `handle` adapter is removed; Nest calls the maintained workflows directly.

## Study controllers

Each study controller uses `@StudyRequest()`. Guards authenticate and validate the
original target before the scope interceptor acquires the verified actor's personal
library. The scope encloses route interceptors, Nest parameter resolution, awaited
controller work, error handling and disconnect cleanup. Storage is observed and
closed only after that work settles; feature code never closes the shared root.

Product routes use ordinary Nest body parameters after one guarded parser:

```ts
@Controller('api/quizzes')
@StudyRequest()
export class QuizController {
  @Post()
  @ReadJsonBody()
  start(@Body() input: Record<string, unknown>, @StudyContext() context: StudyRequestContext) {
    return new QuizService(context.study).start(input)
  }
}
```

`ReadJsonBody` awaits the object-only, case-sensitive application/json parser inside
the personal scope, before Nest resolves parameters or pipes. It retains the 10 MiB
limit and existing 400/413/415 messages. Only pause uses `ReadJsonBody(true)` for the
empty-body exception. Body-free routes do not read input. Earned settings run
`ExpireEarnedInterceptor` before the body interceptor, including for invalid input.
Normal validation pipes and `@Body`, `@Param`, and `@Query` are supported. Use the
normalized query helper when first-value semantics matter; validate original raw
paths before accepting decoded IDs. Validation pipes must remain validation-only:
resource I/O belongs in an awaited service/controller workflow, not parallel pipes.
Nest BadRequestException validation failures use the existing study error envelope.

`context.study` combines shared content and actor-owned history. `context.personal`
is the owned private repository; `context.shared` is borrowed; `context.content()`
composes the selected verified view. Pure domain services are composed explicitly
from these views, without request-scoped domain providers or a service locator.

### Optional asynchronous-input compatibility adapter

Only endpoints explicitly marked `@JoinedStudyInputs()` use
`security/study-input-registration.ts`. This is a compatibility adapter for custom
parameter factories that perform asynchronous resource I/O. It is not the default
endpoint pattern. The adversarial probes in `compiled/security.spec.ts` opt in
explicitly and retain all sibling-failure, inherited metadata, cancellation and
storage-lifetime assertions. Run these tests on every Nest upgrade.

Nest resolves parameters concurrently and can reject before an unfinished sibling
factory/pipe releases its resources. The adapter registers those operations with
StudyInputWork and joins them before closing storage. Such inputs must await all
work and honor cancellation where possible; detached work is unsupported. Within
this opt-in boundary only parameter-local pipe instances are supported. Class,
method, global pipes and schemas are rejected rather than pretending to own them.
Applications containing joined-input endpoints retain the global-pipe restriction;
ordinary product compositions do not. The legacy custom `JsonObjectBody` decorator
is available only for these compatibility inputs. Both paths use the same mandatory
cancellable parser; the obsolete unowned iterator branch has been deleted.

The global filter emits authentication `{error}`, workspace
`{code: 'workspace_changed', error}`, and admitted study `{error, details}` schemas.
Unexpected study failures retain the legacy sanitized local-operation message;
other unexpected failures use the generic request message. Nest's default
`statusCode/message/error` schema and internal error text never escape. JSON
responses use no-store/nosniff; admission sets same-origin referrer policy (auth
uses no-referrer). Ended/destroyed responses are left alone and partial responses
are destroyed on failure.

## Shutdown and tests

The first global guard synchronously acquires a request-lifetime lease, before Nest
can await subsequent guards. The filter releases guard-denied work only when an
interceptor has not taken ownership. Once the interceptor owns the lease, its
native promise releases it only after input settlement, controller settlement and
personal scope cleanup, including failures. The exception filter cannot release
that lease early. Response finish/disconnect never independently releases pending
work. `beforeApplicationShutdown` rejects new admissions, disconnects HTTP sockets
to unblock partial bodies, and joins every lease while roots are open. Nest then
disposes HTTP once; `onApplicationShutdown` closes shared/accounts roots. There is
no asynchronous RxJS finalizer. Non-cooperative input and controller promises
deliberately keep shutdown pending; controllers must return/await their work. This seam applies
to both the core factory and full production composition; public work additionally
joins response completion and returned handler promises.

The factory contains provider construction, init and listen failures. Its public
lifecycle wrapper joins in-flight init/listen and shares a single close promise; it does not assign methods onto
NestFactory's proxy or separately call `server.close`. This tracks startup for
shutdown. R1-N1 is now resolved by rejecting overlapping `init()`/`listen()`
calls with an explicit startup-in-progress error. Callers await startup sequentially;
controlled init-hook gates verify that duplicate initialization cannot enter.

`tests/compiled/security.spec.ts` uses the actual factory, compiled decorators,
raw Node HTTP, the existing synthetic issuer and test-only probe controllers.
It covers OIDC/roles/workspaces, URL/method/origin negatives, body contracts,
private imports, feature DI aliases, and suspended controller/guard/token-exchange,
partial-body, disconnect, late-response and startup-failure cleanup. Sibling-input
regressions cover pending custom factories and pipes, late database reads, retained
400 responses, actual partial-body cancellation before observation, cooperative
cleanup, shutdown drainage and rejected unowned input/pipe configuration. Probe routes
exist only under `tests/compiled`; do not import them into product modules.
