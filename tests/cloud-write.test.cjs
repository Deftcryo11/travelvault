"use strict";

// Behavioral tests for the app's guarded per-trip storage function.
// Run it with a tiny in-memory PostgREST-style adapter; no Supabase test
// credentials or production data are required.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
const start = source.indexOf("function saveTrips(tripId, options = {}) {");
const end = source.indexOf("\n/**\n * Wait for pending cloud saves.", start);
assert.ok(start >= 0 && end > start, "Save function must be present");

function fakeDatabase(initial) {
  const records = new Map(initial.map((row) => [row.id, { ...row }]));
  const calls = [];
  return {
    records, calls,
    from(table) {
      assert.equal(table, "trips");
      let operation, payload;
      const filters = {};
      const query = {
        insert(row) { operation = "insert"; payload = row; return query; },
        update(row) { operation = "update"; payload = row; return query; },
        delete() { operation = "delete"; return query; },
        eq(field, value) { filters[field] = value; return query; },
        async select() {
          calls.push({ operation, filters: { ...filters } });
          if (operation === "insert") {
            if (records.has(payload.id)) return { data: null, error: Error("duplicate") };
            const item = { ...payload, updated_at: "2026-11-01T00:00:00.000Z" };
            records.set(item.id, item);
            return { data: [{ updated_at: item.updated_at }], error: null };
          }
          const row = records.get(filters.id);
          const matched = row && Object.entries(filters)
            .every(([key, value]) => row[key] === value);
          if (!matched) return { data: [], error: null };
          if (operation === "update") {
            const next = { ...row, ...payload };
            records.set(row.id, next);
            return { data: [{ updated_at: next.updated_at }], error: null };
          }
          if (operation === "delete") {
            records.delete(row.id);
            return { data: [{ id: row.id }], error: null };
          }
          throw Error("Unexpected database operation");
        },
      };
      return query;
    },
  };
}

function setup({ rows = [], trips = [] } = {}) {
  const db = fakeDatabase(rows);
  const alerts = [];
  const context = vm.createContext({
    db, trips, alerts, supabaseClient: db,
    notify(message) { alerts.push(message); },
    window: { voyafundraUX: { setStatus() {} } },
    console: { log() {}, error() {} },
  });
  const setupCode = `
    let cloudReady = true;
    let cloudUserId = "test-user";
    let cloudEpoch = 1;
    let cloudTripVersions = new Map(Array.from(db.records.entries(), ([id, row]) => [id, row.updated_at]));
    let cloudWriteQueue = Promise.resolve();
    let cloudWritesPending = 0;
    let cloudSaveError = null;
    let cloudUnsavedTripIds = new Set();
    let cloudTripSaveSequence = new Map();
  `;
  vm.runInContext(setupCode + source.slice(start, end), context);
  return { db, alerts, context,
    save(id, options) {
      context.targetId = id;
      context.targetOptions = options || {};
      return vm.runInContext("saveTrips(targetId, targetOptions)", context);
    },
  };
}

const baseTime = "2026-10-01T00:00:00.000Z";
function row(id, name, updated_at = baseTime) {
  return { id, user_id: "test-user", updated_at, trip_data: { id, name } };
}

test("updating one trip does not overwrite or delete another trip", async () => {
  const env = setup({
    rows: [row("a", "original"), row("b", "untouched")],
    trips: [{ id: "a", name: "edited" }, { id: "b", name: "old local" }],
  });
  assert.equal(await env.save("a"), true);
  assert.equal(env.db.records.get("a").trip_data.name, "edited");
  assert.equal(env.db.records.get("b").trip_data.name, "untouched");
  assert.deepEqual(env.db.calls.map((c) => c.operation), ["update"]);
  assert.equal(env.db.calls[0].filters.updated_at, baseTime);
});

test("stale edit is rejected instead of overwriting newer cloud data", async () => {
  const env = setup({ rows: [row("a", "PC edit", "2026-11-01T10:00:00.000Z")],
    trips: [{ id: "a", name: "phone edit" }] });
  vm.runInContext(`cloudTripVersions.set("a", "${baseTime}")`, env.context);
  await assert.rejects(env.save("a"), /changed on another device/);
  assert.equal(env.db.records.get("a").trip_data.name, "PC edit");
  assert.equal(env.context.alerts.length, 1);
});

test("new trip uses insert and cannot overwrite an existing record", async () => {
  const env = setup({ rows: [row("a", "other")],
    trips: [{ id: "a", name: "other" }, { id: "new", name: "first trip" }] });
  assert.equal(await env.save("new"), true);
  assert.equal(env.db.records.get("a").trip_data.name, "other");
  assert.equal(env.db.records.get("new").trip_data.name, "first trip");
  assert.deepEqual(env.db.calls.map((c) => c.operation), ["insert"]);
});

test("explicit delete targets one row with the version condition", async () => {
  const env = setup({ rows: [row("a", "delete me"), row("b", "keep me")],
    trips: [ { id: "a", name: "delete me" }, { id: "b", name: "keep me" } ] });
  assert.equal(await env.save("a", { deleteTrip: true }), true);
  assert.equal(env.db.records.has("a"), false);
  assert.equal(env.db.records.has("b"), true);
  assert.deepEqual(env.db.calls.map((c) => c.operation), ["delete"]);
  assert.equal(env.db.calls[0].filters.id, "a");
  assert.equal(env.db.calls[0].filters.updated_at, baseTime);
});

test("stale delete is rejected and retains the cloud trip", async () => {
  const env = setup({ rows: [row("a", "newer", "2026-11-01T10:00:00.000Z")],
    trips: [{ id: "a", name: "older" }] });
  vm.runInContext(`cloudTripVersions.set("a", "${baseTime}")`, env.context);
  await assert.rejects(env.save("a", { deleteTrip: true }), /changed on another device/);
  assert.equal(env.db.records.get("a").trip_data.name, "newer");
});

test("no trip ID means no database write", () => {
  const env = setup({ rows: [row("a", "unchanged")], trips: [] });
  assert.equal(env.save(), false);
  assert.equal(env.db.calls.length, 0);
});

test("no whole-collection upsert or inferred deletion remains", () => {
  const saveCode = source.slice(start, end);
  assert.doesNotMatch(saveCode, /\.upsert\(/);
  assert.doesNotMatch(saveCode, /deletedIds|\.in\("id"/);
  assert.match(saveCode, /\.eq\("updated_at", previous\)/);
  assert.match(source, /if \(options\.deleteTrip\)/);
  assert.match(source, /pending\.then\(\(confirmed\)/);
});
