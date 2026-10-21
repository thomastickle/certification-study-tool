# Quiz and exam flow

The banner identifies the selected certification and opens a searchable picker.
It lists certifications with eligible imported questions, grouped by organization,
platform, and known level. Search matches partial words in names, codes, levels,
and aliases (for example AWS/Amazon, Azure/Microsoft/MS, and GCP/Google).
Aliases affect discovery only; stored provider and certification namespaces remain
distinct. Unknown programs are listed without an invented level.

The selection survives reloads and scopes Practice, Due Review, and Reports.
Switching keeps the current destination and saves and pauses an unfinished session
before changing scope; a failed save or pause retains the current certification.
Question-bank choices are kept separately for each certification during the session.
Imports refresh the picker automatically. The Importer remains the workspace-wide
library so new certifications can be added there.

The start page opens Practice,
Due Review, and the question library. The collapsible sidebar keeps Reports as
its own final destination. On desktop, drag the boundary to resize navigation or
use its chevron button to collapse to an icon rail. The expanded width and collapse
preference are remembered. The boundary also accepts Left/Right arrows (Shift for
larger steps), Home to collapse, End for maximum width, and Enter to toggle.
Mobile keeps the compact labeled navigation. Practice provides Quiz and Exam presets
in one setup workflow. Switching presets keeps
the chosen question banks and uses the same save-and-pause guard as navigation.
The presets live inside “Set up your quiz”; the page heading shows the selected
certification on the right, without repeating question counts or durations.
Each preset retains its own saved attempt; presets cannot change an attempt that is
already open. Both presets share one “Completed” history with Quiz and Exam markers,
including pending deletions and undo. Opening an older result retains its original
attempt type and returns to the same setup preset. Due Review keeps a separate history.
Result indicators use red for scores below 70% (0–69%), yellow from 70% to below 90%
(70–89%), and green from 90% through 100%. Exact saved counts determine the band;
rounded display percentages do not change it. These bands are separate from the
80% practice pass target. Local Markdown discussion reports remain available from
results and through the Reports page.

A CLF-C02 quiz has 20 questions and a server-owned 20-minute deadline. An exam
has **65 questions and a 90-minute deadline**. Both modes share the same bank
picker, answer controls, timing, review, grading, and report flow. Warnings
appear inline in the toolbar at 10 and 2 minutes remaining, including on the
pre-submit review screen. Their reserved slot keeps the question from shifting;
the 10-minute warning is yellow and the final warning is red. Each message
disappears after 30 seconds; its toolbar space stays reserved.
Answers are saved after each change. At expiry the server scores the saved
choices; unanswered questions and incomplete/incorrect multi-select sets are
misses. Late changes are ignored. A running server checks deadlines every second;
after a server restart it also scores overdue attempts. If a save fails, the UI
shows that the latest changes are unsaved and offers retry. The deadline does
not pause during failures or browser sleep. In-app navigation pauses it only after
the save and pause requests succeed.

During an attempt the compact toolbar shows question progress, save status, an
**HH:MM:SS** clock, Pause, and an Actions dropdown. The dropdown offers Review
answers, Submit and score, and Abandon. The footer has compact, equal-width
Previous and Next buttons at opposite edges. On the final question, Next becomes
Review answers and opens answer review. Answers, confidence, and flags save
immediately, without a lock-in step.
The question screen omits the redundant mode heading, question count, and duration
intro. Long content can still scroll naturally; question panels have no nested
scroll containers. The review grid labels answered/unanswered questions and flags. Questions needing
review have a yellow background and a Needs review label: unanswered/incomplete
answers, return flags, and missing or low confidence. Confident complete answers
without flags are unhighlighted.

Each question supports its original single/multiple selection count, optional
confidence (Confident, Educated Guess, Unsure), and a Mark for Review checkbox. The review
screen lists all questions and highlights unanswered, marked, low-confidence,
and unrecorded-confidence items. Submit and score ends the attempt. The result
shows correct count, score (correct / all questions, including skips), and an **80% practice target**: green Pass
at or above 80%, red Fail below it, with text labels as well as color. This raw
percentage is not AWS's scaled certification score.

