# Certification readiness

Home groups tracked certifications into compact provider cards. A track is created
from an imported bank, supported completed study history, or a user-recorded earned
credential. Multiple banks for the same exact provider/code form one track. The
provider summary counts **exam-ready tracks**, not credentials earned. No catalog,
discovery, credential verification, or recertification integration is included.

Readiness currently supports **AWS CLF-C02** only, matching the practice engine and
the saved-history namespace. Other imported tracks appear with a neutral,
unsupported assessment. They never borrow CLF-C02 scores or its domain blueprint.
Completed CLF-C02 history remains visible after banks are deleted. Aggregate API
responses contain no questions, answers, keys, fingerprints, or internal identities.

## Initial scoring rule

These thresholds are an adjustable product heuristic, not a calibrated probability
of passing an official exam. Red means substantial gaps, yellow means the outcome
is sensitive to the questions drawn, and green means consistently strong evidence
including weaker domains. Green cannot guarantee an official pass.

Use completed evidence within a rolling **30-day** window, ending at the server's
current time. Active, paused, abandoned, future, malformed, and unscored evidence
does not qualify. Reliable identities deduplicate exact question occurrences;
repeated answers are not new coverage. An identity appearing under conflicting
domains in the current window does not establish either domain's coverage.

Assessment requires:

- At least **20 distinct answered questions in each of the four supported domains**.
- Full, correctly scored **65-question, 90-minute exams** with the supported domain
  quotas, reliable distinct questions, and complete, uninterrupted timing history,
  on **three separate study days** in the window.
- At least **13 questions not used in earlier assessed exams** in each follow-up
  exam. This modest initial variation threshold prevents identical exam replay
  from supplying three independent runs; it does not prove question independence.

Study days use America/New_York, consistent with retention scheduling. Choose the
latest three qualifying exam days and retain the **lowest score on each day** so
a same-day retry cannot hide a bad run. Check question variation in chronological
order. Legacy exams without complete pause history remain available in reports
but do not establish uninterrupted exam evidence here.

When these requirements are missing, show **Needs more data** and an unassessed
neutral bar, with specific evidence deficits in Readiness details. Missing evidence
is distinct from measured zero performance.

The blended score is rounded down:

`50% × assessed exam average + 25% × current mastery + 25% × weakest domain score`

- **Assessed exam average** averages the three selected exam-day scores.
- **Current mastery** is the proportion of distinct, reliably answered identities
  in the evidence window that are currently mastered. Replay all reliable completed
  history up to now to determine current state, including history outside the window.
  Skips do not enter this answered mastery denominator.
- **Weakest domain score** is the minimum recent domain correct/total percentage,
  using all reliable completed quiz, exam, and review appearances in that domain.
  Skips count as misses. One identity supplies at most one appearance per attempt.

Red is below **80**, yellow is **80–94**, and green begins at **95**. Green additionally
requires current mastery, every domain score, and each assessed exam score to reach 95. Otherwise cap readiness at 94, even if the blend is higher. Show the component
evidence and cap reason so the score can be explained.

The weights, window, distinct coverage minimum, variation minimum, and green gate
are starting rules to refine against actual study outcomes. Updating them must
preserve the distinction between insufficient evidence and poor performance.

## Earned credentials

Open **Certifications** or **Manage certifications** to mark a tracked certification
earned. This is a user report, displayed as a star beside the Home track name.
It has no effect on readiness, mastery, scheduling, or the provider's exam-ready
count. It survives restart and bank deletion. Unmarking an earned-only track removes
that track unless banks or supported completed history still track it.

SQLite stores earned credentials separately under an independent version-1
certification metadata schema. Writes do not invalidate pending bank imports and
use the API's existing local Host/Origin protections.

## Verification

`tests/home.test.ts` exercises grouping, scoring boundaries, caps, evidence windows,
distinct coverage, exam variation, timing eligibility, same-day retries, and privacy.
`tests/home-http.test.ts` exercises local HTTP access, validation, persistence,
idempotency, deletion, and independence of earned status from readiness.

For browser verification, prepare a new database with
`node tests/seed-home.ts private/app/home-browser.sqlite3`, then run the server
with that path and a separate port. Transpile and evaluate `homeDashboardTest()`
from `tests/home.browser.ts` using the browser workflow in [quiz checks](quizzes.md#browser-regression-checks).
It checks grouping, neutral unsupported tracks, earned stars, serialized writes,
failed saves, unchanged readiness, and Home read retry against a real synthetic
database. `workspaceNavigationTest()` covers the updated navigation independently.
