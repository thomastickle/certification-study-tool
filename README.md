# Certification Study Tool

A study-question library with OIDC sign-in, a React interface, TypeScript application
services, and private SQLite storage per user. This first slice imports version-2 JSON banks,
shows their contents, and deletes individual source occurrences or whole sources.
The library accepts question banks for different providers and certifications.
Timed practice and performance reports follow the selected certification workspace.
AWS CLF-C02 has domain mappings; other certifications use generic timed practice.
Home groups imported certifications by provider with compact exam-readiness bars.
Readiness uses the AWS CLF-C02 domain blueprint for that track; all other
certifications receive a general practice estimate from their own completed history.
The separate Certifications screen records earned credentials as stars without
changing readiness. See [readiness rules and evidence](docs/readiness.md).
The Reports page adds progress charts, domain and topic breakdowns, exam/quiz
filters, saved answer review, and local Markdown exports. See
[quiz behavior and reporting](docs/quizzes.md).

## Run

Use Node **24.14 or later in the 24.x line** and npm.

```sh
npm ci
docker compose -f compose.keycloak.yaml up -d
npm run dev
```

Open **http://127.0.0.1:3000**. Frontend changes reload through Vite; changes to
backend code, shared types, or the schema restart the local server.
Choose **Sign in**, then **Register** on local Keycloak to create a development
account. Each account starts with an empty private library. Keycloak is bound to
loopback at port 8080 for development; no certificate or client secret is needed.
See [authentication and user storage](docs/authentication.md).

For a built frontend without the development server:

```sh
npm run build
NODE_ENV=production npm start
```

`STUDY_DATA_DIR` defaults to `private/app`: `accounts.sqlite3` maps verified
identities to internal user IDs and stores hashed session credentials;
`users/<user-id>.sqlite3` holds that user's library and progress. Back up the
whole directory together. `STUDY_PORT` selects a port; `STUDY_ORIGIN` is the exact
browser origin and defaults to `http://127.0.0.1:<port>`. Use that origin
consistently; `localhost` and `127.0.0.1` have different cookies and redirect URIs.
The development realm also permits port 3100 for an isolated review instance.

Existing `private/app/library.sqlite3` files are preserved but are not assigned
to the first person who signs in. Use the explicit
[migration command](docs/library-migration.md) to retain the old library and history
in one chosen account; reimporting banks starts a new private library instead. The server
no longer uses `STUDY_DB_PATH`; CLI commands still accept explicit database paths.
Study databases retain schema version 2 and their existing application identifier.

## Run with Docker

From the normal checkout, use Docker Engine/Desktop with Compose:

```sh
docker compose up --build -d --wait
```

This starts the production application image and a local development Keycloak.
Open **http://127.0.0.1:3000**, choose **Sign in**, and register an account. Both
host ports (3000 and 8080) bind only to loopback; no certificate is needed locally.
Keycloak must become ready before the app starts. The image contains no passwords
or pre-created users. This development identity stack is not for public hosting.

**Upgrading an existing installation:** follow the [backup, account migration,
and rollback steps](docs/docker-rollout.md) before replacing the old container.
Keep the same Compose project and existing `study-data` volume. The old
`library.sqlite3` is retained; it is copied only to the account you explicitly
select with the migration command. New accounts start with empty private libraries.

Both `study-data` and `keycloak-data` survive container rebuilds and recreation.
Stop services before filesystem backups and preserve both volumes together.
`docker compose down --volumes` permanently removes that data. Use
`docker compose down` to stop/remove containers while retaining it.

The public `/api/health` endpoint reports application liveness without accessing
study data; it does not check provider availability. See
[authentication](docs/authentication.md) for issuer configuration and session limits.

## Import and review

1. Choose **Import a bank**, then a version-2 JSON file (maximum 10 MB).
2. Inspect new, unchanged, changed, duplicate, and unclassified question counts.
3. Review stored/incoming versions for changed questions or source metadata.
   Check the approval box before confirming those changes.
4. Confirm the import. Validation failures reject the whole file. Conflicting
   duplicate answer keys must be corrected in the input before importing.

The prepared banks live in the Git-ignored `private/question-banks/` folder.
File contents are sent only to the application server; question banks and study
history are never sent to the identity provider. The local development setup
keeps both servers on loopback. There is no analytics, remote font, or cloud
database integration. Imported data is persisted in SQLite; the app
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

