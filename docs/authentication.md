# Login, shared banks and private libraries

Users sign in through the configured OIDC provider. Everyone can study shared
question banks. The application `admin` role permits importing, changing, and
deleting shared banks and reviewed concept mappings. Attempts, mastery, results,
and earned certifications live with private banks in that account's own database.
Administrators cannot browse another account's private library or study history.
See [private libraries](private-libraries.md) for storage, upgrade and backup details.

The backend uses `openid-client` for discovery, Authorization Code with S256 PKCE,
state, nonce, and signed ID-token validation. Passwords stay at the provider.
The browser receives an opaque HttpOnly, SameSite=Lax cookie; the separate account
database stores its hash. Provider tokens are discarded.

## Local Keycloak setup

Keep credentials in a private, Git-ignored `.env` file:

```dotenv
KC_BOOTSTRAP_ADMIN_USERNAME=local-admin
KC_BOOTSTRAP_ADMIN_PASSWORD=<your-private-local-bootstrap-password>
```

Start the identity provider:

```sh
docker compose -f compose.keycloak.yaml up -d --wait
```

Open http://127.0.0.1:8080/admin and select the **study** realm. Create your users
under **Users**, enable them, and set passwords under **Credentials**. Registration
is disabled in the supplied development realm.

For an application administrator, open the user's **Role mapping**, filter by
client roles, and assign **study-tool → admin**. Students need no role. Keycloak
bootstrap administrators do not automatically receive application admin rights.

Start the application and open http://127.0.0.1:3000:

```sh
docker compose up --build -d --wait
```

The image contains no seeded users or passwords. Keep the Keycloak volume:
recreating users can change their subjects. Native development can use
`npm run dev` with Keycloak running.
The development client permits exact callbacks at ports 3000 and 3100; a native
server on port 3100 needs matching `STUDY_PORT` and `STUDY_ORIGIN` settings.

## Verified roles and existing realms

The app reads only the `study_roles` array in the **verified ID token**. An exact
`admin` entry grants shared-library management. Missing, malformed, or unrelated
roles grant student access. Browser headers, usernames, email addresses, realm
administrator roles, and unsigned token contents do not grant application roles.

The supplied realm declares the `study-tool` client role and a dedicated mapper.
For an **existing realm**, apply these changes in its admin console; startup
import does not update an existing realm:

1. Under **Clients → study-tool → Roles**, create `admin`.
2. In the client's dedicated scope, add a **User Client Role** mapper named
   `study-application-roles`.
3. Set **Client ID** to `study-tool`, **Token Claim Name** to `study_roles`,
   **Claim JSON Type** to `String`, and **Multivalued** to on.
4. Turn **Add to ID token** on. Access-token and userinfo inclusion are not needed.
   See the exact [realm configuration](../dev/keycloak/study-realm.json) and
   [Keycloak mapper fields](https://www.keycloak.org/admin-api/protocol-mappers#oidc-usermodel-client-role-mapper).
5. Assign the client role to intended users and sign in again. Confirm an admin
   sees import/delete controls and a student can browse and study.

Any user who authenticates with the configured issuer/client can use student
features. Control enrollment at that provider. Providers that do not issue the
application role claim grant student access.

## Configuration

| Variable                      | Default                                                          | Purpose                                                         |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `STUDY_DB_PATH`               | `private/app/central.sqlite3`; `/data/central.sqlite3` in Docker | Central accounts, sessions and shared content.                  |
| `STUDY_PRIVATE_LIBRARIES_DIR` | `users` beside the shared database                               | One private library and study database per internal account ID. |
| `STUDY_ACCOUNTS_PATH`         | Retired; setting this causes a configuration error               | Convert externally and select STUDY_DB_PATH.                    |
| `STUDY_LEGACY_OWNER_SUBJECT`  | Unset                                                            | Retired runtime setting; external conversion owns mapping.      |
| `STUDY_OIDC_ISSUER`           | `http://127.0.0.1:8080/realms/study`                             | Trusted issuer identifier, retained exactly.                    |
| `STUDY_OIDC_CLIENT_ID`        | `study-tool`                                                     | Registered client.                                              |
| `STUDY_OIDC_CLIENT_SECRET`    | Unset                                                            | Optional private server-side client secret.                     |
| `STUDY_ORIGIN`                | `http://127.0.0.1:<STUDY_PORT>`                                  | Exact browser origin and Host allowlist.                        |

`STUDY_OWNER_SUBJECT` no longer controls admission. The legacy-owner setting is
for data attribution and never grants admin rights. Its value must be the previous
owner's verified `sub` from the same issuer, not a username, email, or display
name. There is no automatic first-login claim.

Register `<STUDY_ORIGIN>/auth/callback` and `<STUDY_ORIGIN>/` as exact callback and
logout destinations. Keep the issuer exactly as published, including whether it
ends in `/`. HTTP is accepted only on loopback; remote origins and issuers require
HTTPS. A TLS reverse proxy must preserve the configured Host and restrict direct
backend access. Forwarded origin headers are not trusted. HTTPS uses Secure
cookies. Keycloak `start-dev` and the loopback Compose setup are for development.

## Sessions, role changes, and revocation

- Each application session lasts eight hours without sliding expiry or a refresh
  loop. Its verified role is fixed for that session and survives app restarts.
  New sign-in establishes the latest role and replaces that browser's old session.
- Changing a provider role, disabling a user, or ending a provider session does
  **not** immediately revoke application sessions in other browsers. They remain
  valid until local logout, expiry, or operator revocation.
- For urgent revocation, first remove the provider role or disable the user, then
  revoke that account's application sessions. With the standard volume:

  ```sh
  docker compose exec study node build/src/server/auth/revoke-sessions.js --accounts /data/central.sqlite3 --issuer '<exact-configured-issuer>' --subject '<user-ID>'
  ```

  Native runs can use `npm run auth:revoke --` with the same arguments. Issuer and
  subject must both match; other accounts remain signed in. Sign in again to
  acquire updated permissions. Back-channel logout is not implemented.

- Login transactions are browser-bound, single-use, bounded, and expire after ten
  minutes. Import review tickets have the same lifetime, belong to one account,
  and can be confirmed once. App restart requires a fresh import preview.
- Logout is a same-origin POST after the practice save/pause guard. Failures keep
  the workspace open with feedback. Provider outages do not prevent local logout.
  Keycloak may request confirmation because the app does not retain an ID token.
- APIs use the authenticated account and the UI's fixed account binding. Old
  workspaces cannot adopt a replacement login or its API client. Focus checks
  preserve the mount only when account and role match.

## Upgrade from the owner-only release

Use the external [database administration workflow](database-management.md) with
all writers stopped and drained. The runtime does not identify a legacy owner or
upgrade accounts and study schemas. Existing local user data conversion is deferred
until the complete change merges into master. Preserve the configured issuer and
verified account mappings through conversion; normal login continues to issue
sessions in the prepared central file, without provisioning personal workspaces.
