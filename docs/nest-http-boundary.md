# Stage three HTTP boundary and controller handoff

Production still uses `main.ts` → one configured runtime context → the **complete
legacy router**. Stage three is routing-incomplete. `createApplication(config,
featureModules)` creates the real compiled Nest security surface for integration
tests and the subsequent atomic cutover. It does not mount a legacy bridge, SPA,
or product feature controllers. Do not change production to this partial app.

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
JSON parser, CORS/OPTIONS handler, catch-all controller, global prefix or SPA
fallback is installed. Nest's terminal not-found filter runs after all controllers;
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
and revocation. `handle` remains the transitional adapter for production/core tests.

## Study controllers

Each study controller or handler uses `@StudyRequest()`. Guards run first. The
scope interceptor then opens the actor's personal library with the approved
`StudyLibraryScope.withLibrary`, synchronizes shared deletions and enters parameter
resolution/controller work. This scope encloses body streaming, asynchronous
services, errors and disconnects, observes the attempted operation, then closes the
personal connection. It never closes the shared root.

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

`@JsonObjectBody()` requires `@StudyRequest()` and reads only after guards and
scope acquisition. The shared body reader preserves the exact case-sensitive
`application/json` prefix, 10 MiB limit, non-null object-only JSON, and existing
400/413/415 messages. Its non-destroying stream iterator allows a 413 JSON response
instead of destroying the socket before that response can be sent. Use
`@JsonObjectBody(true)` **only for pause**: no transfer-encoding and zero/missing
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
can await subsequent guards. The filter releases denied work; the interceptor
releases successful work only after its native promise settles and personal scope
cleanup finishes. Response finish/disconnect never independently releases pending
work. `beforeApplicationShutdown` rejects new admissions, disconnects HTTP sockets
to unblock partial bodies, and joins every lease while roots are open. Nest then
disposes HTTP once; `onApplicationShutdown` closes shared/accounts roots. There is
no asynchronous RxJS finalizer. Non-cooperative controller promises deliberately
keep shutdown pending; controllers must return/await their work. This seam applies
to the staged Nest factory; production retains its existing transport drain.

The factory contains provider construction, init and listen failures. Its public
lifecycle wrapper joins in-flight init/listen and shares a single close promise; it does not assign methods onto
NestFactory's proxy or separately call `server.close`.

`tests/compiled/security.spec.ts` uses the actual factory, compiled decorators,
raw Node HTTP, the existing synthetic issuer and test-only probe controllers.
It covers OIDC/roles/workspaces, URL/method/origin negatives, body contracts,
private imports, feature DI aliases, and suspended controller/guard/token-exchange,
partial-body, disconnect, late-response and startup-failure cleanup. Probe routes
exist only under `tests/compiled`; do not import them into product modules.
