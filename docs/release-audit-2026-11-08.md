# Voyafundra release review — 2026-11-08

## Requested release scope

The beta release combines four requested workstreams:

1. Reliability, cross-device conflict protection and backups.
2. Smarter trip budgeting and monthly savings insights.
3. Departure countdowns and per-trip travel checklists.
4. Code, functionality and UX review before merging to main.

## Code and architecture audit

- Static frontend; no bundler, secrets or service-role key in frontend.
- Supabase email authentication, per-user trips and owner-only RLS.
- Server-managed revision increments and per-trip revision-guarded
  updates/deletes reject stale changes in the modern app.
- Local recovery drafts are account-scoped, verified when possible,
  and not automatically replayed.
- User-initiated full-account export reads the cloud. Imported backups
  are validated for format and matching account; restores insert only
  missing trip IDs, with explicit preview/confirmation.
- Budget insight formulas use recorded contributions. Travel options
  are alternatives, not cumulative expenses or actual spending.
- Countdown math uses the user's local calendar date. Trip checklists
  are stored within the existing trip JSON row.
- Existing theme-aware calendars, edit form close controls and iPhone
  responsive styles remain in place.
- Trip cards respond to Enter/Space in addition to pointer input.
- Updated documentation accurately reflects Supabase cloud storage,
  backups, and the feature set.

## Automated verification

GitHub Actions workflow run 42479114472 completed successfully:
59 tests passed; no failures. A second pull-request workflow also passed.
Covered by Node-based tests: syntax, static asset links, auth smoke,
cloud writes and stale revisions, conflict resolution, recovery drafts,
calendar date validity, local savings/forecast math, checklists, backup
schema and account checks, and create-only import safeguards.

Vercel reported the beta branch deployment ready.

The live Supabase revision trigger was previously tested with an
authenticated disposable trip in a rolled-back transaction. The two
pre-existing trips remained intact.

## Remaining manual and operational checks

These are not certified by static/unit tests and should not be
misrepresented as having been performed automatically:

- Open the deployed production app on a real iPhone Home Screen PWA and
  Windows desktop, then exercise login, create/edit/delete, checklists,
  calendar selection, budget insight display, refresh and logout.
- Download a full-trip backup and verify the file was saved privately.
- Preview a backup and restore one missing **disposable** trip.
- Test simultaneous device edits and explicit conflict resolution with
  disposable data after both devices have refreshed to the new release.
- Confirm password reset email redirect on the production domain.
- Observe cloud status, iPhone safe-area layout, and the update prompt
  in a previously installed Home Screen app.

## Known operational limitations

- Older browser tabs running the legacy whole-list saver can overwrite or
  delete newer trips despite the new server revision column. Users should
  close/reload all older tabs before editing after release.
- Browser recovery drafts are stored locally and are not encrypted or
  guaranteed to survive storage clearing/private mode.
- Backup import is create-only; it intentionally does not overwrite trips.
- There is no automatic cross-device field-by-field merge, live FX feed,
  transactional expense tracker, or offline-first write queue.
- Supabase security advisor reported leaked-password protection disabled;
  this should be enabled in Auth settings when supported.

## Release / rollback

Keep beta-testing for subsequent feature development. Do not remove the
server-managed revision column when rolling back the frontend: its trigger
is additive and legacy client-compatible. If a release regression occurs,
revert the frontend via GitHub/Vercel first, without deleting database
records. Always export a new private data backup before destructive
database operations.

Production release proceeds only on explicit user authorization.
