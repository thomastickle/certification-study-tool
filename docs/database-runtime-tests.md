# Prepared database runtime coverage

Runtime fixtures prepare current synthetic catalogs outside `src/server`, using
`tests/managed-database-fixture.ts`. Its explicit test-only Flyway history row is
not evidence of real Flyway execution; administration integration owns that proof.
The helper refuses an occupied fresh-schema target and never upgrades it.
Compiled fixtures use catalogs copied to `build/database/migrations`, outside the
runtime image's copied `build/src` and `build/docs` trees.

HTTP harnesses log in through OIDC, read the verified account mapping, and then
simulate external provisioning before study requests. The pending-workspace HTTP
case disables that harness step and asserts 503 plus absent storage paths after
login and repeated requests. No application login hook provisions files.

Assertions formerly coupled to constructor migrations are split at the boundary:

- `quiz-persistence.test.ts` retains prepared content/ID stability, saved snapshots,
  import tickets, source-deletion provenance and reopen assertions. Administration
  legacy conversion tests own v1 adoption and upgrades.
- `accounts.test.ts` retains IDs, default student roles, stored role/session hashes,
  issuer isolation, restart and revocation. Legacy role upgrade belongs to admin.
- `private-housekeeping.test.ts` prepares owners before starting the child. It
  retains damaged-owner isolation, continued expiry/reconciliation, sanitized logs
  and physical-byte preservation; incomplete external separation blocks startup.
- Compiled runtime cleanup faults target remaining connection setup and upkeep,
  replacing removed startup mapping/chmod/transfer faults. The externally prepared
  owner case retains startup expiry, isolation and permissions assertions.
- Projection tests retain raw SQL invalidation, malformed-row repair, rollback,
  lifetimes and replay equality. A missing projection table must fail even across
  rollback; neither constructors nor reads may recreate it.
- The foreground benchmark provisions synthetic owners before listening, retains
  real Nest cookie admission, counts, scoring, provenance and cleanup checks, and
  asserts missing projection storage fails. It no longer measures runtime schema
  creation. No new latency claim is made.

Docker smoke fixtures prepare synthetic host files before starting the server
image, then provision newly verified accounts in the harness. The server image
contains neither Flyway nor migration SQL. Full conversion and maintenance-command
proof remains at the external administration boundary.
