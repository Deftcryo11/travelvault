# Voyafundra server-managed trip revisions

## Applied on existing Supabase project

Migration `20261108113145_add_server_managed_trip_revision` was applied to the
**existing** TravelVault Supabase project's `public.trips` on 2026-11-08.
No separate testing database was created.

The migration is additive: a `revision bigint not null default 1` column and
a `BEFORE INSERT OR UPDATE` trigger were added. The trigger:
- sets revision to 1 on insert;
- increments revision from the previous stored revision on update;
- assigns `updated_at` on the server (strictly increasing even if necessary
  to advance the microsecond timestamp).

All existing trip records are retained. A full JSON snapshot of the two rows
was exported privately before migration and **must not be committed to GitHub**.

### New beta client contract

- `loadCloudTrips()` and `refreshCloudTripsSafely()` select `revision`.
- Each per-trip UPDATE and DELETE filters by `user_id`, `id`, and its
  last confirmed `revision`. Stale revisions match zero rows.
- An UPDATE sends only `trip_data` and reads back `updated_at,revision`.
- New-trip INSERT uses `insert`, never upsert. It reads the server-generated
  revision from the response.
- Conflict review checks the current revision before accepting the cloud copy.
- Choosing to overwrite with a local copy requires explicit user confirmation
  and a revision-guarded update, so edits made after review are rejected.

### Compatibility and known release gate

Before the beta-to-main release, `main` used full-list upserts and
snapshot-inferred deletions. The database trigger keeps those older client
columns compatible but **does not prevent already-open legacy tabs from
overwriting newer edits or deleting trips inferred from stale snapshots**.

The database revision migration alone is not enough to eliminate those
legacy-client hazards. Keep production and beta sessions from editing the
same real trip concurrently; use disposable test trips until the old
full-list writer is phased out safely. Do not merge until all users' active
clients are addressed and PC/iPhone end-to-end tests pass.

### Database verification

- Owner-only SELECT/INSERT/UPDATE/DELETE policies were inspected and RLS is on.
- Two existing trips remained at revision 1 immediately after migration.
- A disposable authenticated trip INSERT, revision-guarded UPDATE and a
  stale revision-guarded UPDATE were tested in a rolled-back transaction.
  Both the increment and the zero-row stale write behavior were verified.
- No disposable trip record remained afterwards.
- Supabase security advisors reported one existing configuration warning:
  leaked-password protection is disabled. Consult:
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

### Backout / rollback order

1. **First** revert beta frontend to a version using `updated_at` guards,
   or otherwise pause client edits. Do not drop the revision trigger while
   revision-dependent beta code is deployed.
2. Confirm that all trips are backed up and no client is still writing.
3. To revert server-managed revision support, remove the trigger and
   function, then drop the revision column **only after confirming no active
   client needs it**. Dropping a column is destructive to its revision
   metadata; do not do so automatically.
4. Keep existing trip rows and `updated_at` values intact.

No rollback was performed. Production `main` code was not changed.
