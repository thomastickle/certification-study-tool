# Owner-only OIDC login

This first authentication epic admits one explicitly configured owner. The
existing `STUDY_DB_PATH` library, question banks, and study history remain in place.
Multiple users, admin-managed shared banks, and private banks are later
[epics](authentication-roadmap.md).

The Node backend uses `openid-client` for discovery, Authorization Code with S256
PKCE, state/nonce, and ID-token validation including signatures. Passwords stay
at the provider. The browser receives an opaque HttpOnly, SameSite=Lax application
cookie; only its hash is stored in the separate account/session database.

## Local Keycloak and owner enrollment

Use a private, Git-ignored `.env` file for these local settings. Choose a strong
local bootstrap password; never commit that file or a realm export with passwords.

```dotenv
KC_BOOTSTRAP_ADMIN_USERNAME=local-admin
KC_BOOTSTRAP_ADMIN_PASSWORD=<your-private-local-bootstrap-password>
```

Start the identity provider first:

```sh
docker compose -f compose.keycloak.yaml up -d --wait
```

Open http://127.0.0.1:8080/admin and sign in with those bootstrap credentials.
Select the imported **study** realm. Under **Users**, create the owner's user,
enable it, and set its password under **Credentials**. Copy its **ID** from the
user details into `.env`:

```dotenv
STUDY_OWNER_SUBJECT=<the-owner-user-ID-from-the-study-realm>
```

This must be the verified OIDC `sub`, paired with `STUDY_OIDC_ISSUER`; a username,
email, or display name does not establish ownership. There is no automatic
first-login claim. Registration is disabled in the development realm. A valid
login by another identity is denied and clears any previous local browser session.

Start the application:

```sh
docker compose up --build -d --wait
```

Open http://127.0.0.1:3000 and choose **Sign in**. The image contains no seeded
users or passwords. Realm imports happen only when the realm does not exist;
editing the JSON does not change an existing realm. Keep the Keycloak volume:
recreating users can change their subjects and requires explicit reconfiguration.

For a native development server, leave Keycloak running and use:

```sh
node --env-file=.env --watch src/server/main.ts
```

`npm run dev` also works when the configuration is exported in the environment.
The local client permits exact callbacks at ports 3000 and 3100. For port 3100,
set `STUDY_PORT=3100` and `STUDY_ORIGIN=http://127.0.0.1:3100` together.

## Configuration

| Variable                   | Default                                                             | Purpose                                                    |
| -------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `STUDY_DB_PATH`            | `private/app/library.sqlite3`; `/data/library.sqlite3` in the image | Existing study database; unchanged by authentication.      |
| `STUDY_ACCOUNTS_PATH`      | `accounts.sqlite3` beside the study database                        | Durable account/session metadata; must be a separate file. |
| `STUDY_OWNER_SUBJECT`      | Required                                                            | The sole admitted subject from the configured issuer.      |
| `STUDY_OIDC_ISSUER`        | `http://127.0.0.1:8080/realms/study`                                | Trusted issuer.                                            |
| `STUDY_OIDC_CLIENT_ID`     | `study-tool`                                                        | Registered client.                                         |
| `STUDY_OIDC_CLIENT_SECRET` | Unset                                                               | Optional server-side confidential-client secret.           |
| `STUDY_ORIGIN`             | `http://127.0.0.1:<STUDY_PORT>`                                     | Exact browser-facing origin and Host allowlist.            |

Register `<STUDY_ORIGIN>/auth/callback` as an exact callback and `<STUDY_ORIGIN>/`
as an allowed post-logout redirect. Local development uses a public client with
required PKCE; a confidential client can supply a private server-side secret.

HTTP is accepted only on loopback. Remote application origins and issuers require
HTTPS. Behind a TLS reverse proxy, preserve the configured Host and restrict direct
backend access; forwarded host/protocol headers are not trusted. HTTPS produces
Secure cookies. The local Compose services share a loopback namespace so both
browser and server can use the same issuer URL. Keycloak `start-dev` is a local
development setup, not a production identity-provider deployment.

## Sessions and failure behavior

- Application sessions survive app restarts, expire after eight hours, and are
  checked against the current configured owner on every study request. Changing
  the configured owner requires a restart and rejects the former owner's sessions.
- Provider tokens are discarded. There is no refresh token or refresh loop,
  back-channel logout, or immediate provider-disable revocation. A local session
  remains valid until local logout or its eight-hour expiry.
- Pending login attempts are browser-bound, single-use, bounded, and expire after
  ten minutes. Restarting the app or overlapping sign-ins can require starting
  again. New attempts replace the browser's previous attempt.
- Logout is a same-origin POST, following the practice save/pause guard. Local
  revocation succeeds during provider outages. The provider may request logout
  confirmation because the app does not retain an ID token.
- The API requires the immutable account binding displayed by the mounted UI.
  An obsolete client cannot adopt a replacement login or invalidate its UI with
  a late failure. Focus rechecks the session while preserving a same-owner mount.

## Upgrade and rollback

Before upgrading, retain the previous image tag and stop the study application.
Back up its entire data volume while stopped, and use the same Compose project
name and volume as before. Keep `STUDY_DB_PATH=/data/library.sqlite3` for the
standard image; do not create a fresh study volume as part of adding login.

Enroll the owner in Keycloak and set the verified subject before starting the new
image. Check `/api/health`, sign in, and verify existing questions and completed
history. No study schema or ownership migration is introduced by this epic.
The only added application file is the account/session database beside the library.

Back up the application volume and Keycloak volume, plus private configuration.
To roll back, stop the new app and start the retained old image with its original
library volume and environment. The old image does not provide this login boundary;
retain its previous network restrictions. Restore a stopped-volume backup only
when required and with a separately preserved copy of newer data.

`docker compose down` retains the volumes. `down --volumes` deletes their data.
