# Staged Nest runtime boundary

Nest transport layout follows feature ownership. Only `main.ts`, `application.ts`,
`application.module.ts`, and `production-application.ts` remain at `src/server/`:

- `runtime/` owns configuration, startup acquisition/unwind, runtime aliases and study scope.
- `security/` owns admission, global guards/filter/interceptor and guarded body parsing and request lifetime.
- `auth/` owns authentication/session controllers and workflows; its module borrows the
  runtime-owned authentication singleton. `health/` owns its controller and service.
- `library-http/` and `study-http/` keep controllers, route guards and private feature
  helpers next to modules that contain registration only.
- `web/` owns static/Vite serving and watcher lifetime; `http/` contains framework-free
  request/body/routing helpers and application errors.

The global runtime is registered once. Auth and health modules are composed by the
application module; security keeps its existing global provider order. Domain
repositories and services retain their existing directories and ownership.

Production `main.ts` calls `createProductionApplication(configuration)` from
`production-application.ts`. It composes `LibraryHttpModule`, `StudyHttpModule`,
security controllers/guards and `PublicWeb` through one configured RuntimeModule.
`createApplication(config, extraFeatures)` remains the focused integration factory.
No production request calls `startLegacyTransport`, `apiController` or the legacy
authentication dispatcher. The legacy transport/request-handler/authentication and
API/concept dispatchers are removed. Tests and the foreground benchmark use Nest;
see `nest-http-test-migration.md` and `nest-benchmark-migration.md`.

`runtimeConfiguration(environment)` validates settings without I/O or ambient
environment reads. Explicit shared paths derive adjacent accounts and users paths;
compiled fixtures pass a disposable configuration to `createApplication(config)`.
No default configuration is registered at import time.

## Provider interfaces for controller work

The configured `RuntimeModule` exports its providers globally through the application root;
do not register it independently in each feature module. It exports:

- `RUNTIME_CONFIGURATION`: resolved `RuntimeConfiguration`, including origin,
  listener, shared/private paths, authentication options, legacy subject, production
  mode and static root.
- `ApplicationAuthentication`: the singleton verified-session/OIDC/accounts owner.
  The Nest transport calls its admission/session/workflow methods directly.
  The obsolete `handle` dispatcher is removed.
- `SHARED_LIBRARY_REPOSITORY`: the singleton shared `LibraryRepository`. Consumers
  borrow it; they must never close it or substitute a private root.
- `ImportPreviews`, `PrivateLibraries`, and `StudyHousekeeping`: the same singleton
  instances used by production, including preview ownership and existing upkeep
  scheduling/coalescing behavior.
- `StudyLibraryScope.withLibrary(verifiedSessionUser, method, async personal => ...)`:
  opens owner-verified personal storage, awaits the full operation, observes the
  attempted request before closing, and closes even when observation throws.
  Call it around body parsing and all subsequent work. The actor comes from verified
  authentication, never `X-Study-Account` or another client selector. Disconnecting
  does not independently dispose storage while work is still pending. This class
  neither formats responses nor applies HTTP security policy.
- `ApplicationRuntime`: sole root owner; its public readonly properties expose the
  same objects as the provider aliases. Feature handlers should prefer the focused
  tokens above and leave lifecycle hooks to Nest.

## Startup and shutdown

The asynchronous runtime provider maps the explicit legacy subject, opens and
secures the shared root, migrates private storage, and awaits the startup upkeep
pass before it resolves. Failed acquisition unwinds successfully opened resources.
Only after readiness does the unreferenced one-second upkeep interval run.

`onModuleDestroy` cancels the timer and awaits `StudyHousekeeping.stop()`. It leaves
roots open because Nest runs this phase before disposing its HTTP transport.
`beforeApplicationShutdown` drains the attached Nest transport: it stops admission,
aborts HTTP sockets to unblock body/response waits, and joins every actual handler
promise before `onApplicationShutdown` closes shared/accounts roots. Public work
retains response completion/disconnect and returned handler promises; neither alone
releases storage ownership. Static serving is the separately verified Express
adapter described in [static serving](nest-static-serving.md).

Development main owns a private real Nest API and a public stock Vite child. The
child uses the actual project config, stock proxy/HMR/restart APIs and shared pure
original-target admission before Node request/upgrade dispatch. The parent owns
bounded readiness, early/repeated signal cancellation, crash propagation,
stop-admission acknowledgement, backend drainage and process-group termination.
The public origin remains authoritative for Host/Origin/OIDC/session behavior.
See [development process ownership and assertion migration](development-process.md).

The former `DevelopmentVite` / `DevelopmentViteGraph` implementations are deleted.
There is no application-owned plugin/environment initialization, watcher sealing,
HMR bridge, graph handoff or remote Vite server facade. Mutable watcher metadata
inside a terminated child is not a resource contract: tests prove acquisition,
then process-group disappearance and closed SQLite roots. The process boundary
contains callbacks and watches even if stock initialization never returns a handle.
Custom environment identity and in-process graph-method seams are explicitly
retired; local Vite plugin SSR remains tested through HTTP in the child.

Main installs both signal listeners during startup and shares one shutdown promise.
Early signals cancel pending child readiness, prevent public readiness and exit
cleanly after disposal. Unexpected frontend death fails the generation with a
nonzero exit. Backend public Nest initialization/listening still uses the existing
sequential lifecycle and PR94 root-lifetime fixes. Always await `init()` then
`listen()` sequentially (or a single `listen()`). Historical performance evidence
is unchanged; no new timing claim follows from this transport replacement.

## Stage three controller handoff

See [the HTTP boundary handoff](nest-http-boundary.md) for the compiled Nest app
factory, security controllers/guard metadata, normalized input decorators,
after-guard body parsing, personal/shared context and request lifetime API.
Production now uses the full Nest composition described above. The stage-three
notes describe the focused core factory, not a separate production runtime.

The factory returns the native Nest object. `ApplicationOwner` owns sequential
init/listen and one joined close for main/development startup; it does not expose
an app-shaped facade. Native parameter metadata and pipes are unmodified.
