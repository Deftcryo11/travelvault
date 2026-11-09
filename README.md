# Voyafundra

Voyafundra is a responsive travel budget, savings and checklist planner. The frontend uses plain HTML, CSS and JavaScript. Supabase provides authentication and per-user trip storage; Vercel hosts the site.

## Features

- Separate trips with Planning, Upcoming and Completed status and a history view.
- A multi-person savings tracker with monthly targets and recorded contributions.
- Savings insights: monthly amount needed before departure, recent planned-versus-saved progress, and travel budget comparison.
- Travel options: ticket price in MVR, USD purchased at a manually entered bank rate, stay and extras.
- Countdown to each trip's departure date, using the device's calendar date.
- Editable per-trip travel checklists with completion state and optional due dates.
- Theme-aware date/month pickers, device theme support and responsive iPhone PWA layout.
- Actual expense tracking: paid, planned and refunded entries, MVR/USD conversion
  with saved bank-rate snapshots, category allocations, and expense CSV exports.
- Trip itineraries and bookings with day-by-day plans, provider references,
  local travel times, confirmation status and costs kept separate from spending.
- Saved-by-person forecasts and reusable travel checklist templates with
  categories, priorities and overdue indicators.
- Per-trip printable/JSON reports and a Settings & Data screen.
- Version 2 full-account JSON backup of trips, expenses and itinerary records,
  with create-only restoration and support for earlier Version 1 files.
- Independent trip saves, server-managed revision checks, unsaved-edit review and local recovery drafts.

## Getting started

1. Open the deployed Voyafundra site and sign up or log in.
2. Select New Trip. Set a destination, travel dates, budget, savers and savings schedule.
3. Save and wait for the cloud indicator to confirm all changes have been saved.
4. Open a trip to compare flight costs, track savings, review budget insights and manage the travel checklist.
5. Use Data backup & restore to download a private copy of all saved trips or restore missing ones from your own account's backup.
6. Find completed trips under Completed Trips.

## Financial definitions

All budgets and savings are displayed in MVR.

Estimated travel option cost = ticket MVR + USD purchased × MVR/USD exchange rate + accommodation MVR + extras MVR.

Travel options are alternatives, not cumulative expenses. They are also not treated as spending that has already occurred.

The monthly amount needed is remaining savings divided by the number of calendar months from the current month through the departure month (inclusive). This is a planning estimate, not a guarantee that the target will be met.

## Cloud synchronization and security

The public.trips table stores one JSON trip per user/id, with user ownership enforced by Supabase RLS. The server increments a numeric revision on every insert/update. The current app checks that revision before changing or deleting an existing trip; a stale revision is rejected.

Unconfirmed edits can be reviewed before refreshing, and an emergency draft is attempted in account-scoped browser storage before each trip save. Browser storage is NOT encrypted or a substitute for a private JSON backup. Keep recovery and full backup files private. Old browser tabs running earlier whole-list writers should be closed/refreshed before editing the same trips as the new version.

Import restores only absent trip IDs after confirming the same account and a preview. Existing trip IDs are never overwritten by the import feature.

## Development and testing

This is a static JavaScript app with no build step. Node.js 22 or newer is recommended for the tests. In a shell from the project root, run:

    for file in *.js; do node --check "$file"; done
    node --test tests/*.test.cjs

On Windows PowerShell, run the checks using a PowerShell-compatible loop:

    Get-ChildItem -Filter *.js | ForEach-Object { node --check $_.FullName }
    node --test tests/*.test.cjs

Changes are developed and tested on the beta-testing branch. GitHub Actions runs syntax checks and automated regression tests for cloud saves, recovery, savings, checklists and backup validation. Desktop and iPhone UI testing remains an important manual release check.

Vercel hosts deployments and Supabase handles authenticated data. Use disposable test trips for destructive testing when beta and production share the database.

## Current limitations

- No automatic exchange-rate feed or direct banking integration.
- No fully supported offline synchronization.
- No automatic field-by-field merge of simultaneous trip changes.
- Recovery drafts on a device are not synchronized across devices.
- Full-backup restore inserts only missing trips, expenses and itinerary records;
  it does not replace existing records and may be partially completed if interrupted.
- A backup belongs to the account from which it was exported.

Full Voyafundra 2.0 test and release gates are in `docs/v2-release-checklist.md`.

More detail is in docs/data-protection-foundation.md and docs/trip-revisions.md.
