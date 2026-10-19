# Quiz and exam flow

The start page links to Quiz, Exam, Reports, and Importer. Quiz, Exam, and the library/importer are implemented. Completed results and
local Markdown discussion reports live within their respective practice mode;
the Reports page and charts are deferred.

A CLF-C02 quiz has 20 questions and a server-owned 20-minute deadline. An exam
has **65 questions and a 90-minute deadline**. Both modes share the same bank
picker, answer controls, timing, review, grading, and report flow. Warnings
appear at 10 and 2 minutes remaining, including on the pre-submit review screen.
Answers are saved after each change. At expiry the server scores the saved
choices; unanswered questions and incomplete/incorrect multi-select sets are
misses. Late changes are ignored. A running server checks deadlines every second;
after a server restart it also scores overdue attempts. If a save fails, the UI
shows that the latest changes are unsaved and offers retry. The deadline does
not pause during failures, navigation, or browser sleep.

During an attempt the compact toolbar shows question progress, save status, an
**HH:MM:SS** clock, Pause, and an Actions dropdown. The dropdown offers Review
answers, Submit and score, and Abandon; the question footer contains only Previous
and Next. Answers, confidence, and flags save immediately, without a lock-in step.
The question screen omits the redundant mode heading, question count, and duration
intro. Long content can still scroll naturally; question panels have no nested
scroll containers. The review grid labels answered/unanswered questions and flags.

Each question supports its original single/multiple selection count, optional
confidence (Confident, Educated Guess, Unsure), and a mark for return. The review
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

Leaving an active attempt through app navigation asks before abandoning; Cancel
lets you pause first. Abandoning discards the unfinished snapshot entirely: no saved result, history entry,
or mastery change. Requests for a discarded attempt return 404. Completed results
remain unchanged. Browser reload/close warns
while starting or active, and saved active attempts can be reopened, but their
time keeps running unless explicitly paused. Active overdue attempts still score
normally. All completed results remain available through the history list for
their mode. The Reports page and charts remain deferred.

Development verification uses a separate `private/app/quiz-preview.sqlite3`
copy, leaving the original library and curated import preview untouched.

## Browser regression checks

`tests/quiz-navigation.browser.ts` checks delayed start followed by leave, cancel,
and failure for both modes. `tests/practice-controls.browser.ts` checks autosave,
Previous/Next, review metadata, pause, recovery, resume, and menu abandonment.
These browser-only checks are separate from `npm test`. Run against a disposable
populated database: transpile each exported function with TypeScript's ESNext
module target, evaluate it in the app page, and call it with each documented mode
and outcome. Vite intentionally does not serve the tests directory.
