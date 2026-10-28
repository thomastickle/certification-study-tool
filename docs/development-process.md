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

## Assertion migration

Both old graph implementations and `developmentWebHandler` are deleted. The
production factory now rejects development configuration, cleaning acquired roots
and pointing callers to `DevelopmentApplication`. The latter is a concrete
composition owner, not an application-shaped or Vite-shaped remote facade. It
exposes the real private Nest backend promise for explicit composition/observation.
PublicWeb remains the existing static response-work owner and disposal hook; the
reviewed Express static implementation is unchanged.

| Retired family                                                                          | Maintained product/resource assertion                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `production-dev.spec.ts` in-process SSR handle                                          | Same local plugin `ssrLoadModule` behavior through actual HTTP in the stock child, plus real Nest root closure. No SSR or Vite handle crosses IPC.                                                                                                                                                                                                                         |
| `vite-lifecycle.spec.ts` configureServer/buildStart/options/factory/public-file failure | Native `main-lifecycle.test.ts` retains configureServer and buildStart failures after real watcher acquisition, diagnostic/failure status and SQLite closure. Acquired child process group must disappear. Process tests add occupied-port and pending-ready cancellation. Synthetic plugin environment factory identity is retired; it is not used by the product config. |
| `vite-lifecycle.spec.ts` config watching and `vite-reload.spec.ts` graph rollback       | Actual config restart, invalid config retaining the stock live generation, repair after unlink/replacement gap, unchanged session/API/admission, then shutdown while another restart is pending. There is no custom rollback or replacement scheduler.                                                                                                                     |
| `vite-activation.spec.ts` environment identity/init-close-listen ordering               | Stock Vite owns environment ordering. Public process tests prove bounded acquisition/endpoint cleanup, failed initialization and child crash failure. Arbitrary previous-environment object identity is explicitly retired.                                                                                                                                                |
| `vite-watcher-disposal.spec.ts` delayed-stat controls                                   | OS process-group disappearance contains all child callbacks and native resources. Native main tests acquire actual watchers before failure and exercise late watch registration during shutdown. No watcher metadata sealing or Vite internals mutation remains.                                                                                                           |
| Development middleware raw rewrite                                                      | Pure immutable admission snapshot tests and actual raw HTTP/upgrade hostile-target denial before Connect; actual client transform replaces a dummy middleware response. Static admitted-context assertions are unchanged.                                                                                                                                                  |
| API/storage lifetime                                                                    | Real OIDC/session/workspace, student denial before malformed body, cross-actor private preview ticket rejection/replay, private bank/quiz isolation and revoked access through the public origin. Connected HMR, incomplete authorized JSON and a held real HTTP scope survive until drainage permits private/shared roots to close.                                       |

Session expiry/role refresh, signature/nonce/audience, duplicate-cookie and the
unchanged domain/security negative matrices remain in their existing suites; they
are not duplicated for each proxy route. Protocol tests do not prove rendered
browser state or HTTPS cookie enforcement. Production static/packaging checks and
parent independent review remain separate required verification. No performance
improvement is claimed; issue #81 remains open.

Private commands/results and source budgets are retained at
`/tmp/nest-vite-implementation/HANDOFF.md` with restricted sibling logs.
