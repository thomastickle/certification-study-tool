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
- Format substantial SQL in template literals, with clauses on separate lines
  and one column definition per line. Keep bound parameters separate from SQL.
- Extract helpers around coherent responsibilities and resource ownership.
  Method length alone is not a reason to introduce another level of indirection.

Keep the configured 100-column formatting target. Do not add formatter-ignore
comments to force a preferred layout. Use the same checks in the editor and CI.
