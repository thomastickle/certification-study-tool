# Shared banks and private libraries

Everyone can study shared banks. Only application administrators can import,
update or delete shared content. Every user can import, update and delete their
own private banks, including reviewed concept groups. Update a bank by editing
its version 2 JSON and importing it again; the preview requires explicit approval
of changed questions and metadata. There is no automatic copying or publishing.

In **Library**, choose **My private library** or **Shared library**. The private
view is the default. Switching views discards the former preview and selection.
Practice lists both authorized libraries and labels each bank Private or Shared.
The same source key or numeric database ID can exist in both libraries without
mixing their contents. Older shared IDs remain numbers; combined practice uses
`private:<local-ID>` for private sources. These IDs never select another account.

## Storage and authorization

The standard Docker volume contains:

```text
/data/central.sqlite3              identities, hashed sessions, shared banks and deletion events
/data/READY                        exact external readiness marker: 1 followed by newline
/data/users/<internal-ID>.sqlite3   private banks, attempts, mastery, earned certifications
```

Native defaults use `private/app/` instead of `/data/`. The optional
`STUDY_PRIVATE_LIBRARIES_DIR` changes the user-file directory. Keep it on persistent
local storage, inside the backed-up application volume. The directory is mode
0700 and user databases are mode 0600. Git ignores the private directory and
SQLite files; never add real banks, histories, credentials or volume exports.

The server chooses the file from its verified internal account ID, never from
a request path, query, role, display name or bank payload. Each file contains an
owner marker. A copied foreign file, symlink or private file configured as the
shared database is rejected. Each request owns and closes its private connection.
Anonymous and stale-workspace requests cannot create or open user files.

Routine expiry and shared-deletion reconciliation isolate failures per account.
A damaged private file is never replaced or repaired automatically. Its canonical
internal account ID is logged without database errors or study content. Other
accounts remain available, and later housekeeping passes retry the failed account. Directory
discovery failures are also logged and retried. Incomplete external separation or maintenance blocks startup rather than serving a partially separated layout.

The first upkeep pass reconstructs timers from persisted files before HTTP starts.
Thereafter, a one-second tick opens only owners whose known active-attempt or
48-hour retention deadline is due. Every five seconds, a full discovery and
reconciliation pass also opens idle owners, discovers new files, retries damaged
files and applies shared-deletion outbox events. Idle owners are not opened on
intervening ticks. Attempted mutation requests refresh timer metadata from their own
connection in request cleanup, covering create/resume/pause/abandon and result
delete/restore even if the response fails. GET/HEAD requests skip this JSON metadata
query: lazy expiry during reads cannot create an earlier deadline. Paused attempts
have no expiry deadline.

Both discovery sweeps and simultaneously due cohorts yield to the event loop after
each owner, after closing its private connection. Known deadlines are checked before
each next owner, so newly observed or newly due work can run while a sweep progresses.
Overlapping ticks share one running promise and coalesce into a follow-up check,
without concurrent sweeps or queued copies of every tick. Failed owners retry on a
later tick; discovery failures retain known deadlines and retry at the next cadence.
Startup validates externally prepared storage and awaits the recovery pass before listening. Shutdown
cancels unstarted owner work and drains the pass before closing the shared root.

This bounds a processing slice to one owner's synchronous work, not a fixed time
budget. One owner's open/verification, deletion reconciliation, scoring, purge or
metadata query can still block for an arbitrarily long time. Directory enumeration
and in-memory deadline selection also remain synchronous. This change does not
batch snapshots within one owner or redesign broader import/query work in #67.

Known deadlines run on the first available one-second tick after their persisted
wall-clock deadline; unattended changes made by another process and shared
provenance events are recovered on the first available five-second pass. Startup
also recovers missed scoring, retention purges and deletion events after downtime.
The five-second cadence uses monotonic elapsed time, so wall-clock adjustments
do not postpone reconciliation. Quiz and retention timestamps still follow the
server wall clock, as foreground operations do. These are scheduling cadences,
not hard latency bounds: synchronous SQLite work, busy timeouts and event-loop
load can delay either pass. Total reconciliation work remains proportional to
owner count, with a yield between owners. At most one background private
connection is open at a time, and no connection pool is retained.

History is private even when its questions came from shared banks. Private
question snapshots never enter the shared database. Shared deletions append a
public bank-provenance event atomically with deletion. Each private database
reconciles those events before reads; an event cursor makes this repeatable after
restart. Private deletion annotates saved attempts in the same private transaction.
Neither operation removes saved answers or grades. Due obligations can remain
unavailable after their bank is removed, as before.

## External preparation and upgrades

