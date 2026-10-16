# Agreed behavior for future implementation

This records agreed requirements. Import, browsing, and deletion now exist;
quiz, exam, and reporting behavior remains deferred.

## Importing

- Keep all source occurrences and distinguish official and third-party sources.
  Future question selection should allow choosing either source category or mixing them.
- Skip unchanged source questions; require review before accepting changed ones.
  The initial implementation treats changes to any stored question field,
  including classification-only edits, as requiring review.
- Reject an invalid file as a whole and identify the failing questions and fields.
- Show a validation preview and proposed changes before saving.
- Import missing classifications without silently inventing trusted assignments.
- Record duplicates by matching question and unordered answer-set text, with
  whitespace/punctuation normalization and the same selection type. Conflicting
  answer keys require review. Preserve every source occurrence.
- Keep databases local; do not upload banks or databases. Keep local banks
  excluded from Git. Whether the app retains its own original import copies
  after import remains undecided; never delete user-owned source files implicitly.

## Deferred study behavior

- GUI means the React web frontend.
- TUI means a full-screen terminal interface with structured navigation.
- CLI means a prompt-driven terminal wizard, rather than only commands and flags.
- Terminal use must work locally and offline, without requiring an HTTP server.
- Interfaces should broadly offer the same capabilities, with interaction adapted
  to each frontend. GUI development comes first.
- Confidence choices: Confident, Educated Guess, Unsure. Choosing one is optional;
  the treatment of an omitted choice remains undecided.
- Incorrect responses require review. Correct responses marked Educated Guess
  or Unsure are eligible for review.
- Quizzes/tests should provide pass/fail reporting. Thresholds, grading rules,
  reports, review workflow, question allocation, and question creation are deferred.
- Area/topic classifications must be preserved for future study selection.
  Exam-blueprint mappings and allocation policies are deferred.
