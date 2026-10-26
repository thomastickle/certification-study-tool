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
/data/accounts.sqlite3              identities, roles in sessions, hashed sessions
/data/library.sqlite3               shared banks, reviewed mappings, deletion events
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

History is private even when its questions came from shared banks. Private
question snapshots never enter the shared database. Shared deletions append a
public bank-provenance event atomically with deletion. Each private database
reconciles those events before reads; an event cursor makes this repeatable after
restart. Private deletion annotates saved attempts in the same private transaction.
Neither operation removes saved answers or grades. Due obligations can remain
unavailable after their bank is removed, as before.

## Upgrade from Epic 2

1. Stop every application instance. Retain the previous image and make a private
   backup of the entire stopped application volume, Keycloak volume and settings.
   Keep the same issuer, account registry, shared database path and Compose project.
2. The normal application uses SQLite DELETE journal mode. If an operator enabled
   WAL, stop all clients and checkpoint/change each affected database back to
   DELETE mode before upgrading. Migration refuses unsupported journal modes.
3. Build and start the new image. Schema version 4 prevents older releases from
   opening the upgraded layout. Before HTTP starts, each account's existing
   attempts, legacy mastery and earned certifications move to its owner file.
   Banks remain shared; account IDs, attempt IDs, times, answers and library
   revisions are preserved. Legacy ambiguous source provenance is pinned without
   guessing. No new `STUDY_LEGACY_OWNER_SUBJECT` is needed when upgrading a genuine
   Epic 2 database; that setting still applies to pre-Epic-2 unowned history.
4. Sign in as the old account and check history and earned certifications. Sign
   in as another account and confirm the private library is empty, shared banks
   are available, and the other account's history cannot be read. Import a small
   synthetic private bank and confirm it is absent for the other account.

Each owner transfer uses one attached-database transaction. It checks both modes
under write locks, requires a matching destination owner and refuses conflicting
destination evidence. A failed transfer rolls back both files. A completed transfer
removes the old study rows using secure deletion. Before HTTP starts, a one-time
VACUUM clears pages freed by older ownership upgrades as well. Cleanup completion
is recorded only after success, so a failed cleanup is retried even if all owner
transfers already committed. Allow up to twice the shared file's size in free
space for this step. Existing backups remain sensitive.
See SQLite's [attached-database transaction requirements](https://www.sqlite.org/lang_attach.html).
Its [VACUUM documentation](https://www.sqlite.org/lang_vacuum.html) explains the
physical cleanup and temporary-space requirement.
Transfers completed before a later owner's failure remain completed; startup can
be retried after resolving the reported conflict. Do not combine unrelated backups
or overwrite a user file to bypass the ownership checks.

Rollback requires stopping the application and restoring the **whole coherent
pre-upgrade volume**, then starting the retained image. Do not restore only the
shared file or mix user files from a different point in time. Protect Keycloak
identity continuity as before. `docker compose down` retains volumes;
`down --volumes` deletes them.

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
