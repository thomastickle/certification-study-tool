# Curated CLF-C02 batch import

Use Node 24.14+ in the 24.x line. Run these commands from the checkout containing
this importer. Source and database arguments are explicit; relative paths are
resolved from your current directory. The command does not use `STUDY_DB_PATH`.

```sh
npm run import:curated -- \
  --source /home/ttickle/Projects/certification-study-tool/private/aws_clf_c02_AWS_STUDY_TS_IMPORT_BUNDLE \
  --db /home/ttickle/Projects/certification-study-tool/private/app/curated-preview.sqlite3 \
  --dry-run
```

Repeat with `--apply` in place of `--dry-run` to persist the import. Omitting both
flags also means dry-run. The output states the resolved source directory,
database, mode, and per-file new/unchanged/duplicate/conflict counts. A matching
duplicate is a retained source occurrence, not an answer-key conflict.

Only these files are loaded, in this order; `03_audit/` is never imported:

| File under bundle directory                                           | Occurrences | Source type |
| --------------------------------------------------------------------- | ----------: | ----------- |
| `01_official/aws-clf-c02-official-practice-exam-2026(2).json`         |          65 | official    |
| `01_official/aws-clf-c02-official-practice-question-set-2026(2).json` |          20 | official    |
| `01_official/aws-clf-c02-official-pretest-2026(2).json`               |          65 | official    |
| `02_screened/aws_screened_cloudcertprep_2026.json`                    |         942 | third_party |
| `02_screened/aws_screened_github_additions_2026.json`                 |          41 | third_party |

The command checks certification, expected per-file counts, source types, and
unverified status for both third-party sources. It calls the real `validateBank`,
`ImportService.preview` and `ImportService.confirm`, backed by `LibraryRepository`.
All supplied question content, source references, metadata, and verification
claims are retained; validation does not elevate any verification status.
Intentional curated rewrites remain intact. No input file is edited.

All inputs are validated before opening the destination. Dry-run uses a private
temporary SQLite snapshot (including committed WAL data if a database exists),
simulates the sequential service confirmations there, and deletes the snapshot.
It does not create a missing target database or change an existing target.
Apply first performs that same preflight, then revalidates/previews/confirms the
banks against the destination in a single transaction. A conflict or unreviewed
change rolls back the entire batch. No blanket change-review approval is given;
use the existing GUI review contract if an existing question or source metadata
requires an intentional update. Errors identify the file and affected reference
(or question position when no valid reference exists).

Source identity remains `(provider, certification code, source key)`. Different
keys create additional sources, even if some questions match. Omissions retain
old questions; this command never deletes sources, questions, or study history.
A repeated source identity within one batch is refused to prevent accidental
partial-source overlays. The GUI remains available for single-file imports.

## Existing libraries and reconciliation

Keep the original `private/app/library.sqlite3` separate from the curated preview.
Importing screened sources alongside old raw sources can retain excluded material
and introduce duplicates or conflicting answer keys. Run a dry-run against any
candidate existing library before proposing a change. A failed batch exits
nonzero and leaves the target unchanged.

Before any separately approved replacement: stop the app, back up the database
and any SQLite sidecars together (or use SQLite's consistent backup API), verify
the backup can reopen, inventory source IDs/keys and their relationships/history,
and review exact proposed removals. Agree on handling history before deleting
anything. The current importer is additive and the GUI's delete-source action
is permanent; neither is a history-preserving migration. No deletion or
replacement is authorized by this workflow.

To browse the imported preview library:

```sh
STUDY_DB_PATH=/home/ttickle/Projects/certification-study-tool/private/app/curated-preview.sqlite3 npm run dev
```

Open http://127.0.0.1:3000. This app currently imports, browses, and deletes;
it does not yet provide quizzes. A separate first quiz slice could offer 10/20
questions, official/screened/mixed sources, single/multi-select answers, scoring,
and review. Keep it separate from bank integration.

Banks, audits, databases, and execution logs stay local under ignored `private/`.
Tests use synthetic fixtures and temporary databases only.
