# Study Library

A local study-question library with a React interface, TypeScript application
services, and SQLite storage. This first slice imports version-2 JSON banks,
shows their contents, and deletes individual source occurrences or whole sources.
It does not implement quizzes, exams, or reports.

## Run

Use Node **24.14 or later in the 24.x line** and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. Frontend changes reload through Vite; changes to
backend code, shared types, or the schema restart the local server.

For a built frontend without the development server:

```sh
npm run build
NODE_ENV=production npm start
```

The database defaults to `private/app/library.sqlite3`. `STUDY_DB_PATH` selects a
separate database path and `STUDY_PORT` selects a port. Do not point this app at
the original Python app's database; existing unrelated databases are refused.
The initial schema is version 1 and uses an application identifier to recognize
its own databases. No legacy database migration is implemented.

## Import and review

1. Choose **Import a bank**, then a version-2 JSON file (maximum 10 MB).
2. Inspect new, unchanged, changed, duplicate, and unclassified question counts.
3. Review stored/incoming versions for changed questions or source metadata.
   Check the approval box before confirming those changes.
4. Confirm the import. Validation failures reject the whole file. Conflicting
   duplicate answer keys must be corrected in the input before importing.

The prepared banks live in the Git-ignored `private/question-banks/` folder.
Banks and databases must remain local. File contents are sent only to the
loopback server; this app has no external API or upload destination, analytics,
remote fonts, or cloud database. Imported data is persisted in SQLite; the app
does not save a separate copy of the selected input file. Original files are
never edited or deleted by the app.

Source identity is `(provider, certification code, source key)`. Question identity
within a source uses `source_ref`. Without a source reference, the importer uses
a content fingerprint and cannot recognize a changed question as an update;
such changed content becomes a new record. Changes to any stored question field,
including classification or explanations, require review. JSON object property
order is ignored; array order remains significant when detecting updates.
A new snapshot with a different source key remains a separate source.
Questions omitted from a reimport are retained; this is not a destructive sync.

All source occurrences are retained, including duplicates. Duplicate matching
ignores answer order and normalizes Unicode, letter case, punctuation, and
whitespace. Different answer keys on matching questions block import for review.
Study classifications can be missing; those questions are marked unclassified.
Original source and verification claims are preserved without re-verification.

Browse by source or search question text, reference, study area, or topic. Open
a question to inspect choices, correct answers, explanations, and its full source
record. **Delete question** removes only that source's occurrence. **Delete
source** removes that source and all its questions. Both require confirmation;
there is no undo. Reimporting the original file can restore deleted content.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

Tests use synthetic data and temporary or in-memory databases. Private study
banks, databases, logs, and generated build assets are excluded from Git.
See [architecture](docs/architecture.md) and the
[bank format](docs/question-bank.schema.json).

## Code hygiene

Use the project-local tools so editors and command-line checks follow the same
rules: two spaces, single quotes, a 100-column print width, and no trailing
statement semicolons. Prettier retains leading semicolons where needed to avoid
automatic-semicolon-insertion hazards. ESLint applies the recommended JavaScript
and TypeScript rules; formatting is handled by Prettier. An underscore prefix
marks an intentionally unused parameter or discarded value.

ESLint Stylistic requires a blank line after the import block, around function,
class, and type declarations, and between class methods (including constructors
and accessors). Related imports, class fields, and overload signatures can stay
together. Keep JSDoc comments and decorators immediately above their declaration;
the separating blank line goes before them. `npm run format` applies these spacing
fixes before Prettier formats the files.

```sh
npm run format        # Apply formatting
npm run format:check  # Check formatting without changing files
npm run lint          # Check application, tests, and tooling configuration
npm run check         # Formatting, lint, tests, typecheck, and production build
```

`npm run build` includes typechecking. Private banks/databases, editor settings,
and generated output are excluded from formatting; linting is scoped to code.