All questions, choices, selected/correct answers, confidence, return marks,
source attribution, and study classifications appear in the completed result
and its downloadable/copyable Markdown report. Export requires a completed quiz
and remains local; nothing is sent to an LLM or external service automatically.
Treat third-party answer keys as source claims during discussion.

## Selection and learning

The official CLF-C02 guide weights scored content 24% Cloud Concepts, 30%
Security and Compliance, 34% Cloud Technology and Services, and 12% Billing,
Pricing, and Support. Largest-remainder rounding gives **5 / 6 / 7 / 2** questions
for a 20-question practice quiz and **16 / 19 / 22 / 8** for a 65-question exam. This is approximate practice allocation, not an
attempt to reproduce AWS unscored items or scaled scoring.

Quiz setup uses a compact multi-select dropdown on desktop and a modal bottom
popup on phones. The collapsed control summarizes selected banks as Official and Third-party groups,
with each group’s selected-bank count and total questions. These are bank totals,
so duplicate questions across banks can be counted more than once. Inside,
each available CLF-C02 bank has a checkbox and its total question count, grouped
as Official or Third-party. Done or Escape closes the picker; desktop outside
clicks also dismiss it. Choices apply immediately and survive dismissal. All banks start checked;
Select all and Clear provide bulk controls. At least one bank must be checked.
Selected banks contribute to the eligible pool; random draws do not guarantee
that every checked bank appears. Quiz setup always mixes single-answer and multiple-answer questions.

The shared `/api/quizzes` API accepts `mode: "quiz" | "exam"` and persists it
with each attempt; omitted mode means quiz for backwards compatibility. History
summaries identify the mode, and each screen shows only its own completed results.
The API persists explicit `sourceIds` with each new attempt and rejects empty,
repeated, unavailable, or unrelated-exam IDs. Existing requests/saved attempts
using the older official/third-party/mixed `sourceFilter` remain supported. When
both are supplied, eligibility is their intersection; the GUI sends mixed plus
the checked IDs. Exact normalized duplicate fingerprints appear at most once
per quiz, with official attribution preferred in a mixed pool. Conflicting keys
block selection. Both question and answer order are shuffled. Insufficient
mapped questions in any domain cause an actionable error rather than silently
changing quotas or repeating questions.

Mastery and scheduling now use scored completed snapshots, submitted answer sets,
optional confidence, and stable key-aware identities. The old `quiz_mastery` streak
table is retained for compatibility only and is never used by the scheduler.
See [mastery and Due Review](mastery.md) for transitions, recovery, calendar rules,
legacy evidence, report filters, and evidence thresholds. Extra practice uses the
existing **3×** weight versus normal **1×**; these are application defaults, not
scientific learning claims. Same-day practice remains eligible and scores normally.

## Separate domain mapping

`src/server/quizzes/domain-mapping.ts` derives selection metadata without editing
bank files or classifications. Explicit `source_metadata.domain_id` values 1–4
are used first. Otherwise these documented study categories map as follows:

| Study area or topic                                                                                            | Domain                                                    |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Cloud Concepts                                                                                                 | 1                                                         |
| Security & Compliance; Identity & security                                                                     | 2                                                         |
| Cloud Technology & Services; service-specific Compute, Storage, Networking, AI/ML, Database, Application areas | 3                                                         |
| Billing, Pricing & Support; Billing & support                                                                  | 4                                                         |
| Cloud fundamentals                                                                                             | 1, except infrastructure/Regions/AZs/content delivery → 3 |
| Compute: EC2 purchasing options                                                                                | 4                                                         |
| Management: CAF and Well-Architected                                                                           | 1                                                         |
| Management: Control Tower                                                                                      | 2                                                         |
| Management: Trusted Advisor checks                                                                             | 4                                                         |
| Migration: strategies and assessment                                                                           | 1                                                         |
| Migration: AWS Partner Network                                                                                 | 4                                                         |
| Migration: DMS, MGN, Storage Gateway                                                                           | 3                                                         |
| Operations: CloudTrail, Config, secure Session Manager access                                                  | 2                                                         |
| Operations: CloudWatch metrics/log analytics                                                                   | 3                                                         |