The server never initializes or upgrades schemas, transfers history, or provisions
personal files. Prepare or convert a stopped deployment using the external
[administration workflow](database-management.md). Accounts and shared content use
one central file; all actual personal study history stays in separate owner-bound
files. Login creates only normal account/session records. An unprovisioned workspace
returns 503 until the external job installs its personal file.

The deployment root requires exact `READY` contents `1\n`. Any `RESTART_BLOCKED`
path overrides readiness, including for custom personal directories. Operators must
stop and drain application and CLI writers before administration. Existing user data
conversion is deferred until the complete change merges into master.

## Settings boundaries

This release does not move or introduce preference storage. Theme, palette and
sidebar layout stay browser-local; remembered certification stays account-keyed
in browser storage.

| Location for future user settings | Benefits                                                                       | Costs                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Individual database               | Physical user boundary; library/study preferences travel with that user's data | Migrations across many files; restoring a library can restore older preferences |
| Central account-scoped store      | One migration; preferences remain independent of library restoration           | Every query needs account scoping; a user's complete backup spans stores        |

Prefer the individual file for library/study settings, central storage for
identity/session security and application defaults, and browser storage for
device-specific presentation. Server-side preference synchronization is separate
future work.

## Synthetic housekeeping measurements

Run with the supported Node 24 executable and existing dependencies:

```sh
umask 077
node tests/housekeeping-benchmark.ts baseline > /restricted/path/housekeeping-baseline.log 2>&1
node tests/housekeeping-benchmark.ts scheduled > /restricted/path/housekeeping-after.log 2>&1
```

Use an existing mode-0700 output directory outside Git; logs must be mode 0600.
The baseline reproduces the successful per-second path at `0ee670f` without the
new metadata query. The harness creates disposable synthetic SQLite files and
removes them on exit. Each owner has ten completed 20-question snapshots; 20% also
have an active attempt due at simulated second three and another 20% have a
retained deletion due at second four. A shared deletion event exercises the
current outbox-to-private-annotation path, including idle-owner histories.
Assertions verify scoring, purging and every owner's deletion cursor in both modes.

Twenty ticks advance injected wall/monotonic time by one second each, awaiting each
complete pass without sleeping a second between ticks. A repeating one-millisecond
timer probes latency throughout all batches and drains after the final slice; the
reported maximum is the observed timer gap, including the timer resolution floor.
JSON separates full-pass elapsed time from summed synchronous owner/discovery
operation time (which excludes scheduler overhead), and reports the largest owner
operation, startup/recurring timer maxima, sample counts, discovery/open counts and
peak/live owned background connections. The timer probe is an observation of event
loop stalls, not a precise attribution to housekeeping or a hard slice budget.
Setup and result verification are excluded. Run modes sequentially on the same
machine; timing is machine/load/cache dependent and is not a test threshold.
For 10/100 owners the deterministic open counts are 200/2000 before and 44/440
after, with 20 versus four discoveries and a peak of one owned connection.
This measures housekeeping only. It does not resolve broader import/query work
in #67, and the former cross-account central-snapshot model no longer applies.

A sequential Node 24.17.0 run on 2026-10-26 compared the original baseline,
exact parent `165d72c`, and owner-batched implementation using the updated continuous
probe. At 10 owners, maximum recurring timer gaps were 17.93 / 13.91 / 11.52 ms;
at 100 owners, 221.11 / 154.88 / 10.22 ms. Total recurring operation time was
141.61 / 50.07 / 43.58 ms (10 owners) and 1661.58 / 619.26 / 396.32 ms (100 owners).
Full recurring pass elapsed totals were 142.10 / 50.64 / 45.23 ms and
1665.04 / 621.14 / 407.73 ms respectively. Batched maximum recurring owner operations
were 6.04 / 7.05 ms for 10/100 owners.

Startup still completes all recovery work: elapsed times were 87.80 / 98.66 / 90.57 ms
at 10 owners and 750.07 / 809.69 / 801.30 ms at 100 owners. Startup timer gaps were
88.23 / 99.13 / 15.31 ms and 750.48 / 810.25 / 33.10 ms respectively. Peak owned
connections remained one, with zero left open. All scoring, purge, deletion cursor
and history annotation assertions passed. These are single synthetic runs, with
cache and host-load noise; timing differences do not establish a universal speedup.
The structural guarantee is a yield between owners, not a time threshold.

For reproducible foreground HTTP and large-owner measurements, captured repeated-run
baselines, deployment assumptions and the optimization decision, see the
[performance investigation](performance-investigation.md). Those measurements
are separate from the housekeeping-only results above.
