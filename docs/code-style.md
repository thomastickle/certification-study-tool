# Readable JavaScript and TypeScript

Use Prettier for consistent layout and ESLint for correctness. Read the formatted
result before committing: passing these tools does not establish readability.

- Resolve asynchronous prerequisites into named values before passing them to
  another operation. Keep the execution order visible.
- Name substantial options objects before passing them to a function. Small,
  obvious arguments can stay inline.
- Keep ternaries short and nonnested. When a choice becomes difficult to scan,
  use explicit branches or name the meaningful values involved.
- Give compound conditions names that explain the rule being checked. Avoid
  introducing variables that merely work around the formatter's width target.
- Keep multi-step algorithms and transactions in meaningful phases. Extract a
  phase when it has a clear responsibility or resource boundary; avoid wrappers
  that only forward arguments or shorten a long method. In JSX, group markup by
  meaning instead of adding elements only to manage line length.
- Format substantial SQL in template literals, with clauses on separate lines
  and one column definition per line. Keep bound parameters separate from SQL.
  Method length alone is not a reason to introduce another level of indirection.

Keep the configured 100-column formatting target. Do not add formatter-ignore
comments to force a preferred layout. Use the same checks in the editor and CI.