These are our study-selection interpretations, not official question labels or
accuracy verification. Cross-cutting services can appear in multiple official
domains; mappings use the supplied study topic. Unrecognized areas/topics remain
unmapped and are excluded, with shortage errors if necessary. Classification
accuracy can be improved separately without modifying the source banks.

Reference checked 2026-10-18: [official CLF-C02 exam guide](https://docs.aws.amazon.com/aws-certification/latest/cloud-practitioner-02/cloud-practitioner-02.html).

## Local persistence and abandonment

Schema version 2 adds quiz snapshots and fingerprint mastery alongside the
existing library. The version-1 upgrade is additive and transactional; it does
not delete or replace library rows. Quiz snapshots have no cascading foreign
keys to sources, so later deletion/import changes cannot rewrite past results.
Only completed attempts update shared mastery across quizzes and exams. Repeated submission is idempotent.

**Pause** saves current answers first, then freezes the server-owned remaining
time. A failed save or pause shows an error and leaves the attempt running. A
paused attempt cannot expire, accept edits, or be submitted until resumed; pause
and resume do not grade answers or update mastery. Resume restores exactly the
remaining time, even after a browser or server restart. Repeated pause/resume
requests are idempotent. A pause arriving at or after the deadline does not undo
normal scoring.

Paused attempts can be left safely. On returning to Quiz or Exam, the setup screen
shows a Continue button for that mode's paused or active attempt. Reopening a
paused attempt keeps its clock stopped until Resume is pressed. Recovery returns
to the first incomplete answer. Another mode can be started without discarding a
paused attempt; a second attempt in the same mode is blocked until the paused one
is resumed or abandoned.

Leaving an active quiz or exam through **in-app navigation** saves the latest
answers, confidence, and review marks, then pauses the same attempt on the server
before opening the destination. Navigation waits for pending starts, answer saves,
manual pause/resume, submissions, and setup/Continue recovery reads. An active
attempt offered on setup is suspended even if Continue was never pressed.
Unknown recovery state blocks navigation and starting new work; retry recovery
or navigation after a read failure. Reviewing an older result does not bypass
recovery of unfinished work in that mode. A failed start, save, or pause retains the
current page and shows the error; retry the action or navigation. If a start
response is lost, recovery checks the server's current attempt before allowing
navigation or another start. If recovery also fails, navigation remains blocked
until that check succeeds. Concurrent navigation requests do not discard work.
A pause accepted at or after the server deadline still scores the previously
saved answers normally; suspension cannot undo expiry.

**Abandon** remains a separate, confirmed discard action. It removes the unfinished
snapshot entirely: no saved result, history entry, or mastery change. Reads and
answer submissions for a discarded attempt return 404; repeated abandon requests
succeed with `null`, so a lost response does not block retry. Completed results
remain unchanged.

**Browser unload is different:** reload, close, or leaving the site retains the
existing `beforeunload` warning while starting, active, or waiting for a mutation.
An uncertain start also warns until recovery succeeds. There is no guaranteed
asynchronous save or pause during unload. Saved active attempts can be reopened,
but their server deadline keeps running unless a pause was accepted. Active
overdue attempts still score normally. Switching browser tabs has no pause or
resume semantics. All completed results remain available through the history list for
their mode and through the Reports dashboard.

### Pause history and study time

New snapshots persist `pauseHistory: { complete: true, intervals: [] }` in the
existing SQLite JSON session data; no schema migration or rewriting old snapshots
is needed. Each accepted pause appends its server start timestamp, nullable end
timestamp, and available cause (`manual` or `navigation`). Resume closes that
interval and restores the frozen remaining time. Repeated pause/resume requests
in the same state do not append intervals, change the cause, or extend the timer.
Older clients can still send an empty pause body; their cause is not recorded.

Paused screens, completed results, report attempt details, the study journal, and
Markdown exports distinguish **Active study**, **Elapsed**, **Pauses**, and
**Total paused**. Details and individual exports list every recorded interval,
its cause, timestamps, and duration. All durations use HH:MM:SS, truncating each
millisecond duration independently to whole seconds. Elapsed is start to finish
(or current server observation for unfinished work); total paused sums intervals;
active study subtracts paused time from elapsed. These timing fields do not
change score, answer accuracy, targets, or mastery. The report API retains its
older `durationMs` field as wall-clock elapsed time and adds explicit `timing`.

An open interval is labeled **Ongoing**, with its duration calculated as of the
returned `serverNow`; the paused page refreshes that observation every five
seconds. It is never represented as resumed. Legacy snapshots without complete
history show **Not recorded** for pause count, total paused, and active study
time, while retaining known elapsed time. A legacy current `pausedAt` or later
recorded intervals can still be displayed, with unknown historical causes left
unknown; newly recorded intervals do not make earlier history complete.
Viewing unfinished timing never scores it or adds it to performance reports.

If a resume response is lost, the client reads the server status before trusting
the old paused snapshot. A confirmed active attempt shows its running timer and
must save and pause successfully before in-app navigation. If the read fails,
the page shows **Attempt status unconfirmed**, warns that the timer may still be
running, and retains the unload warning. Navigation retries the status check;
polling can also recover it. **Retry resume** explicitly continues the attempt,
and **Abandon** remains a separate confirmed discard action. Polls begun before
a pause/resume mutation cannot overwrite its newer state or recovered status.

Development browser verification uses a disposable synthetic database under
`private/verification/`, leaving private question banks and the user's library
untouched.

## Deleting completed results

**Delete result** is available in completed Practice results and individual Reports.
It immediately removes the attempt from completed history, reports, home readiness,
mastery, Due Review, and question-selection history. Source banks and other attempts
are unchanged. No confirmation dialog is required.

The completed-results list in Practice setup retains pending deletions in place. Normal
rows show a clickable date and score for review, with a trash icon on the right. Pending
rows show the original date and score, “Will be deleted on” with the deadline, and an undo
icon on the right. There is no separate recently-deleted section or confirmation button.
The list is scoped to the selected certification and practice mode. Results deleted from
Reports can also be restored from the matching Practice setup (or Due Review setup).

Undo is available for 48 hours from the original deletion. It restores the original
snapshot and completion time, and recalculates study evidence. Pending rows remain
excluded from all stats and scheduling. Icons have accessible labels and tooltips.
The API retains `DELETE /api/quizzes/:id?permanent=true` for explicitly requested forced
deletion; final deletion otherwise happens automatically after the window.

Deleted snapshots and their deadlines survive restarts and source deletion. Expired
snapshots are purged by the server maintenance timer, on startup, and before deletion
management operations. While the app is stopped, cleanup waits until it runs again;
restoration is rejected at or after the deadline. Downloaded Markdown reports remain
outside the app and are unaffected.

## Reports

Open **Reports** for a master view, or select **Quizzes** / **Exams** to filter
saved results by practice mode. All time, 7-day, 30-day and 90-day views use the
attempt's completion time; daily chart dates are UTC. Reports are scoped to the selected
provider and certification. AWS CLF-C02 has configured domain mapping; other certifications
show saved question/topic activity with “Domain mapping not configured” instead of domain
coverage or focus rankings. Reports recognize the practice session `mode` field and treat
legacy snapshots as quizzes.

- **Correct-answer activity** counts every correct question appearance across the
  selected completed attempts. Repeat questions count each time; this is study
  activity rather than a count of unique mastered questions.
- **Score** divides correct answers by all questions, including skipped ones as
  misses. Headlines, domain summaries, confidence groups and daily performance
  charts use this same denominator. Aggregates sum correct and total questions,
  rather than averaging attempt percentages. An attempt meets the existing 80%
  practice target using the unrounded fraction. No questions means no measured
  score; an all-skipped attempt has a measured 0% score. Practice targets are not
  AWS scaled scores or predictions of exam readiness.
- **Accuracy on answered questions** appears only in detailed views, with answered
  and skipped counts nearby. It divides correct answers by answered questions;
  partial multi-select answers are answered and incorrect. No answered questions
  means no accuracy measurement. Accuracy has no practice target marker.
- **Domain summary** shows score with the 80% practice target. **Study details**
  shows score, labeled answered-question accuracy, and outcome counts by domain,
  saved study area and topic. Missing classifications remain unclassified.
  Domains explored counts domains with completed question appearances. The focus
  suggestion uses the lowest measured domain score, including skipped questions;
  repeat questions and small samples still limit its evidence. Mastery and unique
  question rules are unchanged.
- **Progress chart** switches between daily score (daily correct / daily total)
  and cumulative correct-answer activity. The cumulative count is activity, not
  unique-question mastery. Only the score chart has the 80% target marker.
- **Study journal** opens any completed attempt with domain results and saved
  answer review. Filter questions by domain, incorrect, skipped or flagged;
  expand a question for choices, selections, correct answers, confidence and
  provenance. The answer keys are the stored source keys, not independently
  verified explanations.
- **Export report** downloads the current filtered master report as Markdown.
  Individual attempt reports include question-level answer evidence.

Reports use saved session snapshots and survive bank changes or deletion.
Deleting a question bank adds a **Contains obsolete / deleted questions** indicator to attempts
that drew questions from it, including mixed-bank and paused attempts. Results,
history lists, individual reports, and newly generated Markdown exports identify
the deleted bank. Home shows the count of affected completed attempts per
certification; Reports counts them within the selected mode/date filters and
also warns when affected lifetime mastery evidence lies outside those filters.
These attempts still contribute to scores, mastery, Due Review, and readiness.
Reimporting a bank does not remove the historical indicator or alter saved answers.
Pending result deletions remain excluded; restoring one retains its bank indicator.

New attempts save the bank ID for each drawn question. Legacy snapshots are
matched at bank deletion using saved certification, bank name/type, question
reference, and selected bank IDs when available. Ambiguous matches stay unknown,
including across subsequent deletions. Banks deleted before this feature cannot
be reliably reconstructed, so their old attempts are not retroactively marked.

Active, paused, and abandoned attempts do not contribute; expired attempts are scored
before reports are read. The report API returns aggregate evidence and attempt
summaries without internal mastery fingerprints or question answer keys. All
report generation and downloads remain local.

## Browser regression checks

`tests/quiz-navigation.browser.ts` exports `navigationCheck(mode, outcome)` for
both `quiz` and `exam`. Outcomes are `leave` (delayed start), `failure` (rejected
start), `lost-start`, `recovery-failure`, `save-failure`, `pause-failure`,
`pending-save`, `pending-save-failure`, `pending-pause-failure`, `lost-pause`,
`manual-race`, `resume-race`, and `submit-race`. It checks suspension, retained
identity/edits, error/retry behavior, recovery, explicit resume, report exclusion,
and eventual single completion. `tests/practice-controls.browser.ts` checks autosave,
Previous/Next, review metadata, pause, recovery, resume, and menu abandonment.
`tests/practice-reading.browser.ts` checks the final-question review transition,
review highlighting, readable controls, and warning placement without layout shifts.
These browser-only checks are separate from `npm test`. Run against a disposable
populated database: transpile each exported function with TypeScript's ESNext
module target, evaluate it in the app page, and call it with each documented mode
and outcome. Vite intentionally does not serve the tests directory.

`tests/setup-recovery.browser.ts` exports `setupRecoveryCheck(mode, outcome)` for
both modes. Outcomes `loaded`, `pending`, `read-failure`, `pending-failure`,
`continue-failure`, `history-pending`, `retry-button`, `completed`, `paused`, and
`no-current` exercise recovery before Continue, delayed/failed reads and retry,
and viewing completed history while recovery is pending. The checks inspect the
real server for retained identity/answers/confidence/flags, frozen remaining time,
pause cause/count, unchanged unfinished report totals, explicit resume, and one
eventual completion. Each run prepares synthetic attempts through the public API.
Outcomes `history-return`, `history-return-no-current`, and
`history-return-read-failure` return from completed history before recovery finishes,
then verify that a fresh read restores Continue, enables a working Start, or exposes
a retryable error.

`tests/quiz-resume.browser.ts` exports `lostResumeCheck(mode, outcome)` for both
modes. It forwards Resume to the real server and loses the response. Outcomes
`leave`, `read-failure`, `pause-failure`, `poll-recovery`, and `stale-poll` cover
safe navigation, failed reconciliation/retry, a lost navigation-pause response,
recovery by polling, and a delayed pre-resume paused poll. Each checks retained
answers/marks, exactly two pause intervals, frozen remaining time, unfinished
report exclusion, explicit resume, and one eventual completed report entry.

`tests/pause-recovery.browser.ts` exports `preparePauseRecovery(mode)` and
`verifyPauseRecovery(saved)`. Prepare both modes, retain the returned objects,
stop and restart the disposable app server with the same synthetic database,
reload the page, then verify each object. This checks frozen remaining time and
persisted intervals across an actual restart, ongoing server-time refresh,
explicit resume, and journal/detail/Markdown timing. It leaves completed synthetic
results for layout inspection.

The question card has no outer border. The answer-choice group reserves room for
six single-line choices so Confidence and Mark for Review stay aligned when moving
between four, five, and six choices. Longer wrapping choices can grow naturally;
there is no nested scrollbar or clipped answer text. Confidence's Clear action is
compact and resets only the confidence choice.

Scored reports use dark neutral answer text, darker green status text, and a dark
green accent on correct choices. `tests/practice-spacing.browser.ts` checks the
four/five/six-choice layout, compact Clear action, review wording, and scored-answer
contrast. The reading regression also verifies each warning's 30-second dismissal
without changing the reserved toolbar layout.

`tests/reports-layout.browser.ts` checks confidence bars remain full-width below
their labels when both practice and report stylesheets are loaded. Run it with
at least one completed synthetic attempt in the disposable database.

`tests/score-reports.browser.ts` checks score-first headlines, weighted master
and mode/date filters, the daily score plot and chart data, domain zero/no-data
states, labeled detailed accuracy, individual reports, and quiz/exam results.
Create a fresh disposable database using
`node tests/seed-score-reports.ts private/app/score-browser.sqlite3`, then launch
with `STUDY_DB_PATH=private/app/score-browser.sqlite3 STUDY_PORT=5193 npm run dev`.
Transpile and run `scoreReportsTest()` using the browser-only workflow above.
The seed refuses an existing path and adds only synthetic snapshots: an 8/20 quiz,
a 52/65 exam at the exact target, and an older all-skipped quiz. No private banks
or personal study database are needed. Restart from the app start page for each run.

## Internal question identity foundation

The internal `question-identity.ts` helper composes a versioned mastery identity
from the exact provider/certification namespace and the importer's content
fingerprint and answer key. It reuses importer text normalization and unordered
answer text semantics. Source IDs, references, classifications, and choice order
are excluded; content, question type, correct answer text, and required choice
count distinguish identities. Existing exact-duplicate selection is unchanged.

Completed snapshot identity uses only saved question text, choices, type,
`selectCount`, and correct answer IDs (public completed evidence and/or private
saved keys). IDs are matched to saved answer IDs, not array positions. Both keys
must agree when present. Missing, invalid, or ambiguous evidence returns `null`,
including duplicate normalized choice text. Snapshots are never mutated or
resolved against the current library, so deletion and key edits preserve history.
Legacy app-created quizzes are exclusively AWS CLF-C02; snapshots lack a saved
certification namespace, so this helper supports that legacy contract only and
must not be used to infer other certifications. The mastery scheduler and unique reporting use this helper internally; identities
and answer-key hashes are omitted from public aggregate responses. Concept
grouping is outside this feature.

## Reviewed concept variations

The library can suggest question groups from matching area/topic labels, but
only explicitly reviewed and activated groups influence normal quiz/exam draws.
Eligible variations prefer less recent completed appearances within the same
domain and individual practice priority. Domain quotas, exact duplicate
suppression and selected source/type filters remain in force; unavailable
alternates do not block otherwise eligible questions. Dedicated Due Review
continues to select the actual due identities. Saved labels survive later group
and source changes. See [reviewed concept groups](concepts.md).

### Certification scope

Quiz options accept optional `provider` and `certification` strings. Omitted fields default to
`AWS` and `CLF-C02`, including historical snapshots without identity fields. New attempts persist
both fields. `GET /api/quizzes`, `/api/quizzes/current`, and `/api/quizzes/due` accept the same
query parameters. Recovery and paused-attempt conflicts apply to the full provider/certification
pair and mode; starting another scope or mode preserves its unfinished work. Explicit source IDs
must all belong to the requested pair.

AWS CLF-C02 retains its mapped domain quotas. Other certifications use a generic 20-question
quiz or 65-question exam, drawn without domain quotas and including unclassified questions.
They require enough unique eligible questions; generic snapshots use domain `0` (Unclassified).
Review uses the same scoped lifetime mastery schedule and selects up to 20 eligible due questions.
Deleted questions remain overdue and count as unavailable only within their certification scope.

`GET /api/reports` accepts the same pair alongside mode and time filters. Both lifetime mastery
and selected report evidence belong to that pair. Non-CLF reports show neutral saved-topic
activity without domain coverage or focus rankings; no official domain mapping is inferred.
Legacy mastery identities retain their original
`mastery:v1` format and AWS CLF-C02 namespace.

`tests/result-deletion.browser.ts` exports `resultDeletionCheck(lostRestore, staleRead)`.
Run it only against disposable populated data, using `(false, false)` for normal undo,
`(true, false)` for a committed restore with a lost response, and `(false, true)` for
an older recovery-list response arriving after undo. It checks completed-history
exclusion/restoration and the absence of confirmation dialogs.

`setupResultActionsCheck()` in `tests/result-deletion.browser.ts` verifies the setup
review link, inline delete/undo icons, retained pending row with its deadline, and
restoration followed by opening the result.

`bankDeletionReportCheck()` in `tests/bank-deletion.browser.ts` exercises the actual
Reports page through an empty Due Reviews filter and back to Master report. Run
with AWS CLF-C02 selected in a disposable library containing completed attempts
whose bank was deleted and no completed Due Reviews. Use the browser-only
transpile/evaluate workflow above. The check verifies that lifetime deletion
evidence remains visible in the empty state and that returning to all-time Master
report does not claim affected attempts lie outside its filters.

`bankDeletionHistoryLayoutCheck()` in the same file checks completed-history dot,
text, and badge alignment. Run it at desktop and mobile widths with a completed
quiz from a deleted bank. The longer badge wraps under the result text on narrow
screens while preserving the dot column and avoiding horizontal scrolling.

`tests/practice-history.browser.ts` exports `practiceHistoryTest()` for a disposable
populated AWS CLF-C02 workspace. It creates quiz/exam results and checks the shared
history, type markers, setup placement, compact header, and cross-preset result navigation.
Bundle it with its helper before evaluating in the browser; it soft-deletes its own
fixtures afterward. `practicePresetsTest()` also checks counts, durations, bank selection,
keyboard focus, and independent recovery with the presets inside setup.
