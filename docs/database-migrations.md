# Standalone Flyway prototype

Standalone Flyway is the leading architecture. This prototype supplies evidence for
selecting its provisioning strategy; it does **not** select or integrate a production
implementation. All `src/` files, package manifests and runtime APIs remain identical
to `cdf94cffac5806b094a794940c8fdb8051dcaefb`. There is no Umzug, Sequelize, ORM,
login hook, request-time migration, or custom Node migration/version/history engine.

## Reproduce safely

Requirements: Linux/amd64 Docker, Node 24 (measured with 24.22.1), repository npm
dependencies. No global Flyway/JVM install or license is needed. The prototype uses
Community Edition without sign-in, with container networking disabled. It accepts
only its own private, marked scratch workspaces directly under the OS temp directory.
It has no command for migrating an arbitrary application data directory.

```sh
export PATH=/home/ttickle/.nvm/versions/node/v24.22.1/bin:$PATH
# Public image pull; do not change global Docker configuration.
docker pull --platform linux/amd64 redgate/flyway:13.11.1
docker image inspect redgate/flyway:13.11.1 \
  --format '{{json .RepoDigests}} {{.Os}}/{{.Architecture}} {{.Id}}'
node --test tests/flyway-files.test.ts
umask 077
flock /tmp/study-nest-final-check.lock \
  node scripts/flyway-prototype.ts experiment --offline > /tmp/flyway-experiment.log 2>&1
```

The experiment prints its scratch directory only on success. It contains the
Flyway-generated template and manifest, `results.json`, private CLI logs, a list of
fleet workspaces, maintenance journals, retained SQLite backups, and synthetic
personal files. Directories are 0700; logs, manifests, backups and installed
personal files are 0600. No database binaries or raw logs belong in Git. Retain the
scratch evidence for review; remove only these synthetic workspaces afterwards.

This host's default Docker configuration referenced an unavailable
`docker-credential-pass`. The public pull used an empty temporary `--config`
directory instead, with no credential or global configuration changes. Subsequent
runs use `--pull never` and the digest below, not a mutable tag.

## Image, driver and migration identity

Verified source image:

```text
redgate/flyway:13.11.1
redgate/flyway@sha256:b45087cccd267d326c5fd776bc06e9690e83509ce8bbf47acd65f1aa4a4b8b86
linux/amd64
Flyway Community Edition 13.11.1; bundled SQLite JDBC reports SQLite 3.50
```

