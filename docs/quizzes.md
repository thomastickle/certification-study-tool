# Quiz and exam flow

The start page links to Quiz, Exam, Reports, and Importer. Both practice modes,
the library/importer, and the Reports dashboard are implemented. Completed results
and local Markdown discussion reports are available within each practice mode
and through the Reports page.

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
shows correct count, raw percentage, and an **80% practice target**: green Pass
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
popup on phones. The collapsed control shows the selected-bank count. Inside,
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

Missed fingerprints get **3× weight** in future draws within their domain.
Three consecutive correct appearances in completed quizzes restore normal
weight; a miss resets that streak. Quizzes where that question is absent do
not count as an answer. Confidence affects review, not grading or repeat weight.
This increases probability without guaranteeing recurrence. No question can
appear twice in one quiz.

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
manual pause/resume, and submissions. A failed start, save, or pause retains the
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

## Reports

Open **Reports** for a master view, or select **Quizzes** / **Exams** to filter
saved results by practice mode. All time, 7-day, 30-day and 90-day views use the
attempt's completion time; daily chart dates are UTC. CLF-C02 is the currently
supported certification. Reports recognize the practice session `mode` field and
treat legacy snapshots as quizzes.

- **Correct answers** counts every correct question appearance across the
  selected completed attempts. Repeat questions count each time; this is study
  activity rather than a count of unique mastered questions.
- **Answer accuracy** divides correct answers by answered questions. Incorrect
  partial multi-select answers are answered and incorrect. Skipped questions are
  reported separately. No answered questions means no accuracy measurement.
- **Raw attempt score** divides correct answers by all questions, including
  skipped ones. An attempt meets the existing practice target at 80% or higher,
  using the unrounded fraction. These are not AWS scaled scores or predictions
  of exam readiness.
- **Domain summary** shows answered-question accuracy with the practice target.
  **Study details** shows correct, incorrect and skipped outcomes by domain,
  saved study area and topic. Missing classifications remain unclassified.
- **Study journal** opens any completed attempt with domain results and saved
  answer review. Filter questions by domain, incorrect, skipped or flagged;
  expand a question for choices, selections, correct answers, confidence and
  provenance. The answer keys are the stored source keys, not independently
  verified explanations.
- **Export report** downloads the current filtered master report as Markdown.
  Individual attempt reports include question-level answer evidence.

Reports use saved session snapshots and survive bank changes or deletion.
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
