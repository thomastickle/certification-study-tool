# Development process ownership

Compiled development `main.ts` uses `DevelopmentApplication`. It starts the real
Nest API on an ephemeral `127.0.0.1` listener, with the configured public
`STUDY_ORIGIN` still governing authentication, Host/Origin checks, callbacks and
cookies. A separate Node child owns the public listener through stock Vite
`createServer()` / `listen()`, actual project configuration and `/api/`, `/auth/`
proxies with `changeOrigin: false`. Production main still uses the existing
built-static Nest composition and does not load or launch Vite.

The child receives public origin, listen host/port, backend target and project
working directory. Its environment contains PATH, development NODE_ENV and public
VITE-prefixed settings, rather than backend credentials or storage configuration.
Vite's normal public environment/config loading remains active. Neither the child
nor its admission helper imports authentication repositories or opens SQLite.

The security exception is raw Node request/upgrade dispatch admission before
Connect normalizes the target. The child and backend use one pure `admitRequest`.
The child installs this boundary on each stock-created server, including config
restarts; it never replaces Vite lifecycle methods or patches environment/plugin
internals. Unknown API/auth requests stay on the backend JSON boundary. Ordinary
admission error encoding is shared with the backend exception writer.

Readiness requires both Nest listen and the child's bounded IPC-ready handshake
after stock Vite listen. Main prints its startup announcement afterward. An
unexpected frontend exit closes the backend and fails the generation with nonzero
status. There is no child retry loop. The existing outer compiler supervisor waits
for a watched backend/source/config change after generation failure. Healthy Vite
config changes and frontend HMR remain stock Vite responsibilities. A failed
startup can be deliberately retried after correcting the config and triggering a
supervisor-watched source change; Vite config alone is not currently watched by the
outer supervisor after a failed generation.

Shutdown first asks the child to reject new public admissions. If it does not
acknowledge within the bound, the parent terminates it before draining the backend.
Nest retains its existing request-work/private-connection/root lifetime ordering.
Then the parent signals the frontend process group, escalates after a bounded
grace period and joins the direct child, including failed/partial Vite startup.
Repeated shutdown and shutdown during pending readiness share one close operation.

`tests/compiled/development-process.spec.ts` covers real signed OIDC/session
proxying, frontend transform, raw HTTP/upgrade denial, atomic CSS HMR, stock config
restart with a surviving API/session, acquired-watcher startup failure, occupied
public port, pending readiness cancellation, incomplete authorized body, late
request storage work and compiled-main crash/signals. These are HTTP/WebSocket and
process tests, not proof of rendered-browser state preservation.

## Transitional test seams

The actual development main no longer uses `PublicWeb` / `DevelopmentVite` /
`DevelopmentViteGraph`. They remain temporarily because legacy factory tests still
exercise in-process middleware/SSR handles and graph-specific resource assertions.
This slice is not completion of the deletion-first conversion. The maintained
assertion map must retire those handles explicitly and retain product-level
security, lifecycle and recovery assertions before deleting the implementations.
Production static serving is outside this change, including parallel PR95.

Private implementation evidence and commands are retained in
`/tmp/nest-vite-implementation/HANDOFF.md` and restricted sibling logs. Historical
performance reports are unchanged; no performance improvement is claimed. Issue
#81 remains open.

| Existing assertion family                                                                     | Coverage in the process slice                                                                                                  | Remaining migration before graph deletion                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `production-dev.spec.ts` SSR plugin middleware / `ssrLoadModule` handle                       | Actual product `main.tsx` transform and signed API/session proxy                                                               | Explicitly retire the in-process factory handle seam; the product does not use SSR routes. Do not invent an IPC Vite API.                                                                                             |
| `vite-lifecycle.spec.ts` configureServer/buildStart/options/factory/public-file failure       | Occupied listener and acquired-watcher configureServer rejection close real backend roots; pending initialization cancellation | Consolidate applicable early/partial startup resource assertions into child/process checks, including buildStart; remove native watcher identity assertions only when process-group/endpoint assertions replace them. |
| `vite-lifecycle.spec.ts` successful config watching                                           | Atomic real config edit, stock restart, retained session/API and reinstalled raw admission                                     | Add invalid config/recovery and unlink/replacement-gap probes before claiming full restart parity.                                                                                                                    |
| `vite-reload.spec.ts` retained old graph on failed replacement and successful custom handoff  | Successful stock config restart; unexpected child death fails the generation                                                   | Explicitly retire custom rollback/old-graph identity semantics. Test stock failed-config behavior and deliberate fresh-generation recovery; keep bounded shutdown overlap coverage.                                   |
| `vite-activation.spec.ts` custom environment init/close/listen ordering and endpoint identity | Real public listener ownership, occupied-port cleanup, pending-ready shutdown, compiled main crash/signals                     | Arbitrary environment identity/handoff is no longer a remote API contract. Preserve resource disposal assertions at the process boundary before removing synthetic graph-extension fixtures.                          |
| `vite-watcher-disposal.spec.ts` delayed-stat/native watcher controls                          | Child termination and compiled-main process-group disappearance                                                                | Retain a delayed filesystem completion during process shutdown or demonstrate that the OS process boundary contains it; never replace resource assertions solely with `close()` resolution.                           |
| Transport/API storage lifetime                                                                | Connected HMR, incomplete authorized body, real held HTTP scope, observed drainage and post-close private/shared queries       | Existing transport/security/domain tests remain unchanged. Extend process isolation to two actors and the remaining security negatives for overall parity.                                                            |

No existing assertion or graph test has been deleted in this working bootstrap
slice. This table records remaining work, not completed migration approval.
