# Authentication and private workspaces

The React app uses a same-origin Node backend. The backend uses
[`openid-client` v6](https://github.com/panva/openid-client) for OIDC discovery,
Authorization Code with S256 PKCE, state/nonce checks, and ID-token validation
(including JWS signature verification). Passwords are entered at the identity
provider; the app does not accept passwords or implement OAuth/JWT cryptography.

## Local Keycloak

```sh
docker compose -f compose.keycloak.yaml up -d
npm ci
npm run dev
```

Wait for Keycloak to start, then open http://127.0.0.1:3000, choose **Sign in**,
and **Register**. Use synthetic accounts for development. Registering two users
lets you verify that each has a separate library and completed history. There
are no committed passwords, client secrets, or pre-created accounts. The imported
realm enables registration, code flow and required S256 PKCE; password grants and
implicit flow are disabled. The realm is imported only when it does not already
exist. Realm JSON edits do not update an existing Keycloak volume automatically.

Keycloak runs in development mode, with a pinned image, a 1 GB memory limit,
and only host-loopback port 8080 published. HTTP works without a certificate on
loopback. Both application and OIDC URLs require HTTPS elsewhere. Keycloak's
development defaults and open registration are not a production deployment.

If port 3000 is occupied, the development client also permits this exact origin:

```sh
STUDY_PORT=3100 STUDY_ORIGIN=http://127.0.0.1:3100 npm run dev
```

To stop the development identity provider without deleting its accounts:

```sh
docker compose -f compose.keycloak.yaml down
```

The `keycloak-data` volume holds development users. Removing it changes their
subjects, even when usernames are reused, so the app will correctly treat newly
created accounts as different users.

## Configuration

| Variable                   | Default                              | Purpose                                                                         |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `STUDY_ORIGIN`             | `http://127.0.0.1:<STUDY_PORT>`      | Exact browser-facing origin; used for Host, Origin, callback and logout checks. |
| `STUDY_OIDC_ISSUER`        | `http://127.0.0.1:8080/realms/study` | Trusted issuer discovered by the OIDC client.                                   |
| `STUDY_OIDC_CLIENT_ID`     | `study-tool`                         | Registered OIDC client.                                                         |
| `STUDY_OIDC_CLIENT_SECRET` | unset                                | Optional confidential-client secret, server-side only.                          |
| `STUDY_DATA_DIR`           | `private/app`                        | Account registry and private user database directory.                           |

Register `<STUDY_ORIGIN>/auth/callback` as an exact redirect URI and
`<STUDY_ORIGIN>/` as an allowed post-logout redirect. A public client with required
PKCE is supported for the local development setup. A confidential client can use
a secret supplied through the deployment's private environment. Never put that
secret in browser code, realm exports, or committed configuration.

Behind a TLS reverse proxy, set the public HTTPS origin and preserve its Host
header. The app does not trust forwarded host/protocol headers. Restrict direct
access to the backend. HTTPS origins produce Secure cookies; the Node listener
can use HTTP behind that trusted proxy. Docker Compose requires an issuer URL
reachable from inside the app container; the local development provider on the
host's loopback is intended for the native Node server.

## Identity, sessions, and ownership

- A verified `(issuer, subject)` maps to a random internal user ID. Display names
  are mutable presentation; matching usernames or email addresses never links
  accounts. Replacing an issuer or recreating a realm requires explicit account
  migration. Keycloak can later broker Google/Microsoft identities while keeping
  its issuer and subject stable for this app.
- The browser receives an opaque HttpOnly, SameSite=Lax session cookie. Only its
  SHA-256 hash is stored in `accounts.sqlite3`. OIDC tokens are discarded after
  validation and are never sent to React or stored in browser storage.
- Application sessions persist across app restarts, expire after eight hours,
  and are revoked by same-origin POST logout. Logout also redirects to the
  provider's end-session endpoint when available; Keycloak may ask for logout
  confirmation because the app does not retain an ID token. Local revocation
  succeeds even if the provider is unavailable.
- Pending logins live in bounded process memory for ten minutes and are bound to
  a browser cookie. A restart or second concurrent sign-in in the same browser
  can require starting sign-in again. Callback transactions are single use.
- This slice does not implement refresh tokens, provider back-channel logout, or
  immediate revocation of all application sessions when a Keycloak account is
  disabled. The eight-hour application session lifetime is independent of the
  provider's token lifetime.
- Every authenticated study request opens only `users/<internal-user-id>.sqlite3`
  and closes it after the request. Libraries, imports, reviewed concepts, earned
  certifications, attempts, deletion recovery, reports, and mastery all use that
  database. API parameters cannot select another user's workspace. Import-preview
  tokens also include the workspace ID. Quiz deadlines are settled on the next
  authenticated study request rather than by a global shared-library timer.
- Anonymous API requests return 401. `/api/session` exposes only the current
  account's ID/name (or null), and `/api/health` reports liveness. Same-origin
  mutation checks and an exact Host allowlist protect cookie-authenticated APIs;
  the GET callback and public app shell permit the provider's cross-site return
  navigation. Study API requests keep their cross-site restriction.
- On 401, the frontend removes the workspace and offers sign-in. Focus rechecks
  the browser's account, and changing accounts remounts the workspace. Signing out
  from practice uses the existing save/pause guard. The selected certification is
  remembered per account; appearance and sidebar layout remain browser preferences.
- Every study API request must send `X-Study-Account` with the user ID returned by
  `/api/session`. The frontend binds this to the displayed workspace before it
  mounts. A stale tab's account cannot match a replacement login: reads and writes
  return `409 workspace_changed` before opening study data, and the UI offers
  sign-in again. Browser checks use the same `apiFetch` request boundary.

## Existing data and future sharing

The previous `library.sqlite3` stays untouched. No account silently acquires it.
New users get empty databases; reimporting banks starts their private libraries.
An explicit, backed-up migration is needed to retain a previous library's quiz
history. Do not copy databases while either server has them open or overwrite a
new user's study data. Back up the account registry and all user databases as one
unit while the application is stopped.

Separate study files reuse the existing tested repository/service boundaries and
avoid relying on a tenant filter in every query. This is a single-instance SQLite
architecture. A future shared-bank model needs a shared content store plus
user-owned progress and access rules; these private files are not presented as
the final shared-bank schema. Direct login with several independent issuers would
also need explicit account linking; Keycloak brokering can handle that externally.
