# Voyafundra: Data Protection Foundation

> **Development branch only. Do not merge to `main` yet.**
>
> This work is under review and must not trigger changes to the live Supabase
> schema. The currently connected Supabase project is production.

## Phase 1: guard against silent overwrite and unintended deletion

Before this branch, every local save upserted **all** locally cached trips, then
deleted any cloud trips missing from the local snapshot. A stale iPhone session
could therefore overwrite or delete trips saved on a PC.

The first branch changes:

- Each save targets only the trip being changed.
- Existing trip changes use a conditional `updated_at` equality filter,
  which is evaluated atomically by the database. A 0-row update is treated as
  a conflict; it must not report success.
- New trips use INSERT instead of UPSERT.
- Deleting a trip targets only its ID and last known version; the trip remains
  in the UI until Supabase confirms deletion.
- Failed saves keep an unsaved marker and show an error; refresh and update
  actions must not discard local changes.
- Saving unrelated trips never infers deletion of other rows.

## Important limitations before production release

- `updated_at` is a transitional optimistic-concurrency token. A separate,
  reviewed migration should add a server-managed integer `revision`, and the
  frontend should use it before the release is considered fully protected.
- Other sessions running **older Voyafundra code** can still issue unsafe
  whole-collection saves. Deployment sequencing matters; old-client support
  needs a deliberate strategy.
- Locally pending edits are not durable across forced iOS termination. This
  requires a separate account-scoped recovery-draft feature.
- Conflicts are currently blocked and reported; a detailed comparison/recovery
  UI remains in the next phase.
- Never promise that an update or deletion succeeded before Supabase returns
  a matching row. Never automatically retry a rejected conflict.
- No production Supabase migrations or real-user data changes are authorized
  by checking in source code.

## Acceptance tests before release

1. Desktop edits trip A and iPhone edits trip B: both changes survive.
2. Two devices edit trip A from the same base version: one saves, the stale
   writer is rejected, and the newer database record stays intact.
3. An older phone snapshot cannot delete a trip created on desktop.
4. Two devices attempt to delete/edit the same trip: stale deletion fails.
5. Creating a trip never upserts an existing ID.
6. A failed network save retains an unsaved warning and blocks refresh, logout
   and applying app updates until it can be safely resolved.
7. Unrelated saves do not clear unsaved markers for failed trips.
8. Auth account transitions do not leak trip records between users.
9. Existing budgets, savings and flight details remain unchanged.
10. Mobile and desktop navigation, dark mode and PWA update prompts still work.

## Deployment sequence

1. Review GitHub Actions and inspect changes on the draft PR.
2. Test with dummy accounts/records, preferably against a **separate Supabase
   test project** with production-equivalent RLS policies.
3. Back up production data; verify it can be restored.
4. Design and review the server-managed revision migration separately.
5. Test rolling deployment and stale-client behavior.
6. Merge only after tests pass and the user explicitly authorizes release.

## Rollback

At this stage the live database is unchanged. A rollback would revert only
application code, but a future schema migration must have its own reviewed
rollback procedure and data preservation plan. Never drop trip records as part
of rollback.

## Beta testing policy (November 2026)

- All new Voyafundra UI, security, reliability, and regression-test changes
  are committed to `beta-testing` and tracked in draft PR #5.
- Production `main` is frozen until the user explicitly approves a release.
- The old `feature/data-protection-foundation` work is preserved in the
  `beta-testing` commit history. PR #4 was closed without merging.
- The beta Vercel preview currently uses the existing Supabase project.
  Use disposable trips in a dedicated test account.
- The preview now includes manual side-by-side comparison of a conflicting
  trip's local and cloud values. Users must explicitly confirm whether to
  accept the cloud copy or overwrite a newer cloud copy with the local one.
- Saving a local version uses an `updated_at` compare-and-swap; if another
  device changed that row since the review, the overwrite is rejected.
- Only the selected trip is resolved. Unconfirmed changes in other trips
  are preserved, and no automatic field-level merge occurs.
- Conflict handling and recovery are still **beta**. A server-managed
  revision column, durable offline recovery, and comprehensive device tests
  remain release requirements.

### Beta conflict test matrix

1. Open the same test trip on PC and iPhone, edit and save the PC version,
   then save the older phone copy: save must be blocked.
2. Review unsaved changes on phone, choose the trip, and compare local/cloud.
   The comparison must not modify the database.
3. Accept the cloud copy: only that trip's local conflict resolves.
4. Repeat the conflict and explicitly select local version, after reviewing
   its impact on options and savings. Confirm the result on PC.
5. Change the cloud copy again *after* opening the comparison, before choosing
   local: the stale overwrite must be rejected.
6. Delete the cloud trip on one device and review an older local draft:
   the app must not silently recreate the deleted trip.
7. Keep an unrelated unsaved trip in the same account: resolving one trip
   must not discard the other draft.
8. Check the above behavior on both iPhone Home Screen mode and desktop.

