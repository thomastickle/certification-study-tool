# Authentication and question-bank epics

Deliver these epics in order, starting from `master`. Each epic must be usable,
verified, and reviewed before the next changes its feature boundary. The earlier
authentication/private-database stack is retained as implementation and test
reference; its combined rollout is superseded by this plan.

## Epic 1: OIDC login for the existing application ([#57](https://github.com/thomastickle/certification-study-tool/issues/57))

Add a complete login/logout flow with local Keycloak using `openid-client`.
Keep the existing library database, question banks, and study history in place.
The first-stage admission policy is one explicitly configured owner.

Acceptance criteria:

- Anonymous requests cannot read or change study data.
- The admitted identity is established by verified issuer and subject, with
  Authorization Code, PKCE, state, nonce, and ID-token validation owned by the
  standard library.
- Sessions, expiration, restart behavior, local/provider logout, and provider
  outages have documented and tested behavior. No token-refresh loop is added.
- Callback replay, cookie paths, pending-login capacity, cross-site provider
  returns, CSRF, and HTTPS/loopback restrictions retain the relevant regression
  coverage from the earlier work.
- Sign-out preserves the existing practice save/pause guard.
- The existing configured database path and its data remain usable without a
  library migration. Authentication persistence is separate from study storage.
- Local Keycloak startup, owner enrollment, application configuration, Docker
  upgrade, and rollback instructions are part of the delivery.

This epic does not introduce multi-user study ownership, bank roles, or private
banks. Its PR contains the working authentication feature, rather than dormant
primitives that require a later storage feature to become usable.

## Epic 2: Multiple users with admin-managed shared banks ([#58](https://github.com/thomastickle/certification-study-tool/issues/58))

Admit multiple users. Everyone can study the shared question banks; only users
with the admin role can create, import, modify, or delete shared bank content.
Study attempts, progress, and personal study state belong to the individual user.

Acceptance criteria:

- The server enforces shared-bank mutation permissions; hiding UI controls is
  insufficient. Ordinary users can read and study eligible shared content.
- Users cannot read or mutate another user's progress or history, including
  through stale tabs, colliding identifiers, imports, and delayed async actions.
- Identity and role sources, missing-role behavior, role changes, session
  revocation limits, and local development admin setup are explicit and tested.
- Existing owner history is assigned through an explicit upgrade procedure.
  Shared content remains shared, without copying another user's study history.

Choose the storage design within this epic after reviewing its access patterns.
The earlier separate-user-database implementation is useful evidence, not a
requirement to copy a complete shared library into every user's database.

## Epic 3: Shared banks plus user-owned private banks ([#59](https://github.com/thomastickle/certification-study-tool/issues/59))

Let users keep private banks alongside the shared banks. Preserve admin control
over shared content and keep study progress private.

Acceptance criteria:

- Users can create and manage their own private banks and study the shared banks
  available to them. Other users cannot discover or modify their private content.
- Bank ownership and visibility are explicit in server authorization and the UI.
  Identifiers and import previews cannot cross ownership boundaries.
- Practice can select authorized shared and private sources. Saved attempts
  preserve question provenance and remain usable after bank changes or deletion.
- Any future copying or publishing of bank content is a separately reviewed,
  explicit action. It never copies another user's study history.

## Review and delivery

Use the agreed readability skills and existing regression evidence throughout.
Reuse tested security boundaries where they match the current epic; do not carry
later-epic behavior into an earlier one merely because it already exists.
Keep each PR scoped to one feature boundary, with its own executed checks,
independent review, runnable preview, and operational instructions.
