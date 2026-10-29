# Database administration

The server must never create, upgrade or convert database files. The current SQL
catalogs are `database/migrations/central` and `database/migrations/personal`.
Standalone Flyway 13.11.1 is pinned by image digest in `scripts/database-files.ts`.
Docker calls use `--pull never --network none`, a read-only SQL mount, and one
explicit writable output directory. Protect the SQL catalog and template manifest
as trusted administrative artifacts; a hash is not a signature.

## Fresh installation

For a genuinely new installation, run the standalone command from a Node 24
checkout with Docker available and the pinned Flyway image already loaded:

```sh
docker pull --platform linux/amd64 redgate/flyway@sha256:b45087cccd267d326c5fd776bc06e9690e83509ce8bbf47acd65f1aa4a4b8b86
mkdir -p private
npm run database:admin -- init private/app
```

The destination must not exist, even as an empty directory. Use conversion for
an existing installation; never delete its files to make `init` succeed. This
command reserves a 0700 directory, installs a restart gate and exclusive admin
lock, invokes real Flyway for central V1 and the personal template, seals and
validates the template, and creates an empty 0700 `users` directory. It fsyncs
the prepared files and publishes `READY` last, then removes the gate. Failure
retains the incomplete destination and gate; preserve it for investigation and
retry into a different new destination. No account or personal file is created
until a verified account is registered and externally provisioned.

### Fresh Docker volume

The application image contains no Flyway or migration SQL. Build it, prepare a
new host staging directory with the command above (use `private/docker-bootstrap`
instead of `private/app`), then copy the validated deployment into a **new empty**
named volume before starting Compose. The following example uses project
`study-local`; choose the matching project name for all subsequent Compose
commands. Do not run it against an existing installation or a running service.

Run this as one block. The copy is performed by a stopped container; the gate is
removed only after the entire copy succeeds and ownership is assigned to the
image's `node` user. Failed installation remains blocked; retain that volume and
investigate rather than deleting the gate or blindly retrying into it.

```sh
(
  set -e
  docker compose -p study-local build study
  docker volume create study-local_study-data
  docker run --rm --network none --user root --volume study-local_study-data:/data \
    --entrypoint node certification-study-tool-study:local -e \
    "const fs = require('node:fs'); require('node:assert/strict').deepEqual(fs.readdirSync('/data'), []); fs.writeFileSync('/data/RESTART_BLOCKED', 'Installation incomplete. Do not start.\\n', {flag:'wx',mode:0o600})"
  docker create --name study-data-install --volume study-local_study-data:/data \
    certification-study-tool-study:local
  docker cp --archive private/docker-bootstrap/. study-data-install:/data
  docker run --rm --network none --user root --volume study-local_study-data:/data \
    --entrypoint sh certification-study-tool-study:local -c \
    'chown -R node:node /data && chmod 700 /data && test "$(cat /data/READY)" = 1 && rm /data/RESTART_BLOCKED'
  docker rm study-data-install
  docker compose -p study-local up -d
)
```

Retain the host staging directory and its restricted Flyway logs. Docker CI uses
this same external `init` boundary with a fresh named volume and then checks the
packaged server's health and frontend. It does not use the test-only schema
fixture for the empty-volume bootstrap.

## Conversion boundary

**Do not convert the user's local installation before this work has merged into
master and the user has explicitly authorized that conversion.** All development
and validation uses synthetic fixtures.

First stop and drain every application, importer, administrative CLI and old server
that could write any input. Prevent supervisors from restarting them. Old servers
ignore the new readiness protocol; neither `--offline` nor a lock file proves they
have stopped. The deployment operator owns process exclusion throughout backup,
conversion, verification and configuration cutover.

Create a protected JSON configuration with explicit absolute paths:

```json
{
  "accounts": "/synthetic/old/accounts.sqlite3",
  "shared": "/synthetic/old/library.sqlite3",
  "fleet": "/synthetic/old/users",
  "destination": "/synthetic/new-installation",
  "legacyOwner": "00000000-0000-0000-0000-000000000001"
}
```

`legacyOwner` is needed only for occupied preownership tables. Verify its internal
UUID against the old accounts database and the prior operator's identity; never
infer ownership from first login. Preflight rejects unknown study owners, foreign
and future formats, symlinks and an existing destination. Each input role has a
complete frozen legacy schema contract under database/legacy-contracts: tables,
views, indices, triggers, columns, constraints and foreign keys are checked
read-only before any output is created. Independently versioned early extensions
must be complete supported groups. Legacy reference SQL is used only in memory
for validation; it is not applied to input files or used as an upgrade engine.
Imports are restricted to that input role, and converted identities/session rows
are compared again to the authentic accounts snapshot before READY publication.
Shared v1/v2 pre-private installations may have no fleet directory: a missing path
is treated as an empty fleet without creating or modifying that input. Shared
v3/v4 still require a real protected fleet directory, even when empty. Symlinks,
including dangling fleet links, and foreign entries remain errors. If legacy
`quiz_evidence` exists, every row must have a known account and a matching saved
attempt; unknown owners or orphan rows require explicit offline reconciliation
before conversion. Older formats without that table remain supported.

