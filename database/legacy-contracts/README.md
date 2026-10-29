# Read-only legacy schema contracts

These frozen declarations describe the supported pre-consolidation accounts v1/v2
and shared-library v1–v4 layouts. They are validation references, not a migration
catalog. Administrative validation loads them into an in-memory SQLite connection
and compares each input role's complete declarations, columns, constraints, indices
and foreign keys before any conversion output is created. Never apply these files
to an input database.

Early independent concept/certification extensions must be complete groups.
Account-owned v3/v4 files may have the complete derived-evidence extension or none;
preownership layouts must not contain that later cache. A known shared cleanup
marker is accepted only with its exact schema and singleton value. Unknown tables,
views, triggers, indices, columns or constraints are refused. Names resembling
SQLite internals are not exempt unless they use SQLite's reserved literal prefix.

Personal v4 references use the current personal migration catalog, since that
application format is unchanged. Managed personal history must match the pinned
Flyway Community 13.11.1 SQLite audit layout and supported successful V1 record;
Flyway itself validates its checksums on a staging audit copy before import.
Unmanaged legacy auth/shared inputs have no Flyway history. A future supported
release needs explicit contracts and real conversion/recovery tests.

SQL-token comparison normalizes declaration formatting and identifier quoting,
while preserving string literals. Reference SQL and SQLite metadata together
check semantics that column-name-only validation would miss. Import permission
comes from the validated input role, never from membership in the combined target.
