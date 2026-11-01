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
