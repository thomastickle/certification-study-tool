# Move a legacy library to one private account

Each user owns a separate SQLite database. New accounts start empty. This command
copies the previous single-user library and its complete study history into one
explicitly selected account. It never seeds other users or distributes question banks.

Sign in once so the app creates your account. Before importing anything into that
account, list the available owners:

```sh
npm run migrate:library -- --data-dir private/app --list-accounts
```

Match the account ID, name, and issuer to the intended owner. Names are not identity
keys and can repeat. Then stop the study server and close any database tools.
Preview the migration, replacing `ACCOUNT_ID` with that account's ID:

```sh
npm run migrate:library -- --data-dir private/app --account-id ACCOUNT_ID
```

The preview reports the source, destination, owner, and counts without changing
either study database. The default source is `<data-dir>/library.sqlite3`. An
explicit `--source /path/to/library.sqlite3` can select another recognized study
database. The original Python application's databases are not supported.

After checking the preview, apply it:

```sh
npm run migrate:library -- --data-dir private/app --account-id ACCOUNT_ID --apply
```

The apply result includes backup paths. SQLite's backup API captures committed WAL
records consistently; the original is never opened through a migrating repository.
The command validates a separate snapshot, saves the original snapshot under
`<data-dir>/backups`, backs up an existing pristine destination, then installs the
validated copy atomically. Restart the app and sign in with the same account.

The destination must be absent or pristine. A normal first login creates a pristine
database and is supported. Existing imports, attempts, earned certifications,
reviewed concepts, or any earlier library revision block migration. Importing and
then deleting banks does not make a workspace pristine again. There is no force
overwrite option; use a fresh account rather than losing existing data.

The server and migration command share a SQLite data-directory lock. Migration
refuses to run while this version of the server is active, and the OS releases the
lock when its process exits, including after a crash. Older app versions and
external database tools do not participate in that lock; they must also be stopped.
Active destination WAL/journal sidecars are refused rather than removed.

Keep the account registry, user databases, and Keycloak storage together in your
backup plan. Recreating a Keycloak user or realm changes its identity; the app will
not automatically link the new identity by username or email. The original legacy
database remains available for rollback, but new activity in the private account
is not written back into the legacy database.

In a container, use the same command with `--data-dir /data` and the existing
`study-data` volume mounted. The maintenance process needs filesystem access to
that volume; it is not exposed through an unauthenticated HTTP endpoint.
