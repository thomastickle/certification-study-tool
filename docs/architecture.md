# Initial architecture

The application runs locally. A single loopback HTTP server serves the React
frontend and the API. SQLite is a local file. Only the GUI is implemented.

```mermaid
flowchart LR
  GUI[React GUI] --> HTTP[HTTP controller]
  HTTP --> Import[Import service]
  HTTP --> Library[Library service]
  HTTP --> Queries[Library queries]
  Import --> Validation[Bank validation]
  Import --> Repo[SQLite repository]
  Library --> Repo
  Queries --> Repo
  Repo --> DB[(Local SQLite)]
  CLI[Future prompt-driven CLI] -.-> Import
  CLI -.-> Library
  TUI[Future full-screen TUI] -.-> Import
  TUI -.-> Library
```

- `src/server/importer/` owns JSON validation, import previews, change review,
  and duplicate comparisons. The service receives parsed content, not paths.
- `src/server/questions/` owns library queries, deletion, and persistence. SQL
  and initial schema creation live in the repository; services own transactions.
- `src/server/http-controller.ts` translates HTTP requests into service calls.
  It enforces local host/origin access and request limits.
- `src/server/main.ts` owns startup, the database connection, and frontend serving.
- `src/web/` owns React presentation, file selection, and confirmation dialogs.
- `src/shared/` contains TypeScript request/result types used across boundaries.

Previewing does not write to SQLite. Confirmation validates again inside a
transaction and rejects a stale preview if the database or input changed.
Database revisions also change after deletion, invalidating outstanding previews.
Imports never remove questions absent from the incoming file.

This is intentionally a concrete SQLite implementation, with no repository
interface or generic database framework yet. Future terminal interfaces can use
the services without starting HTTP. Future database changes need versioned
migrations and tests; a switch of database engines is not implemented.

The initial library query loads the local collection to filter and paginate
25 records at a time. This is suitable for the current small banks; SQL-side
search and pagination can follow if measured size or latency requires them.

## Terms

- **GUI:** React web frontend.
- **TUI:** full-screen terminal UI, such as a DOS application or Neovim.
- **CLI:** interactive prompt-driven terminal workflow, such as a Bash wizard.
- **Application core:** validation and application services that do not depend on
  React or HTTP. SQLite access is isolated in the repository.
- **Source occurrence:** one question belonging to one source. Identical questions
  in other sources remain separate stored occurrences.
- **Preview:** proposed import changes, with a token binding the input to the
  current database revision. A preview is not a saved import.

No external hosting or runtime integrations are configured. No independent
review has been performed for this bootstrap.
