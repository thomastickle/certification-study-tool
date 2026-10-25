# Local Docker upgrade and rollback

The default `docker compose up --build -d --wait` starts both the application and
local Keycloak. Open http://127.0.0.1:3000. Keycloak is on port 8080. No certificate,
client secret, or external identity service is needed for this local HTTP setup.
Both published ports bind only to host loopback. This stack runs Keycloak in
development mode; do not expose it on a LAN or the internet.

The two containers share a private network namespace using Compose's
`network_mode: service:keycloak`. Consequently `127.0.0.1:8080` is the same issuer
from the application container and from the host browser. The application still
requires HTTPS for non-loopback issuer URLs. No protocol endpoint rewriting,
host-network access, or broader HTTP exception is needed. Keycloak owns the port
publications; its readiness check gates application startup. Recreate both
services together when changing the Keycloak image or networking.

If Keycloak is replaced independently and sign-in stops responding, recreate both
services together so the app joins the current network namespace:

```sh
docker compose up -d --force-recreate --wait
```

This retains both named data volumes. Container recreation is covered by the
rollout smoke test; it is not a backup-and-restore drill.

## Before the first upgrade

Run from your normal checkout with the **same Compose project name** as the old
installation so that `study-data` resolves to the existing volume. The repository's
usual project name is `certification-study-tool`, with volume
`certification-study-tool_study-data`. If you previously chose another name, use
that name consistently in all commands and substitute its actual volume name.

Before merging, retain the old running image for rollback and stop the old app:

```sh
docker image tag "$(docker inspect --format '{{.Image}}' certification-study-tool-study-1)" certification-study-tool-study:before-oidc
docker compose stop
```

Back up the stopped volume. This uses the already-required official Node image
and writes the archive only into the Git-ignored `private/backups` directory:

```sh
umask 077
mkdir -p private/backups
docker run --rm \
  --mount type=volume,source=certification-study-tool_study-data,target=/data,readonly \
  node:24.17.0-bookworm-slim tar -czf - -C /data . > private/backups/study-before-oidc.tgz
```

Do not remove the data volume. Stop any review identity provider using port 8080
before launching this stack; for the earlier review fixture that command is
`docker compose -p study-auth-review -f compose.keycloak.yaml stop keycloak`.
The reviewed native preview uses separate data and is not the production volume.

## Start and choose the owner

After merging and retaining the existing volume:

```sh
docker compose up --build -d --wait
docker compose ps
```

Open http://127.0.0.1:3000, choose **Sign in**, and **Register** your own account.
The image contains no pre-created accounts or passwords. The account initially
has a private, empty workspace; do not import anything into it before migrating.
The old `/data/library.sqlite3` is retained without being assigned automatically.
While signed in, open http://127.0.0.1:3000/api/session and note `user.id`; match
that ID to the maintenance command's account list below.

Stop only the application, leaving Keycloak running so the maintenance container
can use the same Compose configuration:

```sh
docker compose stop study
docker compose run --rm --no-deps study npm run migrate:library -- --data-dir /data --list-accounts
```

Choose the intended account ID from the list. Preview, inspect the reported owner
and counts, then apply using that same ID:

```sh
docker compose run --rm --no-deps study npm run migrate:library -- --data-dir /data --account-id ACCOUNT_ID
docker compose run --rm --no-deps study npm run migrate:library -- --data-dir /data --account-id ACCOUNT_ID --apply
docker compose up -d --wait
```

The migration keeps the original and creates additional SQLite backups under
`/data/backups`. It preserves sources, questions, concepts, attempts (including
completed/paused/deleted snapshots), mastery records, and earned certifications.
It refuses a non-pristine target and never overwrites another user's database.
See [migration behavior and safeguards](library-migration.md).

Sign in again and check the library and saved results. Registering another user
should show an empty private library. No question banks are distributed to new
accounts automatically.

## Subsequent rebuilds

```sh
docker compose up --build -d --wait
```

Keep both `study-data` and `keycloak-data`. The first contains the account registry,
hashed application sessions, user databases, legacy source and migration backups;
the second contains Keycloak users and their stable subjects. Rebuilding or
recreating containers retains these volumes. Stop both services before filesystem
backups, and back up both volumes. `down --volumes` would delete them.

An existing realm is not reimported on startup. Keep the same browser origin and
issuer after initial setup; changing ports/hostnames requires updating registered
redirects and an explicit identity migration if the issuer changes. Use
`STUDY_WEB_PORT` and `STUDY_KEYCLOAK_PORT` only when choosing a fresh local stack.

## Roll back the first upgrade

Stop/remove the new containers while preserving all volumes:

```sh
docker compose down
docker run -d --name study-rollback --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v certification-study-tool_study-data:/data \
  certification-study-tool-study:before-oidc
```

The old image reads the retained `/data/library.sqlite3`; it does not use the new
private databases. New private-account activity since migration is preserved on
disk but will not appear in that legacy database. Do not copy it back over other
data. Keep the new account registry, user files and Keycloak volume for a later
roll-forward. Stop/remove the `study-rollback` container before starting Compose
again so it does not compete for the port or database.

## Repeatable rollout check

CI builds the real image, starts an isolated local stack, registers two synthetic
users through Keycloak's real code/PKCE flow, previews/applies a legacy migration,
checks private history, then recreates both containers and signs in again. It
checks that subjects/account IDs and user data survive and the legacy source is
unchanged. `tests/docker-rollout-smoke.ts` accepts only an explicitly named
`study-auth-*` test project on isolated ports; it refuses to seed an existing legacy
database. Its synthetic credentials and cookies stay in test-process memory.
