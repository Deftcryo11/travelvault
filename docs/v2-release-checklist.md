# Voyafundra 2.0 — Beta rollout and release verification

## Scope
This beta adds the approved Voyafundra 2.0 feature expansion while retaining
the existing account, trips, savings records, themes, and iPhone PWA layout.

- Trip workspace tabs: Overview, Budget & Expenses, Savings,
  Itinerary & Bookings, Checklist.
- Distinct actual spending vs planned spending vs recorded savings.
- USD/MVR expense rate snapshots, completed refunds, linked booking IDs,
  category budgets, per-person savings projections, CSV and printable reports.
- Itinerary / bookings by day with destination-local times and optional zone,
  provider, confirmation reference, confirmed/pending/cancelled status.
- Checklist categories, priorities, due-date sorting, overdue markers and
  reusable General, International and Weekend templates.
- Settings & Data view, keeping the two-item iPhone bottom navigation.
- Version 2 full-account backup containing all three data collections. The
  import accepts legacy v1 and v2 and **inserts missing records only**.

## Database

Existing Supabase project; no separate test project. Applied migration
\`20261109041100_add_voyafundra_v2_expenses_and_plan_items\` is additive.

Tables:

- \`public.trips\` (existing, RLS, server revision, JSON trip settings).
- \`public.trip_expenses\` (new, owner/parent composite FK, RLS, server revision).
- \`public.trip_plan_items\` (new, owner/parent composite FK, RLS, server revision).

No existing trip rows were intentionally rewritten. The new tables use
\`ON DELETE CASCADE\` from their parent trip; permanently deleting a trip
permanently deletes its expense and itinerary records as well.

The new tables support individually revision-guarded INSERT/UPDATE/DELETE.
If another device edits a record first, the stale operation matches zero rows.
No shared-account collaboration, fully offline sync, or automatic merge is
implemented. Keep booking references and exported backups private.

## Required test conditions

Use a **disposable trip** in the existing authenticated account. Do not delete,
restore, or overwrite trips whose history you want to preserve. Both devices
should start from an updated beta preview version.

### Stage A — Baseline, login, and existing trip compatibility

- Log in on desktop and iPhone PWA. Existing trips and savings values should
  match. Dark mode, calendars and open/close form actions must still work.
- Change and save a disposable trip's budget and a savings entry, refresh and
  confirm both persist. Confirm cloud status shows fully saved.
- Inspect a legacy two-saver trip: historical contributions must remain visible.
- Verify My Trips, Completed Trips, trip details, Settings & Data and back.

### Stage B — Actual expenses and financial rules

- Enter a paid MVR expense, a planned expense, a USD expense with your bank
  rate, and a paid refund. Check that paid minus refunds equals net spending,
  planned isn't counted in net spending, and savings remain unchanged.
- Edit and delete disposable expenses; confirm totals and refresh.
- Set categories; compare actual vs category budgets and overall budget.
- Verify empty/invalid dates, negative amounts, zero rates, refunds in planned
  status, and overlarge amounts are rejected.
- Export CSV and verify the downloaded data includes currency and rate.

### Stage C — Itinerary and booking linkage

- Add an activity, flight and hotel with local start time, date, provider,
  booking status and a reference. Verify day sorting.
- Link one paid expense to a booking. Confirm the booking cost and expense
  payment are NOT added together as actual spending.
- Edit an item, cancel a booking and check upcoming count changes.
- Delete an itinerary item and confirm linked expenses remain as financial
  records. Check no sensitive card details were entered.
- Confirm end dates before start dates are rejected.

### Stage D — Savings, checklists and deadline UX

- Verify each saver's recorded amount and monthly target against known values.
- Test missing departure dates, departure today, past trips, and overdue tasks.
- Add an International checklist template, then add it again: no duplicates.
- Add Weekend template; edit category, priority, due date, mark complete, and
  verify order/overdue highlighting after refresh.
- Confirm the existing standalone savings editor remains available.

### Stage D2 — USD savings conversion ledger

- Use a disposable trip with MVR 8,000 already recorded as savings.
  Purchase USD 200 at MVR 15.40/USD. Expected: MVR 3,080 exchanged,
  MVR 4,920 still available, USD 200 held, goal progress unchanged.
- Purchase another USD 50 at MVR 15.70. Expected: MVR 3,865 total
  exchanged, MVR 4,135 available, USD 250 held; the first rate remains
  15.40 and the weighted historical rate is 15.46.
- Verify purchases are assigned to the correct saver and cannot exceed that
  saver's recorded MVR contributions (even if another saver has funds).
- Edit and delete one purchase. Check USD holdings and MVR balances
  recalculate without changing the other purchase's rate.
- Reduce or delete a monthly MVR savings entry used to buy USD. The app
  must block an overdraft and explain which saver needs more savings.
- Remove a saver with USD purchases. The editor must block this until
  their conversion transactions are removed or reassigned.
- Check the trip list, trip overview, Savings tab, JSON trip report and
  printable report all distinguish MVR available, USD held and total
  recorded savings. USD conversion must not count as trip spending.
- Export and preview a Version 2 full backup. Verify every purchase's
  amount, date, saver, rate and MVR cost are preserved and tampered rates
  or unsupported duplicate IDs are rejected.
- Repeat on PC and iPhone, including a stale cross-device purchase edit;
  the trip revision guard must prevent replacing a newer cloud copy.

Implementation: USD purchases are in each trip's `trip_data.usdPurchases`
JSON array. This uses the existing trip-level server revision and does not
require a new Supabase table or schema migration. Rates are entered manually
for each conversion and never retroactively updated. No new money is created
or spent: saved value at historical cost is simply divided between MVR cash
and purchased USD.

### Stage E — Full backups, recovery and security

- Download a **private v2 JSON full backup** and confirm it has \`trips\`,
  \`expenses\`, and \`plan_items\` arrays.
- Preview a v1 backup (legacy) and a v2 backup. Existing records must always
  be skipped, never overwritten. Prefer a disposable missing trip for a real
  restore test. Confirm all restored child records are visible after reload.
- Make an offline or interrupted new expense edit. Check the on-device draft
  warning; logout and update prompts must not silently lose the draft.
- Compare the local draft with the cloud, explicitly choose the desired
  version, and verify that stale revisions cannot overwrite another device.
- Use another account on the same browser (if available): it must not see
  the first account's records. RLS was independently tested with a rolled-back
  authenticated SQL transaction; rerun after future schema changes.
- Close modals during a save: actions must remain blocked until completion.
- Check backup import invalid IDs, corrupted JSON, oversized files,
  cross-account files, and duplicate records are rejected.

### Stage F — Desktop/iPhone release audit

- Test narrow iPhone screens, device light/dark modes, Home Screen PWA resume,
  navigation and safe-area alignment.
- Check responsive forms, date calendars, native time inputs, large tables,
  tab keyboard navigation, screen-reader labels, disabled/loading states,
  and budget/savings currency formatting.
- Test reloading when the PWA update banner appears; an in-flight or
  unconfirmed save must prevent an unsafe reload.
- Run GitHub Actions Node regression suite with zero failures.
- Run Supabase security and performance advisors; review known Auth leaked-
  password-protection warning if supported by the project plan.
- Verify the live beta commit/alias and audit the PR diff for unintentional
  changes. Merge to \`main\` only after the above manual gates pass.

## Rollback and limitations

- \`main\` remains unchanged until release approval and all checks pass.
- Reverting the frontend should not automatically drop the additive new
  tables; doing so would destroy data entered after release.
- Backups are account-specific, locally downloaded and not encrypted. V2
  restore is create-only and is **not a transaction across all rows**:
  if a connection fails, a partial restore is reported; retrying inserts
  only records that remain missing.
- Browser recovery drafts can be lost if local storage is cleared. They are
  not a remote offline-first synchronization service.
- Live exchange rates, uploads, push reminders, automatic field-level merges
  and multi-account trip collaboration remain out of scope for this release.