```sh
node scripts/database-admin.ts preflight /synthetic/conversion.json
node scripts/database-admin.ts convert /synthetic/conversion.json --offline
```

Conversion reserves a new 0700 destination, installs `RESTART_BLOCKED`, makes
SQLite online backups (including committed WAL pages), and records their hashes
in a durable `maintenance.jsonl`. Original inputs are never upgraded or deleted.
Flyway creates fresh central and personal template schemas. Row import preserves
identities, external identity mappings, session token hashes and roles (legacy
sessions without roles receive the schema's student default). Account histories
are transferred with the retained attached-database transaction, DELETE journals,
secure deletion and subsequent VACUUM. Existing private histories conflict with
incoming shared histories; they are never combined. Personal files are 0600.

`READY` is written only after validation of the whole staged fleet; the restart
gate is removed last. The server/deployment must require `READY` containing `1`
and refuse `RESTART_BLOCKED` in the central file's parent directory. Runtime and
supervisor integration of this contract is required before operator use.

There is no global filesystem transaction or demonstrated power-loss guarantee.
Per-file Flyway changes and attached study transfers have their SQLite transaction
boundaries. Partial fleet output remains gated. After a failure or interruption,
keep writers stopped, inspect restricted Flyway logs and the journal, retain the
output and backups as evidence, and repeat conversion into a _different new_
destination. Never delete a gate merely to make startup succeed. A stale lock
requires verifying that its originating process and all writers are stopped; a
lock's age alone is insufficient. Do not reuse partial conversion output.

Cut over configuration only after complete validation. Set `STUDY_DB_PATH` to the
new `central.sqlite3`, personal directory to `users`, and remove the retired
`STUDY_ACCOUNTS_PATH`. Retain the original installation and backups until the
operator has verified the new installation and its backup policy.

## Provisioning and maintenance integration

`provision(central, template, directory, owner)` is the external provisioning
entry point in `scripts/database-admin.ts`. It verifies central compatibility and
account presence, then clones a trusted Flyway-generated template, binds the
canonical owner, validates it, fsyncs and installs with a no-replacement hard link.
The directory must be 0700; existing files must validate and be 0600. It must run
under the same externally enforced writer exclusion as maintenance. Ordinary
login/request code must not call it.
Both an already-existing file and a concurrent installation winner must have the
same Flyway audit identity/checksum as the trusted template. A merely compatible
legacy v4 file is not considered provisioned; adopt it through offline conversion.

Offline maintenance of the current managed fleet is available as:

```sh
node scripts/database-admin.ts maintain /synthetic/new-installation --offline
node scripts/database-admin.ts template /synthetic/empty-private-0700-directory
node scripts/database-admin.ts provision /synthetic/provision.json
```

Provision configuration has `central`, `template`, `directory`, and `owner` fields.
A control-plane job enumerates registered central account UUIDs and calls this
command explicitly; it must not run from a login handler. Both individual and
pending provisioning reject every RESTART_BLOCKED directory entry, including a
dangling symlink, and require a regular, nonlink READY file with exact contents.
An empty account list does not bypass these deployment checks. Coordinate all
provisioning and maintenance jobs with the operator's external process lock.

Maintenance preflights the complete current fleet, creates verified per-file
backups and a durable journal, then invokes Flyway sequentially. Failure retains
the gate and earlier success records. This revision supports only the current V1
Flyway catalogs; a future schema release must extend compatibility validation and
its recovery tests before it can be used here. Existing failed gates require
operator review and backup recovery with all writers stopped. There is no
automatic stale-lock deletion, repair, clean or checksum acceptance.

## Prototype follow-ups and release limits

The `dev/flyway`/`scripts/flyway-*` experiment is historical and is not a supported
deployment path. Production uses the combined central catalog and
`scripts/database-admin.ts`; it never uses the prototype's `hasProbe` retry rule.
This release accepts exactly Flyway V1. It deliberately refuses future migration
versions: it does not claim support for resuming a mixed V1/V2 fleet. Before any
real V2 release, add version-specific application contracts and an interrupted
mixed-version recovery test using an actual column/data change, with Flyway still
owning execution/checksums. No custom Node version dispatcher is introduced here.

Sequential Flyway process startup remains a fleet downtime cost. A supported
long-lived Flyway batch runner and its measurements are not delivered by this
change. Plan a stopped/drained maintenance window from measurements of the
actual deployment fleet; the prototype's small synthetic timings are not a
production outage budget. Existing historical conversion/ownership/cleanup tests
exercise supported legacy declarations; they are not an exhaustive survey of
every deployed schema lineage. Unsupported forms fail read-only preflight and
must receive explicit reviewed contracts and fixtures before conversion.

The review correction also exercised actual archived runtime code at
`fcf980bcc1f45e61a251cd3584fadb200e62a023`: a fresh v4 installation and a v2
installation created by `028a035dcf717a0f9d5badbafff962ab01721850`, upgraded and
physically separated by that later runtime. Both contained completed quizzes and
persisted evidence; the upgraded path retained an incomplete cleanup marker.
External conversion accepted both, preserved every personal snapshot/evidence
row exactly, and left all three original account/shared/personal files byte for
byte unchanged. These retained historical probes supplement the automated
legacy-contract tests; they are not a claim of exhaustive release coverage.
