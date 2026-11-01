"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const calendar = read("trip-calendar.js");
const app = read("app.js");
const markup = read("index.html");
const css = read("trip-calendar.css");
const window = {};
vm.runInNewContext(calendar, {
  window,
  document: { addEventListener() {} },
  Date,
  Intl,
  String,
  Number,
});
const { parseDate, parseMonth, shiftMonth, daysInMonth, mondayIndex, dateLabel } =
  window.voyafundraCalendar.utils;

test("trip and savings month calendars are loaded before app.js", () => {
  assert.ok(markup.indexOf('src="trip-calendar.js"') < markup.indexOf('src="app.js"'));
  assert.match(markup, /href="trip-calendar\.css"/);
  assert.match(app, /voyafundraCalendar\?\.mount\(\$\("#activeForm"\)\)/);
});

test("X close, Cancel, and calendar cleanup are wired for all modals", () => {
  assert.match(markup, /type="button" class="close-btn" id="modalClose"/);
  assert.match(app, /\$\("#modalClose"\)\.onclick = closeModal;/);
  assert.match(app, /\$\("#cancelModal"\)\.onclick = closeModal;/);
  assert.match(app, /function closeModal\(\)\s*\{\s*window\.voyafundraCalendar\?\.closeAll\(\)/);
  assert.match(app, /#\s*modalLayer|modalPointerStartedOutside/);
});

test("date picker rejects invalid calendar days and supports leap years", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseDate("2028-02-29"))),
    { year: 2028, month: 1, day: 29 });
  assert.equal(parseDate("2027-02-29"), null);
  assert.equal(parseDate("2026-04-31"), null);
  assert.equal(parseDate("not-a-date"), null);
  assert.equal(daysInMonth(2028, 1), 29);
  assert.equal(daysInMonth(2027, 1), 28);
});

test("calendar moves across December/January boundaries", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(shiftMonth(2026, 11, 1))),
    { year: 2027, month: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(shiftMonth(2026, 0, -1))),
    { year: 2025, month: 11 });
  assert.equal(mondayIndex(2026, 10, 1), 6);
});

test("month picker preserves ISO values for FormData", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseMonth("2026-11"))),
    { year: 2026, month: 10 });
  assert.equal(parseMonth("2026-13"), null);
  assert.equal(dateLabel("2026-11", "month"), "November 2026");
  assert.equal(dateLabel("2026-11-01", "date"), "1 Nov 2026");
  assert.match(calendar, /input\.type = "hidden"/);
  assert.match(calendar, /input\.dispatchEvent\(new Event\("change"/);
});

test("calendar uses the app's existing theme variables and iPhone-safe styling", () => {
  for (const token of ["--surface", "--input-bg", "--text", "--border-strong", "--primary"]) {
    assert.ok(css.includes("var(" + token + ")"));
  }
  assert.match(css, /\.vf-calendar-panel\[hidden\]/);
  assert.match(css, /max-width: 700px/);
  assert.match(calendar, /panel\.closest\("\.modal"\)/);
  assert.match(calendar, /key === "Escape"/);
  assert.doesNotMatch(calendar, /fetch\(|supabaseClient|localStorage/);
});
