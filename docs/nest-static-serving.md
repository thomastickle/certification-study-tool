# Production static serving

`staticWebHandler` configures the installed Express static middleware, the same
implementation used by Nest's Express adapter. It no longer owns file streams,
pipelines, file-size headers or stream disposal. No dependency was added.

Original-target admission remains ahead of Express; the existing security guard
selects public web requests only after excluding `/api/*` and `/auth/*`. The
bridge uses the frozen admitted path rather than the raw request target.

Compatibility policy remains explicit: GET/HEAD only, root index and nonexistent
extensionless SPA fallback, existing directories rejected, lexical containment,
legacy MIME types (including octet-stream for all other extensions), no-cache and
nosniff. The middleware-level compatibility matrix retains historical dotfile/link
behavior, but release builds and production startup now reject hidden entries,
all symlinks (even in-root links), and special files anywhere in the asset tree.
The root itself must be a real directory. These checks run before publication
and before public serving is initialized. Distribution assets must remain
immutable while serving; this is an artifact/startup gate, not a defense against
concurrent filesystem replacement by a privileged writer. Fixtures use only
synthetic owned files. SPA fallback and API/auth exclusion remain unchanged.
A middleware-local request view removes conditional headers, disables ranges and
re-encodes the resolved path. This preserves unconditional full 200 responses
without altering the security context or authenticated request headers.

Express/send owns stat, open, streaming, HEAD suppression and disconnect cleanup.
PublicWeb continues to retain response completion and drain it during root
shutdown. The native parity matrix covers headers/bytes and lexical policy;
compiled production tests cover real admission, API exclusion and interrupted
large responses. Existing startup and lifecycle tests remain in place.

Read errors abort the response even before headers flush: Express may already
have selected a file Content-Length. Returning a shorter error body with that
length would leave clients waiting for missing bytes. Regressions inject failures
both on file open and after data, and require transport failure before the client
deadline plus file-stream closure.
Lookup failures without a selected file length still return the legacy 404 body,
including a symlink loop inside the owned static fixture.

The native test runner caps independent files at two: process-level development
tests launch their own compilers and servers, so CPU-based default parallelism
can exhaust their startup budgets on a shared machine. Tests, deadlines and
test-internal concurrency assertions remain unchanged. This scheduling bound
does not guarantee that unrelated timing failures cannot occur.

The custom Vite graph, application proxy and joined-input metadata machinery
have also been removed. The infrastructure inventory records remaining ownership.
The policy bridge can be longer than the former file server despite deleting
manual I/O; source counts must be reported separately from tests and docs.

Physical source budget against `408cb29`: `src/server` 7,377 → 7,411 (+34),
with `web-handler.ts` 58 → 92. Against integrated #94, 7,526 → 7,560 (+34).
The static file-serving implementation is removed,
but explicit configuration, dependency typing and the local request view cost
more lines. Test and documentation additions are separate from source.
These counts include blank lines and comments and do not imply a latency gain.
