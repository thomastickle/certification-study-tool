# Question mastery and Due Review

Only completed, scored attempts supply evidence. Answers/confidence changed before
submission are edits, not extra encounters. Active, paused, and abandoned attempts
never count. Expiry grades saved answers with the same rules. Repeated submissions
and restarts replay one stored result per attempt, without double credit.

Selection boost is independent of mastery and recovery progress. Normal weight is
1; extra practice weight is 3. Neither weight guarantees recurrence. Ordinary quiz
and exam quotas and same-day eligibility remain unchanged.

| Submitted outcome                           | Mastery/recovery                                                                                                                                                             | Selection                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Unanswered                                  | Counts as a miss in the attempt score; no mastery or recovery change. It is a scored encounter, so a later success is not first-ever.                                        | Unchanged                    |
| Correct + Confident, first scored encounter | Mastered on first encounter.                                                                                                                                                 | Normal                       |
| Correct + Educated Guess                    | Unmastered; needs one later confident success in another completed attempt.                                                                                                  | Extra practice               |
| Correct + Unsure                            | Unmastered; needs two later confident successes in separate completed attempts.                                                                                              | Extra practice               |
| Correct + blank confidence                  | No assumed mastery; preserves existing earned mastery and recovery progress. A later confident answer can establish mastery after practice when no other requirement exists. | Normal, even during recovery |
| Wrong + Confident or blank                  | Three later confident successes on separate study days after the miss day.                                                                                                   | Extra practice               |
| Wrong + Educated Guess                      | Two later confident successes on separate study days after the miss day.                                                                                                     | Extra practice               |
| Wrong + Unsure                              | One confident success on a later study day.                                                                                                                                  | Extra practice               |

A later wrong answer resets progress and restarts the miss-day boundary while
retaining the strongest unresolved requirement. Correct answers below Confident
preserve progress without advancing it. Explicit uncertainty cannot weaken an
outstanding stronger requirement and revokes mastered status until recovery is
earned. Uncertainty-only recovery allows separate attempts on the same day; miss
recovery never earns two credits on the same day. Confident successes during an
unresolved recovery retain extra practice priority until mastery is earned.

## Calendar retention

Study days use **America/New_York**, including daylight-saving transitions. Mastery
schedules a check seven calendar days later. Only correct + Confident on/after the
due day passes it. Passing schedules the second check fourteen calendar days from
the passing day. Passing that check ends scheduled obligations in this version.
Early practice cannot advance the schedule. Skips, blank confidence, and explicit
uncertainty leave a due date outstanding. If uncertainty creates recovery during
a due check, completing that recovery with a confident success on/after the due
day can also pass that check. A wrong answer clears the previous retention cycle,
enters miss recovery, and schedules a fresh seven-day check when mastery is earned
again. No study, filtering, bank edits, or deletion silently clears overdue checks.

Open **Due Review** from the main navigation. It displays total due questions,
oldest due study day, eligible count, filter exclusions, and unavailable identities.
Select banks explicitly. Up to twenty eligible due questions are selected oldest
first, with a twenty-minute timer and the existing save/pause/resume/abandon flow.
The API also respects source-kind and question-type filters. It never substitutes
another source when requested filters exclude due questions. A changed answer key
or content creates a different identity; an old due identity can remain unavailable
until matching content is restored. Unmapped questions remain filter-ineligible.
Quiz/exam domain quotas are preserved because review has its own mode and selection
path. Review scores are correct/total activity; reviews have no pass target and
are excluded from quiz/exam target-met denominators.

## Reports and evidence

Activity counts remain repeat-inclusive appearances, including skipped score
penalties. Unique coverage counts distinct reliable identities encountered and
answered in the selected certification/mode/date scope. Mastery is **lifetime
current status for those identities**, calculated using all completed history,
including evidence outside the current date/mode filter. First-encounter versus
after-practice mastery is never recomputed as first-ever within a date window.
Unknown identity appearances and unknown mastery-evidence appearances are labeled
separately. These counts can overlap. Aggregate responses/exports contain no
internal identity, fingerprint, answer key, or question content.

A focus recommendation requires **each of all four supported CLF-C02 domains**
to have at least ten distinct answered questions across at least two completed
attempts in the current filter. Repetition does not increase the distinct count.
Every domain shows its distinct answered count, contributing completed-attempt
count, and answered appearances. Once all qualify, ranking uses the existing
**score = correct / all appearances**, including skips; ties use domain order.
This is a starting product heuristic, not statistical confidence or exam readiness.
Insufficient evidence names no weakest domain. UI and local Markdown exports use
the same aggregate evidence and filters; Due Reviews have an explicit mode filter.
Daily activity charts retain their existing UTC dates, separately from study-day
scheduling in New York.

## Replay and legacy data

The identity helper uses saved content and agreeing saved correct IDs, never a
current bank lookup. See [identity rules](quizzes.md#internal-question-identity-foundation).
Reliable replay additionally requires a valid completion/start time, submitted
selection, recognized confidence (including explicit null), and a scoring result
consistent with the saved key. Missing confidence is unknown, not blank. Malformed
entries supply no mastery/recovery credit. A known identity with incomplete earlier
evidence prevents a later success being labeled first-ever; missing time is ordered
conservatively before dated evidence. Unknown identities cannot be deduplicated or
credited. The legacy streak table does not reconstruct confidence or recovery.

Replay orders completed evidence by completion timestamp, then attempt ID for
stable timestamp ties, and processes an identity at most once per attempt. No new
schema or bank-data migration is needed. Replay is currently in-memory over local
snapshots; larger libraries may need profiling and a materialized cache later.

## Verification

`tests/mastery.test.ts`, `mastery-history.test.ts`, `mastery-report.test.ts`, and
`due-review.test.ts` exercise transitions, DST, skips, replay, report gates/filters,
unknown evidence, due exclusion/deletion, expiry, pause, and idempotent completion.
The browser check `masteryBrowserTest()` in `tests/mastery.browser.ts` uses a new
synthetic database prepared by `node tests/seed-mastery.ts <new-path>`. Run the
server against that database, transpile the browser function as documented in
[quiz browser checks](quizzes.md#browser-regression-checks), and evaluate it in the
app page. It exercises Due Review, saves, navigation pause/recovery, submission,
report filtering, unique metrics, and local export.
