# Question-bank files

This increment prepares local JSON data only. No application importer, database,
quiz, exam, report, or frontend has been implemented.

## Files and privacy

Working banks are in `private/question-banks/`. The entire `private/` directory
is ignored by Git. Database files and SQLite sidecar files are also ignored.
Neither study banks nor personal databases may be uploaded. Git ignore rules
prevent ordinary accidental staging; they do not control future application
network behavior. No database was copied or opened during this work.

Original files in the Python project remain unchanged. The local
`private/audit/manifest.json` records their paths, SHA-256 digests, and counts.
Preparation and verification scripts in `private/` are one-off local tooling,
not the future application's implementation or a Python runtime requirement.

## Vocabulary and representation

- **Certification:** provider, exam code, and exam name in `certification`.
- **Source:** the origin of a bank, independent of its classifications or accuracy.
  `source.type` distinguishes `official` from `third_party`.
- **Source reference:** a question identifier within a particular source.
- **Study area:** a broad subject such as Networking or Compute.
- **Study topic:** a more specific subject within that area.
- **Exam domain:** an exam-blueprint category, distinct from study area/topic.
  Existing third-party domain labels remain in `source_classification` and
  numeric domain IDs remain in `source_metadata`. No domain assignments were
  invented for official questions that lacked them.

All four working banks use the existing version-2 representation documented in
[question-bank.schema.json](question-bank.schema.json), copied from the original
project. This schema is a compatibility reference for these prepared files, not
an implemented importer contract. Every working question now has
`classification.area` and `classification.topic`.

Existing official study classifications remain unchanged. Third-party
classifications are inferred from question content, using the existing area
vocabulary and reusing or adding topics as needed. They are our study labels,
not official AWS classifications. The per-question reasoning method is recorded
in the private classification audit. Assignments were assisted by matching
subject terms and reviewed against question stems; ambiguous matches received
explicit content-review decisions. Classification does not verify answer keys.

Except for the user-approved encoding repairs logged in
`private/audit/text-repairs.json`, question text, answer wording, answer order, answer keys, selection type/count,
explanations, source references, original verification labels/dates, and source
metadata are preserved. Existing source claims of `official_current` or
`verified_current` were not independently reverified. No new accuracy or
currentness claims were added. The third-party repository attribution, license
notice, and original snapshot identifiers remain intact. Snapshot digests
identify the original input snapshot, not the newly classified output files.

The legacy `selection_group` values were removed from working copies. Their
meaning is not adopted as a requirement.

## Duplicate audit

All source occurrences remain in the banks. Duplicate groups are recorded
separately in `private/audit/duplicate-audit.json`; nothing is merged or deleted.

Comparison uses the question text, unordered answer texts, and selection type.
For comparison only, text undergoes Unicode NFKC normalization, case folding,
replacement of Unicode punctuation with spaces, and whitespace collapsing.
Wording is not paraphrased, and symbols such as `+` remain significant.
Punctuation normalization is a matching convention, not an edit to stored text.
Answer choices that become indistinguishable under this convention must be
flagged for review rather than collapsed.

Correct-answer texts and selection counts are compared separately inside each
duplicate group. Differences are answer-key conflicts requiring review. Similar
wording with different answer choices does not establish a duplicate.

## Checks and pending decisions

`private/validate_banks.py` validates every file against the JSON schema and the
original app's bank validator, checks all counts and required classifications,
and compares content and source metadata against originals. Its execution uses
the Python project's existing virtual environment; nothing was installed.

`aif-q329` was excluded from Cloud Practitioner by user decision and retained
in `private/holding/unassigned-questions.json` with its actual certification
unassigned and original provenance preserved. The holding file is not a bank.
There are 1,197 active bank questions and three held questions. Kendra
questions `q1067` and `q1068` were also set aside by user request; their
source metadata is preserved in the holding file. Approved repairs to nine text fields across seven official
questions have been applied to working copies only; originals remain unchanged. Schema validity does not establish content correctness or
classification accuracy. This preparation has not had independent review.

## Classification references

Consulted on 2026-10-16 for subject boundaries and service categories. These
references inform our classifications; they do not authenticate source banks.

- [Cloud concepts](https://docs.aws.amazon.com/aws-certification/latest/cloud-practitioner-02/cloud-practitioner-02-domain1.html)
- [Security and compliance](https://docs.aws.amazon.com/aws-certification/latest/cloud-practitioner-02/cloud-practitioner-02-domain2.html)
- [Cloud technology and services](https://docs.aws.amazon.com/aws-certification/latest/cloud-practitioner-02/cloud-practitioner-02-domain3.html)
- [Billing, pricing, and support](https://docs.aws.amazon.com/aws-certification/latest/cloud-practitioner-02/cloud-practitioner-02-domain4.html)
