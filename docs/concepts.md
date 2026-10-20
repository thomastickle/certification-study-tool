# Reviewed concept groups

Open **Importer → Reviewed concept groups** to review local label suggestions or
create a named group manually. Suggestions use complete, identical study area
and topic labels within one provider/certification. The app explains those shared
labels; it does not claim that they prove equivalent meaning. Missing labels do
not create a group. No model, remote service or new bank format is involved.

Inspect question text, answer keys and source occurrences before activating a
group. Each variation shows a library ID, source name and original reference.
Exact copies share one variation in this view, while their separate source
occurrences remain intact. Deselect questions and rename the group before
**Activate reviewed group**. To split a suggestion, activate a named subset;
remaining unreviewed questions can form a later suggestion when at least two
variations remain. A singleton can still be added manually.

Suggestions and dismissed suggestions never affect selection. Dismissal applies
to that exact candidate set; changed content or a changed set can produce a new
candidate. Reviewed identities are omitted from subsequent label suggestions;
manual editing can add them to another explicit group. Multiple membership is
allowed. A–B and B–C groups do not make A and C equivalent.

**Edit group** changes the selected members and name. Names must be distinct
within the provider/certification, ignoring case and repeated whitespace. A group
cannot change certification. **Rename only** preserves all reviewed members,
including identities that are currently unavailable. Saving the member selection
replaces membership with the selected current variations. **Delete group** removes
the live mapping after confirmation; saved results retain their original labels.

## Normal quiz and exam selection

The existing weighted draw first determines a question and its practice priority
(normal or boosted by individual mastery evidence). Within the same domain and
priority, direct reviewed siblings prefer the least recent **completed** saved
appearance; never-seen variations are first. Equal recency remains randomized.
Starting, pausing or abandoning an attempt does not change recency or mastery.

When a draw would repeat a reviewed group already represented in the attempt,
the selector first tries other eligible questions at the same priority in that
domain. It then applies the direct-sibling preference. Overlapping membership is
checked directly rather than through a transitive graph. If availability or the
quota requires several variations from one group, they remain usable. An exact
duplicate question still appears at most once.

Source/type filters, conflicting-key checks, official duplicate attribution and
quiz/exam domain quotas remain in force. A sibling outside the eligible pool or
at another priority cannot replace the draw. A grouped question with no such
alternate displays a short explanation. Unclassified and ungrouped questions
remain usable under the existing domain-mapping rules.

**Due Review bypasses variation preference.** It selects the actual due question
identity. Success on B cannot satisfy A's due retention check or transfer mastery
to A. There is no concept-level mastery score or aggregation. See
[mastery and retention](mastery.md).

## Persistence and HTTP

Reviewed concept metadata is separate from imported bank content. Membership
uses `currentQuestionIdentity`, including exact certification/provider and
normalized question/answer-key semantics. Content or key edits cannot silently
inherit an old mapping. Classification-only edits preserve it. A newly imported
exact occurrence can share the reviewed identity. Review tokens reject stale or
cross-certification member submissions before an atomic write.

The additive concept migration runs transactionally and has its own
`concept_schema` version 1 marker. It adds `reviewed_concepts` and
`dismissed_concept_suggestions` without changing the existing library/quiz schema
version or rewriting source/question/session rows. Identities have no cascading
source foreign keys: source deletion leaves reviewed identities unavailable
rather than mapping them onto replacement content.

New attempt snapshots save concept IDs/names and any no-alternate explanation.
Quiz results, Reports answer review and Markdown exports use those saved labels;
renaming/deleting a group or editing/deleting a source never changes past labels.
Legacy snapshots without concepts remain valid and are not relabelled.

All routes use the existing loopback host/origin checks and bounded JSON reader:

- `GET /api/concepts`: reviewed groups, inactive suggestions and reviewable library variations.
- `POST /api/concepts`: activate a reviewed group with scope, name and member ID/token pairs.
- `PUT /api/concepts/:id`: replace selected membership/name; omit members to rename only.
- `DELETE /api/concepts/:id`: delete a live mapping.
- `POST /api/concept-suggestions/:id/dismiss`: dismiss the current candidate without activation.

Public responses contain provenance and opaque review tokens, not internal
mastery identities or importer fingerprints/answer-key hashes.

## Verification

`tests/concepts.test.ts`, `tests/concept-variations.test.ts` and
`tests/concept-integration.test.ts` cover storage, validation, identity changes,
selection, quotas, filters, priority, snapshot survival and Due Review isolation.

`tests/seed-concepts.ts` creates a dedicated synthetic database at
`private/ai-runs/issue16/browser.sqlite3` and refuses existing populated content.
Run the app with `STUDY_DB_PATH` set to that path. As with the other browser-only
regressions, transpile `tests/concepts.browser.ts` with the existing TypeScript
compiler, evaluate it in the app page, then call `conceptsBrowserTest()`. It checks
suggestion review, subset activation, edits, removal, manual creation, dismissal
and a UI-started quiz selecting the unseen sibling with unchanged domain quotas.
It creates and cleans up test groups and abandons its unfinished test attempt.
Use only a disposable database; it must start with the seed's history and no groups.