The [official command-line documentation](https://documentation.red-gate.com/flyway/reference/usage/command-line)
documents the standalone distribution and this image tag. The
[SQLite driver reference](https://documentation.red-gate.com/flyway/reference/database-driver-reference/sqlite)
confirms the bundled JDBC driver and explicitly excludes concurrent SQLite
migrations and nested transaction statements. Versioned SQL contains no transaction
`BEGIN`/`COMMIT`; trigger `BEGIN ... END` blocks are SQLite trigger syntax.

Three separate Flyway locations contain immutable `V1__current_schema.sql` files:
`dev/flyway/accounts`, `shared`, and `personal`. They describe current schemas,
exported from disposable instances of the base revision. The personal owner table
exists but is empty in the SQL. Seeded rows are only empty-library state/cursors and
the independently versioned concept/certification markers. A separate
`synthetic-next/V2__prototype_probe.sql` exercises upgrades without pretending to be
an application feature.

Flyway version **1** means this prototype's current-schema baseline. It does not
replace account `application_id=1096242005/user_version=2` or library
`application_id=1096242004/user_version=4`. Synthetic V2 leaves those values intact.
The library transfer format remains v4. Keep these separate namespaces in a real
rollout.

The shared configuration disables `baselineOnMigrate` and `clean`, enables validation
and naming checks, and allows only pending scripts in `ignoreMigrationPatterns`.
That permits pre-upgrade validation with a pending V2 while refusing unknown applied
versions. The wrapper exposes only baseline, validate, migrate and info. It never
invokes clean or repair. Flyway owns its schema history and SQL checksums. A baseline
row does not checksum a pre-existing schema: our read-only structural check must run
before baseline, and the signed-off migration catalog must remain immutable.
Flyway checksum validation detects changed applied SQL; it is not a cryptographic
schema attestation or protection against someone who can rewrite database history.

## Adoption before any history write

`validateCurrent` opens the candidate read-only. It checks application identity and
the authoritative user version, then compares the complete supported table/index/
trigger catalog with a reference constructed from checked-in SQL. It also checks
column metadata, primary/unique/check constraints, index columns and uniqueness,
foreign keys, independent marker rows, `integrity_check`, and `foreign_key_check`.
The shared cleanup marker is optional because deployed v4 databases can predate its
creation; when present its exact schema and singleton value are checked. Unknown
objects and missing evidence triggers are refused rather than silently repaired.
Flyway metadata is excluded from this application schema comparison and validated
by Flyway itself.

Personal validation requires a canonical server-internal lowercase UUID and an
exact singleton owner match, read-only before backup/baseline/migration writes.
The explicit unbound mode is restricted to template verification. Tests prove
refusals leave the database bytes unchanged. Files and all path ancestors must be
real, non-symlink objects; provisioning never overwrites an existing owner file.

**Legacy boundary:** this prototype adopts only current accounts v2 and library v4
schemas (including already-installed concept/certification/evidence schemas). It
rejects account v1 and library v1/v2/v3, foreign identities and future versions before
Flyway history writes. No legacy migration coverage is claimed. Before production
rollout, implement and test separate reviewed Flyway upgrades: concepts and
certifications must exist before the v2 ownership copy; occupied legacy study data
requires an explicitly verified previous owner; v3 visibility and existing evidence
rows/triggers must survive. Never baseline those older layouts as current or infer
ownership from the first login. Existing deployed migration routines remain intact
at this checkpoint.

## Personal provisioning outside requests

`generateTemplate` runs actual Flyway `migrate validate` into a new empty personal
database, then verifies schema identity, the single successful SQL history row,
empty owner/content/history/evidence tables, and exact initial singleton rows. It
seals a manifest containing the pinned image, SHA-256 of the personal migration
catalog plus config, whole database hash, structural schema hash and Flyway audit
identity hash. Adding/removing/editing a personal migration, changing config or
image, corrupting the file, or changing its history invalidates the artifact.

The manifest is not a signature: both template and manifest must be protected
release artifacts. Flyway-generated history timestamps/installer identity are
copied from template generation; they do not claim an individual user migration
ran at provision time. A later migration must regenerate the template and update
the supported schema contract; a synthetic V2 template is deliberately unsupported.

`provisionTemplate` verifies the artifact, copies into a same-directory random
`.provisioning-*.sqlite3` temporary file, sets 0600, binds the trusted internal owner
with a parameterized insert, closes SQLite, verifies owner/schema/integrity, fsyncs
the file, hard-links without replacement, and fsyncs the directory. The temporary
file is removed in `finally`. A concurrent existing winner is validated, never
replaced. Existing wrong-owner files and symlinks are refused unchanged. Existing
valid files can be returned idempotently. The fresh-Flyway measurement uses the same
owner validation, file flush and no-replace installation contract.

A production control-plane job or explicit operator provisioning command would
perform this work before enabling a new account's study workspace. How login waits
for or reports provisioning remains a separate product decision. There is no
change to login, `PrivateLibraries.open()`, repositories or request handling here.
The unchanged runtime still has its original schema initialization behavior; this
prototype does not claim that work has already moved out of it.

## Offline fleet maintenance and recovery

The operator must stop admission, drain requests and housekeeping, close application
connections, and exclude CLIs/other writers before maintenance. `--offline` is an
explicit acknowledgement, not automatic proof that another process has stopped.
A workspace lock rejects overlapping prototype runs. Flyway provides no safe
concurrent SQLite migration contract, so both central databases and canonical
personal filenames are processed sequentially, with no per-file parallelism.

The runner creates `RESTART_BLOCKED`, inventories accounts/shared/personal files,
and preflights the **whole fleet** before the first history write. Each file gets a
unique retained backup using Node's SQLite backup API, including committed WAL
pages; a live-WAL unit test proves this. It verifies the backup before Flyway
baseline/validate/migrate/validate, verifies schema, integrity, owner and unchanged
application rows afterwards, then records success/failure in a restricted JSONL
journal. Only a completely successful sweep removes the restart gate. The failure
experiment upgrades both central databases, fails a personal V2 after a DDL
statement, verifies rollback of that file's schema and Flyway history, retains the
gate and earlier successes, then retries successfully without clean/repair.

Cross-file upgrades are **not globally transactional**. A journal success on one
file cannot roll back a later failure elsewhere. Keep the app stopped; inspect the
journal/logs and backups, correct the failed immutable-yet-unapplied migration in
this disposable experiment, and retry. Real published migration edits need their
own release policy: never modify a successfully applied migration. For a real
restore, preserve failed artifacts and sidecars, use the verified SQLite backup,
restore while all writers are stopped, and coordinate central/personal compatibility
as one release. Do not copy an open main file while ignoring WAL. Retain backups
until the release and its rollback window are accepted. Journals/gates in this
prototype are process recovery aids, not a power-loss-tested fleet coordinator.
The application does not read this gate; deployment tooling must enforce it before
restart in a production implementation.

Existing cross-database study transfer remains an attached-database transaction.
Do not decompose that atomic copy/delete into independent Flyway migrations or
fleet steps. Preserve owner guards, recovery markers, DELETE journaling,
`secure_delete`, and the retryable post-transfer VACUUM that removes freed shared
study pages before serving HTTP. VACUUM is physical cleanup outside a schema
migration transaction. The account/shared/private release protocol must finish
transfers and cleanup before restart; backups contain sensitive study data and
need the same private retention controls. None of this production code is rewritten
by the prototype.

## Measurement method and decision boundary

The experiment records three samples of fresh Flyway provisioning versus
clone/bind/install, three no-op validations, and three fleet samples each with 1
and 10 personal databases **plus two central databases**. It separately records
current-schema adoption, next-version upgrade, and each verified backup's time and
bytes. Fleets contain 1 synthetic account/session, 100 shared questions, and 25
attempt/evidence pairs per personal file. These are preservation fixtures rather
than production-size scored quiz payloads. No production data or live ports are used.

Every Flyway duration includes Docker process/container and JVM startup. Image pull
is excluded. The first template-generation sample is the first container in that
experiment after the image is present; it is not a rebooted/disk-cache-cold host.
Subsequent samples are warm-image/cache runs. Clone timings include template hash
and structural checks, owner binding, final validation, fsync and atomic install;
template generation is amortized separately. Backup measurements include API copy
and post-backup verification, and bytes describe backup files rather than deduced
live-data size. RSS is not measured. Do not infer latency SLAs or large-fleet scaling
from these small local samples.

## Results: 28 October 2026

Host: Intel Core i5-8265U @ 1.60 GHz, 8 logical CPUs, 33,361,731,584 bytes RAM,
Linux 7.0.0-38-generic, Docker 29.9.2, Node v24.22.1, linux/amd64. Image pull was
excluded. The first template-generation container took **4.266 s**, including
validation/sealing, and produced a **135,168-byte** template. It was an image-present
run, not a rebooted host or an uncached image pull.

| Operation                                       | Sample 1 | Sample 2 | Sample 3 |   Median |
| ----------------------------------------------- | -------: | -------: | -------: | -------: |
| Fresh Flyway + bind + atomic install            |  5.191 s |  5.765 s |  4.476 s |  5.191 s |
| Template clone + verify + bind + atomic install | 18.00 ms | 14.63 ms | 14.04 ms | 14.63 ms |
| No-op Flyway validate                           |  5.114 s |  4.926 s |  4.549 s |  4.926 s |
| Adopt current schema, 1 personal + 2 central    | 15.114 s | 17.138 s | 14.480 s | 15.114 s |
| Adopt current schema, 10 personal + 2 central   | 63.953 s | 60.335 s | 53.960 s | 60.335 s |
| Synthetic upgrade, 1 personal + 2 central       | 17.091 s | 15.651 s | 13.797 s | 15.651 s |
| Synthetic upgrade, 10 personal + 2 central      | 70.571 s | 64.398 s | 60.112 s | 64.398 s |

| Verified backups per fleet sweep | Total bytes | Total copy + verification, samples 1 / 2 / 3 |
| -------------------------------- | ----------: | -------------------------------------------: |
| Current-schema adoption, 3 DBs   |     278,528 |                     30.12 / 27.02 / 25.05 ms |
| Next-version upgrade, 3 DBs      |     315,392 |                     27.76 / 30.41 / 26.50 ms |
| Current-schema adoption, 12 DBs  |   1,384,448 |                  123.85 / 129.14 / 131.43 ms |
| Next-version upgrade, 12 DBs     |   1,531,904 |                  139.73 / 117.00 / 116.24 ms |

Individual verified backups ranged from 5.34 to 25.32 ms and 28,672 to 139,264
bytes across these fixtures. History adoption increases subsequent backup size.
The committed [measurement data](flyway-prototype-results.json) contains every
recorded timing and the host/image identity. Original private evidence remains
under `/tmp/study-flyway-evidence`; the successful experiment workspace was
`/tmp/study-flyway-prototype-8VG5H4`. Its manifest records the template database
SHA-256 `5f7e51535789a62a9eab0ad8173d421273c8f33df51b94166e60e8d48f58d2fc`.

The timing sweep preceded final duplicate driver-level pre-baseline validation and
journal safety guards. These add read-only checking/journal writes to adoption;
the fresh provisioning, upgrade SQL and Flyway command sequences were unchanged.
A separate final-source Docker smoke exercises those amended paths. Treat these
as planning measurements, not an exact production release benchmark.

Six actual Docker controls passed: corrupt template refusal, stale template refusal,
DDL/history rollback followed by successful retry, applied checksum mismatch refusal,
unknown applied version refusal, and partial-fleet failure/restart gating followed by
successful retry. Filesystem tests separately cover owner/identity/schema refusal,
WAL-aware backups, no-replace install, symlink refusal, legacy-version refusal and
concurrent-maintenance lock refusal.

**Recommendation for the next review:** retain standalone Flyway as selected by the
user and favor the generated-template provisioning prototype. It removes a measured
multi-second process startup from first-user provisioning while preserving Flyway
history and an explicit owner-bound atomic install. Generate and validate the
artifact once per schema release; provision outside requests. Keep fleet upgrades
as a separate offline sequential release step. In these small fixtures, repeated
CLI/JVM startup dominates backup and SQL work; even no-op validation has a visible
per-database cost. Investigate standalone CLI/container batching only if measured
fleet downtime requires it, without replacing Flyway's migration ownership.

This recommendation does not authorize production integration or settle the final
implementation. Before selection, review genuine legacy upgrades and explicit owner
attribution, deployment-enforced drain/restart gates, artifact trust/distribution,
realistic database/backup sizes and retention, downtime targets, and recovery from a
partially completed cross-file release. There is no large-fleet or latency guarantee.

## Executed verification and review state

- `npm run check` passed: format, lint, 311 source/web tests, 190 compiled tests,
  type checking, server build and Vite build. The 10 new filesystem/schema tests
  are included. Heavy runs used `/tmp/study-nest-final-check.lock`.
- The Docker experiment completed all three samples and six negative controls.
  A separate final-source Docker smoke passed baseline owner guards, verified-backup
  journaling, partial failure/restart gating, schema/history rollback and retry.
- `git diff --exit-code cdf94cff -- src package.json package-lock.json` passed.
  No production source or dependency manifest changed. No database binaries are staged.
- Redacted Gitleaks staged scanning found no leaks. Restricted red/green and Docker
  logs are retained locally; raw logs are not published.
- `npm ci` still reports one moderate advisory with unchanged package manifests.
  No audit fix, global installation, license, or system-setting change was performed.
- Independent review is pending with the parent agent. Keep the PR in draft.
  Implementation provenance: GPT-6.1 Sol, medium reasoning effort.
