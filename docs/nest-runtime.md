# Stage two runtime boundary

Production creates one `RuntimeModule.register(configuration)` application context.
The complete existing router remains in `startLegacyTransport`; the foundation
health controller is not the production HTTP server. This is an intermediate
lifecycle conversion, before the atomic controller/guard cutover.

`runtimeConfiguration(environment)` validates settings without I/O or ambient
environment reads. Explicit shared paths derive adjacent accounts and users paths;
compiled fixtures pass a disposable configuration to `createApplication(config)`.
No default configuration is registered at import time.

## Provider interfaces for controller work

Import the same configured `RuntimeModule` instance through the application root;
do not register it independently in each feature module. It exports:

- `RUNTIME_CONFIGURATION`: resolved `RuntimeConfiguration`, including origin,
  listener, shared/private paths, authentication options, legacy subject, production
  mode and static root.
- `ApplicationAuthentication`: the singleton verified-session/OIDC/accounts owner.
  Its existing `handle` result supplies the verified `SessionUser` to the router.
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
`beforeApplicationShutdown` drains the attached intermediate transport: Vite and
upgraded HMR sockets first, then HTTP sockets and every active handler promise.
Development Vite has an owner before its factory is awaited. `DevelopmentVite`
resolves configuration once and uses Vite's exported plugin-patching point to put
its pre-ordered capture hook before file-config hooks, including other pre hooks.
It records environment initialization resources for failures that precede
`configureServer`. A rejected environment factory defers its original error to
Vite's `init` boundary solely to capture the already allocated watcher; that
failure carrier never enters a ready graph. Parallel initialization drains before
partial environments, HMR and watchers close. If public-file scanning fails before
those handles are exposed, the owner removes HMR listeners from its unbound HTTP
server. Factory rejection disposes immediately and retains the startup error;
subsequent Nest transport shutdown shares the same disposal promise.

After Vite's hooks drain, close its watcher once more: Vite closes watchers in
parallel with those hooks, and a late watch registration can reopen Chokidar.
Disposal also crosses Node's native watcher close phase before rethrowing a startup
error, so fatal exit cannot hide pending `FSEventWrap` cleanup. These adapters are
covered against the installed Vite 7.3.7 public environment/init and plugin hooks;
keep those regression tests when upgrading Vite.
`onApplicationShutdown` closes shared/accounts roots after transport disposal.
These methods are idempotent; aliases have no competing disposal responsibility.
Nest 12 reports hook exceptions and continues its remaining shutdown phases.

When HTTP moves to Nest, remove the legacy transport attachment rather than moving
root disposal into `onModuleDestroy`. Keep body parsing after authorization and
retain the request scope until its asynchronous handler/interceptor chain settles.
The current entry point installs both signal listeners during startup, shares one
shutdown promise, waits for in-progress initialization, removes its listeners after
closure, and exits through normal event-loop drainage.
