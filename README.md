# Certification Study Tool

A local study-question library with a React interface, TypeScript application
services, and SQLite storage. This first slice imports version-2 JSON banks,
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
First complete [Keycloak enrollment and application-role setup](docs/authentication.md).
Users study shared banks and their own private banks; administrators manage shared content.
Each user has a separate database for private banks and study history.

```sh
npm ci
# External database administration integration tests use this pinned image.
docker pull --platform linux/amd64 redgate/flyway@sha256:b45087cccd267d326c5fd776bc06e9690e83509ce8bbf47acd65f1aa4a4b8b86
npm run dev
```

Open **http://127.0.0.1:3000**. Frontend changes reload through Vite; changes to
backend code, shared types, or the schema restart the local server.

For a compiled server and built frontend without the development server:

```sh
npm run build
NODE_ENV=production npm start
```

The prepared central database defaults to `private/app/central.sqlite3`.
`STUDY_DB_PATH` selects the central file shared by accounts, sessions and library content;
`STUDY_ACCOUNTS_PATH` is retired and causes a configuration error. Personal workspaces
remain separate under `private/app/users/<internal-ID>.sqlite3` unless configured otherwise.
Prepare or convert databases externally before starting the server. The deployment root
must contain exact `READY` contents `1\n` and no `RESTART_BLOCKED` marker.
Login never creates personal files: study requests return 503 until external provisioning
completes. See [database administration](docs/database-management.md). Actual local data
conversion is deferred until the complete change has merged into master.

## Run with Docker

With Docker Engine/Desktop and Docker Compose running, follow the
[role setup and upgrade instructions](docs/authentication.md) before starting:

```sh
docker compose up --build -d
```

Open **http://127.0.0.1:3000**. The image builds the frontend and runs the
production server as a non-root user. The stack includes local Keycloak and
publishes only loopback ports. Set `STUDY_WEB_PORT` and `STUDY_KEYCLOAK_PORT`
together with the documented origin/issuer configuration when using other ports.

```sh
docker compose logs -f study  # View logs
docker compose down           # Stop; retain your library
docker compose up -d          # Start again
```

The `study-data` Docker volume stores SQLite data across container rebuilds and
recreation. `docker compose down --volumes` **permanently deletes that library**.
The `keycloak-data` volume separately preserves provider identities.
Back up the volume while the service is stopped before removing volumes or
moving machines. This starts a new, empty library; your existing
`private/app/central.sqlite3` is not copied. Import banks through the browser as
usual. Private files, local databases, credentials, and Git history are excluded
from the build context and image. No image publishing is required.

For native runs, `STUDY_HOST` defaults to `127.0.0.1`; the image sets it to
`0.0.0.0` so Docker can forward connections. Local Host/Origin protections remain
active in either mode.

## Import and review

1. In **Library**, choose **My private library**, or **Shared library** if you are
   an administrator managing shared content. Choose **Import a bank**, then a
   version-2 JSON file (maximum 10 MB).
2. Inspect new, unchanged, changed, duplicate, and unclassified question counts.
3. Review stored/incoming versions for changed questions or source metadata.
   Check the approval box before confirming those changes.
4. Confirm the import. Validation failures reject the whole file. Conflicting
   duplicate answer keys must be corrected in the input before importing.

The prepared banks live in the Git-ignored `private/question-banks/` folder.
Keep bank files and databases out of Git. Imported banks are sent to your study
server. Private banks stay with your account; shared-bank imports are available
to its users. Banks and progress are not sent to the identity
provider; the app has no analytics, remote fonts, or cloud database. Imported data
is persisted in SQLite; the app
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
and decorator-capable server emit (its separate compiler is `tsc6`). The typecheck script explicitly selects the
native launcher to avoid competing transitive `tsc` binaries. Keep both aliases:
TypeScript 7 has no JavaScript API. `npm run typecheck -- --version` verifies the
default compiler, and `npm test`
checks compiler error detection and ESLint's TypeScript rules. Vite's client types
declare frontend asset imports in `src/web/vite-env.d.ts`.

