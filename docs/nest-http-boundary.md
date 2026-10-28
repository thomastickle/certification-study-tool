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

Each study controller or handler uses `@StudyRequest()`. Guards run first. The
scope interceptor then opens the actor's personal library with the approved
`StudyLibraryScope.withLibrary`, synchronizes shared deletions and enters parameter
resolution/controller work. The factory registers owned input metadata before Nest
snapshots its parameter pipeline. This scope encloses every registered custom
factory and its parameter-local pipe chain, body streaming, awaited controller
services, errors and disconnects. Only after those operations settle does it observe
the attempted operation and close the personal connection. It never closes the shared root.

```ts
@Controller('api/quizzes')
@StudyRequest()
export class QuizController {
  @Post()
  @HttpCode(201)
  start(
    @JsonObjectBody() input: Record<string, unknown>,
    @StudyContext() context: StudyRequestContext,
  ) {
    return new QuizService(context.study).start(input)
  }
}
```

`context.study` is the combined personal/shared `StudyLibrary` for quiz/home/report
services. `context.personal` is the owned private repository;
`context.shared` is the borrowed shared repository. `context.content(visibility)`
returns an actor-bound `LibraryView` for concept services. Import/library services
that require `LibraryRepository` use the selected personal/shared repository.
`@VerifiedActor()` exposes the same verified actor; `context.actor`, `context.url`
and `context.query` are also available. Do not retain repositories after the
handler's returned promise settles or start detached service work.

Content controllers declare every alias with normal Nest routes. Shared aliases
(including unprefixed shared writes) use `@LibraryWrite('shared')`; private aliases
use `@LibraryWrite('private')`. Keep distinct handlers when policy differs, and
factor their service operation into a focused helper. Shared writes require the
verified session's admin role; private writes allow student/admin in their own
storage. Mark **all** content mutations, including body-free delete/dismiss and
preview confirmation, before any ticket consumption. Domain authorization and
preview binding remain in their existing services.

```ts
@Post('shared/imports/preview')
@LibraryWrite('shared')
previewShared(
  @JsonObjectBody() input: Record<string, unknown>,
  @StudyContext() context: StudyRequestContext,
  @VerifiedActor() actor: SessionUser,
) {
  const preview = new ImportService(context.shared).preview(input.bank)
  const token = this.previews.issue(actor.id, preview.token, 'shared')
  return { ...preview, token }
}
```

### Owned input resolution

Installed Nest 12.3.2 resolves parameters concurrently with fail-fast `Promise.all`.
Rejection of `next.handle()` is therefore **not** proof that sibling factories or
pipes finished. `registerStudyInputs` uses Nest's discovery and parameter metadata
at factory composition, before routing initialization. For `@StudyRequest()`
handlers it wraps **every ordinary Nest custom parameter factory and its complete
ordered parameter-local instance-pipe chain** as one `StudyInputWork` operation.
It does not replace routing, patch Nest core, or infer completion from a response.
Existing `@StudyContext`, `@VerifiedActor`, normalized query/URL and JSON-body
parameters keep their call syntax. Ordinary `createParamDecorator` factories are
also registered automatically; they may return asynchronous resource-using work.
The wrapper preserves custom pipe data/metatype and parameter order. It retains
original factory/pipe metadata separately, deriving metatypes from each concrete
handler even when parameter decorators are inherited or an app is composed again.

A first input failure cancels cooperative siblings through
`context.inputSignal`, retains that original error, and joins **all** input
operations inside `withLibrary` before observation, connection closure or lease
release. A non-cooperative factory/pipe must settle with its database still usable.
Consequently the HTTP error itself waits for that input, even if another input
already rejected. Tests release controlled gates before awaiting the 400; awaiting
the HTTP response before releasing a non-cooperative input would deadlock by
contract. `app.close()` also waits. A response finish or client disconnect does
not dispose storage while non-cooperative resource work remains pending. When
scope ownership starts, cancellation listeners also reconcile an already closed
request/response/socket: a client disconnect during an awaited guard cannot be lost.

Custom factories may use `context.inputSignal` for cooperative cancellation, but
must return/await their entire operation and cleanup. Racing a cancellation promise
against work that continues in the background does not establish ownership. Pipes
may be asynchronous, but must be **instances attached to the parameter**:

```ts
@Get()
read(
  @NormalizedQuery({
    transform(query: URLSearchParams) {
      return { provider: query.get('provider') ?? undefined }
    },
  }) scope: { provider?: string },
  @StudyContext() context: StudyRequestContext,
) {
  return new QuizService(context.study).recent(scope)
}
```

This staged boundary deliberately rejects `@UsePipes`, class-based pipe tokens,
`APP_PIPE`, `useGlobalPipes`, and parameter schemas rather than leaving work outside
its ownership. Instantiate parameter pipes explicitly or keep domain validation in
the existing services. No new validation framework is introduced. Built-in study
`@Body`/`@Query`/`@Param` and other unregistered extraction modes are rejected during
composition; use the normalized/custom decorators above. Raw `@Req`, `@Res` and
`@Next` extraction is allowed, but must not start asynchronous input work.
Registration validation fails startup and closes acquired roots. JSON-body/context
parameters used without the registered personal scope fail before body consumption.
Do not mutate route/pipe metadata or install controllers after factory composition.

`@JsonObjectBody()` requires `@StudyRequest()` and reads only after guards and
scope acquisition. It preserves the exact case-sensitive `application/json`
prefix, 10 MiB limit, non-null object-only JSON, and existing 400/413/415 messages.
The Nest reader uses cancellable readable-stream waits. A failed sibling removes
those waits and cancels the pending body operation without destroying the response
or waiting for the client to send the remainder of a declared body. Its cancellation
is joined before storage observation/closure. The retained benchmark/pure-helper reader uses the non-destroying iterator
introduced in stage three; it is unchanged by this correction. Both readers permit the intended JSON 413 response.
Use `@JsonObjectBody(true)` **only for pause**: no transfer-encoding and zero/missing
content-length permits `{}` without a content type. DTO/service validation stays
in existing services. Body-free routes should not add this decorator.

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
