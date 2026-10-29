# Database administration

The server must never create, upgrade or convert database files. The current SQL
catalogs are `database/migrations/central` and `database/migrations/personal`.
Standalone Flyway 13.11.1 is pinned by image digest in `scripts/database-files.ts`.
Docker calls use `--pull never --network none`, a read-only SQL mount, and one
explicit writable output directory. Protect the SQL catalog and template manifest
as trusted administrative artifacts; a hash is not a signature.

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
and future formats, symlinks and an existing destination.

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

Offline maintenance of the current managed fleet is available as:

```sh
node scripts/database-admin.ts maintain /synthetic/new-installation --offline
node scripts/database-admin.ts template /synthetic/empty-private-0700-directory
node scripts/database-admin.ts provision /synthetic/provision.json
```

Provision configuration has `central`, `template`, `directory`, and `owner` fields.
A control-plane job enumerates registered central account UUIDs and calls this
command explicitly; it must not run from a login handler. Coordinate all
provisioning and maintenance jobs with the operator's external process lock.

Maintenance preflights the complete current fleet, creates verified per-file
backups and a durable journal, then invokes Flyway sequentially. Failure retains
the gate and earlier success records. This revision supports only the current V1
Flyway catalogs; a future schema release must extend compatibility validation and
its recovery tests before it can be used here. Existing failed gates require
operator review and backup recovery with all writers stopped. There is no
automatic stale-lock deletion, repair, clean or checksum acceptance.