`npm run build:server` uses TypeScript 6 with `tsconfig.server.json` to emit ESM
into `build/`, rewriting relative `.ts` imports to `.js` and copying the validation
schema to `build/docs/`. Vite still writes only to `dist/`. `npm start` runs
`build/src/server/main.js`; build first, and set `NODE_ENV=production` for static
frontend delivery. Docker packages the compiled code, schema, frontend, and
production dependencies without requiring a compiler at runtime. Existing CLI
commands continue to run native TypeScript without decorators.

`npm run dev` rebuilds the server before starting it and restarts on backend,
shared, schema, build-script, or TypeScript configuration changes. Vite handles
frontend HMR. Development main now owns a stock Vite child and private Nest API;
see [process ownership and assertion migration](docs/development-process.md).
After a build or server startup failure, the watcher stays alive and
waits for a source change before trying again. `npm test` builds first, retains
native TypeScript/Node tests and the SVG loader, then runs
`tests/compiled/**/*.spec.ts` from emitted JavaScript. Put tests that import
decorated application modules in that compiled suite; use relative `.ts` imports
throughout it so both tests and providers share one emitted module graph. Do not
import decorated modules into native TypeScript tests.

Production `main` awaits `createProductionApplication(configuration)`, initializes it,
then listens. This composes one global runtime, authentication/health/session
controllers, LibraryHttpModule and StudyHttpModule, plus built static serving.
Admission precedes routing; bodies remain unparsed until guards and owned inputs run.
Both signals share shutdown and retain actual request work until database roots
can close. Development stops public admission before backend drainage and then
terminates the frontend process group. Await `init()` and `listen()` sequentially: overlapping
startup is rejected explicitly.

HTTP, authentication and transport/Vite tests exercise compiled Nest or maintained
pure helpers; the obsolete dispatchers are removed. See the
[assertion mapping](docs/nest-http-test-migration.md). The foreground benchmark
also uses authenticated Nest controllers and actual request-owned storage; its
[methodology](docs/nest-benchmark-migration.md) distinguishes the historical
dispatcher baseline. The [pinned comparison](docs/nest-performance.md) records all
normal and slow paths; final integrated review remains under the
[conversion plan](docs/nest-conversion-plan.md). Issue #81 stays open.

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

See the [readability guide](docs/code-style.md) for the project's conventions.

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

### Toolchain upgrades

The ranges in `package.json` describe supported dependency versions; the
`package-lock.json` records the versions a clean install currently resolves.
Review both when planning an upgrade. The current declarations and selections
are:

| Toolchain component        | Declared support or selection                        | Lockfile resolution or Docker pin        |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| Node.js                    | `>=24.14.0 <25` (`engines`)                          | Docker uses `node:24.17.0-bookworm-slim` |
| Native TypeScript compiler | `@typescript/native` aliases `typescript@7.0.2`      | 7.0.2                                    |
| TypeScript JavaScript API  | `typescript` aliases `@typescript/typescript6@6.0.2` | 6.0.2                                    |
| ESLint                     | `10.13.0`                                            | 10.13.0                                  |
| typescript-eslint          | `8.71.2`                                             | 8.71.2                                   |
| Vite                       | `^7.3.0`                                             | 7.3.7                                    |

The package declarations are the supported selections; the last column gives
the current lockfile versions, except for Node, where it records the Docker
base image pin. These are snapshots, not a promise that later installs will
resolve to the same versions when a range permits newer releases. CI selects
Node from `package.json` and checks for the latest matching patch release. The
two TypeScript packages serve different purposes: the native TypeScript 7
compiler handles typechecking, while the TypeScript 6 package supplies the
JavaScript API used by ESLint and tests. Keep both unless the code and tests are
deliberately migrated to a replacement API.

For an upgrade, review the affected tools' compatibility notes and peer
requirements, then update the intended package declarations and lockfile
together. If changing Node, update and validate both the package engine range
and Docker base image. Check the compiler selected by the project script and
run the regression coverage and full project checks:

```sh
npm ci
node --version
npm run typecheck -- --version
npm test
npm run check
```

`npm test` includes checks that the default compiler is TypeScript 7, detects a
TypeScript error, and that ESLint can use the TypeScript 6 API and enforce its
TypeScript rules. CI runs `npm ci` and `npm run check`; its Docker job builds the
image and runs container health, web-app, and Keycloak-backed smoke checks. Run
that Docker path when changing the image's Node version or other dependencies
used in the image.

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

See [the maintained Nest layout](docs/architecture.md) for feature module and runtime ownership.
