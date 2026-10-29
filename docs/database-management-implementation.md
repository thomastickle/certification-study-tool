# Managed database implementation

The user has selected standalone Flyway, one combined central SQLite database, and
external provisioning of personal databases. This extends the reviewed prototype;
it is not permission to run a conversion on existing local data. The local
conversion must wait until the complete work is merged into master.

## Ownership and format contract

- Work branches descend from the Nest conversion, not master. The integration
  branch is `t3/central-database-management`; no master merge or deployment is
  authorized. Preserve the reviewed #98 and #99 logical commits.
- The central database contains accounts, sessions and shared-library tables.
  Keep existing table names: SQLite has no separate named schemas within one file.
  Authentication and library modules remain distinct query owners.
- Assign the combined central format `application_id=1096242006`, `user_version=1`.
  Its new identity prevents an old server from mistaking it for an old shared DB.
  Flyway owns schema history independently of these application compatibility IDs.
- Personal files retain `application_id=1096242004`, `user_version=4` and a required
  canonical internal UUID owner. A personal file must never be opened centrally.
- The central schema may retain empty legacy study tables where shared repository
  views require their structure; all actual personal history belongs in private
  files. The shared-study separation completion marker must be installed and set
  only by the external conversion/provisioning workflow.
- Current versioned SQL lives under `database/migrations/central` and
  `database/migrations/personal`; tooling, templates and one-off legacy migration
  code live outside `src/server`. Server compatibility checks must not load or run
  those migration files. The existing `dev/flyway` prototype remains historical
  evidence, not a second production migration catalog.

## External administration

Use the actual pinned standalone Flyway CLI/container for DDL, migration versions,
checksums and transactional schema upgrades. Thin file/backup/provisioning tools
must not become a second Node migration engine. Commands must explicitly select
source and destination directories, support a reviewable preflight, and fail closed.

Convert copies of the old accounts/shared/private fleet into a new deployment
layout. Keep originals intact, make verified WAL-aware backups, and publish no
usable result until the whole conversion validates. Preserve account IDs, external
identity mappings, hashed sessions, stored roles, bank/question IDs, concepts,
certifications, all quiz snapshots/evidence and deletion cursors. Legacy accounts
v1 roles default to student. An occupied legacy unowned history needs an explicitly
verified previous owner; never assign it to the first login.

Real supported legacy upgrades and adoption must be tested against deployed
fixtures, not merely the synthetic V2 probe. Retain attached-database transaction
ordering, rollback/retry, DELETE journaling, secure deletion and physical VACUUM
where shared history is separated. Move that one-off code outside the server.
Flyway's SQLite scripts cannot nest transaction BEGIN/COMMIT statements; do not
split a required atomic cross-database data transfer into independent migrations.

Generate and validate the current empty personal template with Flyway. External
provisioning verifies the trusted template, checks the account exists centrally,
binds its canonical owner, and installs a same-directory 0600 temporary file
without replacement. Preserve real-directory checks, 0700 directories, owner
validation, fsync, corruption/staleness refusal and idempotence. Provisioning may
be a separate control-plane command/job; it is not executed by login or a request.

Fleet schema upgrades require stopped/drained application and CLI writers,
exclusive maintenance, verified backups, a durable progress journal and an
externally enforced restart gate. A failed file retains the gate and prior
success records; there is no global cross-file transaction. Specify recovery and
stale-lock handling explicitly. First conversion must also exclude old servers
which do not know the new maintenance protocol. Use synthetic fixtures only now.

## Server behavior

`STUDY_DB_PATH` selects the one central file (new default
`private/app/central.sqlite3`). Authentication reads the same path. Retire
`STUDY_ACCOUNTS_PATH` explicitly rather than silently ignoring an old separate
path; provide a clear conversion/configuration error. Personal directory selection
remains explicit and owner-bound.

The server opens existing prepared databases and performs read-only compatibility,
ownership and maintenance-readiness checks. Missing, legacy, future, foreign or
incomplete central databases fail startup with an actionable admin command.
Missing personal databases yield a clear workspace-not-provisioned response;
login may map a verified identity and issue a session, but never creates a personal
file. Normal account/data inserts are application work, not schema initialization.
The external provisioning job can subsequently enable the workspace.

Remove CREATE/ALTER/DROP schema SQL, schema PRAGMA writes, lazy evidence schema
initialization, private-file auto-creation and startup study transfers from the
server import graph. Keep evidence extraction/repair, normal transactional writes,
private request ownership and security/body/error contracts unchanged. The local
server must not spawn Flyway, import admin modules or repair a missing schema.

## Tests and delivery

Use a shared test-only fixture helper to prepare synthetic central/personal
schemas from the new SQL outside server code. Tests need not launch a JVM for each
unit fixture. Real Flyway integration tests separately prove the production
catalog, templates and administration commands. Preserve observable assertions
while moving migration-specific tests to the external boundary. Existing native,
compiled HTTP/OIDC, lifecycle, benchmark and Docker workflows must use explicitly
prepared data. Add a source/import-graph assertion that schema administration
cannot creep back into `src/server`.

Implementation lanes: administration owns `database/**`, external tooling and its
safety/legacy tests; runtime owns `src/**`, runtime fixtures/HTTP/lifecycle tests,
configuration, packaged startup and benchmark callers. Coordinate shared fixture
names and SQL paths through the overseer. Neither lane publishes independently;
return scoped local commits for integrated verification and an independently
reviewed PR against `t3/nest-conversion`. No user database, environment, volume or
live service is to be changed before the post-master local conversion.

### Administration lane implementation notes

The admin entry point is `scripts/database-admin.ts`: `init`, `preflight`, `convert`,
`template`, `provision`, `provision-pending`, and offline `maintain`. Conversion
creates fresh Flyway V1 schemas and imports legacy rows, rather than baselining
legacy files or applying Node schema version dispatch. Original inputs remain
untouched. Owner transfers and physical cleanup live in `database/tools/legacy`.

Publication contract: the central parent directory contains `READY` with exact
`1\n` only after complete fleet validation. `RESTART_BLOCKED` overrides readiness;
`maintenance.lock` excludes cooperating administrative jobs. All writers and old
servers still require external operator stop/drain and restart exclusion. Failed
conversion is abandoned and retried into a different output directory, retaining
its snapshots and journal. Current fleet maintenance validates and backs up each
file and retains the gate on any failure; a future schema revision needs matching
compatibility/recovery support before this command accepts it.

Historical fixture setup now lives outside server code. Transfer assertions target
external administration; runtime tests use explicit managed fixtures. Fresh native
and Docker-volume bootstrap use the real standalone `init` command. Integrated
verification and independent review remain release gates.
