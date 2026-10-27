# Persisted study evidence (#81)

The target is **under 300 ms, preferably under 200 ms**, for normal large-history
quiz-start and due HTTP reads. First-use, rebuilds and contention are reported
separately. These are synthetic engineering targets on recorded hardware, not
production guarantees. Refs #81; parent independent review remains required.

## Design and tradeoffs

The pre-edit design is retained in private evidence. Choose compact validated
per-attempt events before aggregate mastery. They remove repeated full-snapshot
JSON decoding, content normalization and identity hashing while preserving ordered
replay after earlier-attempt deletion/restore. An aggregate-only cache needs
additional invalidation/replay logic for those noncommutative transitions.
A focused aggregate JSON decode lower bound is measured for comparison; it is not
an implemented aggregate cache with equivalent recovery/mutation costs.

`quiz_sessions` remains authoritative and unchanged. The additive `quiz_evidence`
table stores a version, exact certification pair, attempt/time and ordered tuples
of validated identity, answered/correct/confidence/unknown evidence. It contains
no original question text, answers or untrusted fingerprint cache keys. Unknown
encounters and duplicate ordering retain full replay semantics. Namespaced source
provenance stays in the snapshot; content identities retain existing certification
scope and normalization. Source removal never deletes events or due obligations.

Every snapshot INSERT/UPDATE/DELETE has an SQLite invalidation trigger. This also
covers direct provenance annotation, existing legacy transfers and standalone SQL
writers. `QuizRepository.save` uses a savepoint around snapshot plus projection
replacement, even outside a caller-owned transaction. It derives from the exact
serialized snapshot, preserving JSON normalization. Enclosing completion, expiry,
delete/restore and library transactions keep ownership and roll back both rows.
Annotation writes proactively replace projections. Private transfer copies only
authoritative snapshots; destination invalidation and lazy reconstruction avoid
trusting the source's derived data. Shared physical cleanup also discards orphaned
projections after a legacy table replacement before the existing VACUUM gate.

Connection initialization installs the additive table/triggers without a history
scan. The authoritative schema/transfer version remains 4; derived extraction and
wire format have their own `evidenceVersion = 1`. Bump it when identity/scoring
validation or serialization rules change. Mastery rules have no persisted aggregate:
reads always run current replay, so rule changes cannot trust stale mastery state.
One immutable fixed-timezone formatter and a request-local timestamp/day map avoid
rebuilding ICU formatters for every answered encounter. Calendar/DST rules are
unchanged.

Missing/version-mismatched rows rebuild under a savepoint on first use. Each small
payload has a SHA-256 checksum binding account, row ID, extraction version, exact
scope and data. Corrupt rows rebuild from their exact authoritative row. Integrity
is checked before certification filtering, so corrupt scope cannot hide obligations.
SQL narrows by authenticated account and completed status; all of that account's
compact rows are integrity-checked before exact certification filtering. This
conservative choice preserves invalid legacy-scope errors, rather than relying on
SQLite JSON coercions or silently hiding malformed records. It leaves work linear
in account event count. No full snapshot scan/hashing occurs on normal reads.
Malformed legacy projections have explicit fallback sentinels; reads retain the
original authoritative replay/error boundary. Failed reconstruction propagates and
rolls back; it never produces an empty authoritative-looking summary.

The checksum detects accidental corruption, not a malicious database administrator
who can replace both snapshot and checksum. Database files remain trusted private
application storage. Missing schema is recreated on connection initialization;
live schema tampering is not an availability guarantee. No worker, framework,
provider, connection-ownership or engine change is included.

## Reproduction and ongoing tracking

Use [the performance ledger](performance-ledger.md). Keep exact source revisions,
common harness patches/manifests and raw logs private; publish sanitized aggregates.
All benchmark files/databases are synthetic and ephemeral, with OS-selected
loopback ports. No authentication provider or running user application is needed.
