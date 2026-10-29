# Historical migration coverage after runtime initialization removal

These tests exercise external administration. They do not restore initialization,
legacy-format exceptions, or provisioning to server code.

`legacy-database-fixture.ts` creates fresh synthetic deployed schemas from the
checked-in `dev/flyway` catalogs. `LegacyLibraryFixture` exposes domain queries
through `LibraryView` only for explicitly prepared historical files. Reopening
never creates or repairs a file. The fixed v3 layout builder is test fixture
materialization, not an application migration engine.

Personal unit fixtures use `prepareManagedDatabase` and explicit
`provisionAndOpenFixture` preparation before `PrivateLibraries.open`. Existing
wrong-owner or malformed files are not repaired. The test-only history simulation
is confined to these unit fixtures; conversion tests use actual pinned standalone
Flyway, including its real schema history and checksums.

| File                                | Cases | Preserved guarantees and new boundary                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private-study-migration.test.ts`   |    15 | External attached transfer: failed DETACH restoration; real child exit 23 rollback and retry; failed deletion with FAST restoration; unique and ambiguous provenance; destination WAL/version/application ID/missing table refusals; lock recovery; owner isolation, question identities and revision; transaction rollback, conflicting evidence and wrong-owner refusal; source WAL refusal; v2/v3 physical cleanup and interrupted cleanup. |
| `study-ownership-migration.test.ts` |     2 | Real external preflight/conversion with canonical UUID accounts: absent, blank or unverifiable owner refuses without changes/output; verified owner retains saved quizzes, questions, revision, mastery and certifications; Bob remains isolated, including reopen; a spoofed v2 marker cannot reassign scoped records.                                                                                                                        |
| `flyway-files.test.ts`              |    10 | Historical prototype schema adoption remains read-only; exact schema/markers/indices/triggers, owner, future/foreign/legacy formats, WAL-aware backups, no overwrite, trusted templates, corruption/staleness, links, private permissions, atomic installation, offline acknowledgement and exclusive maintenance refusals.                                                                                                                    |

The old startup tests expected historical input files to be modified and scrubbed.
The authorized conversion contract now requires those original inputs to remain
byte-for-byte unchanged. The two physical-cleanup cases therefore assert removal
of attempt bytes from the **converted central** file and retention of original
shared/accounts bytes. They verify ten completed attempts survive in the personal
output and that subsequent external maintenance is idempotent.

The v3 interruption is injected at the external Node VACUUM boundary, after the
attached transfers commit. A test-only cache artifact is inserted and deleted with
secure_delete OFF at that boundary to represent genuinely retained old free-page
bytes in the staging file. This is necessary because fresh-schema row import does
not copy the original input's freelist pages. The test verifies those bytes remain
in the interrupted output, the separation marker remains incomplete, the restart
gate remains, READY is absent, and all ten attempts have transferred. Partial output
cannot be reused: recovery converts unchanged originals into a different new
destination. No power-loss or fleet-wide atomicity guarantee is inferred.

All heavy real-Flyway runs use `/tmp/study-nest-final-check.lock`. The historical
prototype tests do not regenerate performance measurements or claim new benchmark
results. Test logs are retained outside Git with private permissions.