Typechecking uses Microsoft's official Go-based TypeScript 7.0.2 compiler locally,
in GitHub Actions, and in Docker through the same `npm run typecheck` / `build`
scripts. npm installs the platform binary; no Go SDK is needed. Following
[Microsoft's side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0),
`@typescript/native` aliases `typescript@7.0.2` and supplies `tsc`, while
`typescript` aliases `@typescript/typescript6@6.0.2` for ESLint's JavaScript API
(its separate compiler is `tsc6`). The typecheck script explicitly selects the
native launcher to avoid competing transitive `tsc` binaries. Keep both aliases:
TypeScript 7 has no JavaScript API. `npm run typecheck -- --version` verifies the
default compiler, and `npm test`
checks compiler error detection and ESLint's TypeScript rules. Vite's client types
declare frontend asset imports in `src/web/vite-env.d.ts`.

## Curated CLF-C02 batch import

For the five-file curated bundle, use the repeatable local command documented in
[batch importing](docs/batch-import.md). It previews without writing to the
selected database; `--apply` explicitly imports. Both source and database paths
are required, so it never implicitly selects your default library.

## Frontend structure

`src/web/main.tsx` boots React; `index.html` remains the Vite entry point.

- `app/` contains application wiring, workspace navigation/session coordination,
  and global styles (`styles.css` and `workspace.css`).
- `features/` groups the `home`, `certifications`, `practice`, `reports`, and
  `library` screens with their supporting components and state helpers.
  Certification picker and report styles live alongside their owning features.
- `shared/ui/` contains presentation reused across screens; `shared/lib/`
  contains frontend API and filtering utilities. Backend/frontend contracts
  remain in `src/shared/`.

Imports refer directly to modules. Practice owns saved-result actions reused by
reports; certification metadata is shared by workspace and feature consumers.
Frontend unit tests stay beside their modules, while cross-layer and rendered
screen tests remain in `tests/`. `npm test` discovers both trees recursively.

## Code hygiene

Use the project-local tools so editors and command-line checks follow the same
rules: two spaces, single quotes, a 100-column print width, and no trailing
statement semicolons. Prettier retains leading semicolons where needed to avoid
automatic-semicolon-insertion hazards. ESLint applies the recommended JavaScript
and TypeScript rules; formatting is handled by Prettier. An underscore prefix
marks an intentionally unused parameter or discarded value.

ESLint Stylistic requires a blank line after the import block, around function,
class, and type declarations (including ambient `declare` declarations), and
between class methods, constructors, and accessors. Related imports and class
fields can stay together. Bodiless overload and abstract signatures follow
ESLint Stylistic's grouping exceptions. Keep JSDoc comments and decorators
immediately above their declaration; the separating blank line goes before them.
`npm run format` applies these spacing fixes before Prettier formats the files.

```sh
npm run format        # Apply formatting
npm run format:check  # Check formatting without changing files
npm run lint          # Check application, tests, and tooling configuration
npm run check         # Formatting, lint, tests, typecheck, and production build
```

`npm run build` includes typechecking. Private banks/databases, editor settings,
and generated output are excluded from formatting; linting is scoped to code.

## Appearance

Open the **Settings** page from the sidebar. Its **Appearance** section contains
the **Theme** selector, which offers **System**, **Light**, and **Dark**.
System is the default and follows the desktop/browser appearance, including changes
while the app is open. Explicit choices are saved in this browser's local storage
for this origin; selecting System clears the override. If storage is blocked,
changes still work for the current page. Theme preferences do not sync between
devices or browser profiles. The theme uses modern browser `light-dark()` support.

The independent **Palette** choices offer **Blue** (default), **Forest**, **Violet**,
**Ocean**, **Amber**, and **Rose**. Each shows light and dark previews side by side.
Selecting a palette preserves your System/Light/Dark setting. Palette choices are
also remembered locally. `src/web/app/themes/base.css` owns shared semantic color
tokens and the Blue palette; each other palette has its own CSS override file in
the same folder. Component styles consume these variables. Native CSS handles
theme switching; Vite builds the CSS without a Sass dependency.
