"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
const ui = fs.readFileSync(path.resolve(__dirname, "../experience.js"), "utf8");
const start = app.indexOf("async function refreshCloudTripsSafely(");
const end = app.indexOf("\n/**\n * Clear all trip information", start);
assert.ok(start > 0 && end > start, "Recovery functions must exist");
const codeUnderTest = app.slice(start, end);

function createSession(options = {}) {
  const remote = options.remote ?? [{
    id: "trip-a", trip_data: { id: "trip-a", name: "Newer cloud copy" },
    updated_at: "2026-11-01T10:00:00Z"
  }];
  const ctx = vm.createContext({
    window: { voyafundraUX: { setStatus() {} } },
    render() {},
    supabaseClient: {
      from(name) {
        assert.equal(name, "trips");
        const query = {
          select() { return query; },
          eq() { return query; },
          async order() {
            if (options.onRead) options.onRead(ctx);
            if (options.readError) return { data: null, error: Error("Cloud unavailable") };
            return { data: remote, error: null };
          }
        };
        return query;
      }
    }
  });
  vm.runInContext(`
    let trips = [{ id: "trip-a", name: "Unsaved local edit" }];
    let cloudTripVersions = new Map([["trip-a", "2026-10-31T20:00:00Z"]]);
    let cloudUnsavedTripIds = new Set(["trip-a"]);
    let cloudTripSaveSequence = new Map([["trip-a", 2]]);
    let cloudWriteQueue = Promise.reject(new Error("Previous conflict"));
    cloudWriteQueue.catch(() => {});
    let cloudSaveError = Error("Previous conflict");
    let cloudReady = true;
    let cloudUserId = "user-1";
    let cloudEpoch = 1;
    let cloudWritesPending = 0;
    let cloudWriteGeneration = 7;
    let selectedTripId = "trip-a";
    let currentView = "detail";
  ` + codeUnderTest, ctx);
  async function run(discardUnsaved = false) {
    ctx.discardUnsavedValue = discardUnsaved;
    return vm.runInContext(
      "refreshCloudTripsSafely('user-1', { discardUnsaved: discardUnsavedValue })",
      ctx
    );
  }
  return { ctx, run };
}

test("regular refresh blocks unconfirmed edits and preserves local trip", async () => {
  const { ctx, run } = createSession();
  await assert.rejects(run(), /resolve unsaved changes/);
  assert.equal(vm.runInContext("trips[0].name", ctx), "Unsaved local edit");
  assert.equal(vm.runInContext("cloudUnsavedTripIds.size", ctx), 1);
});

test("explicit discard refresh loads the cloud version and clears old error", async () => {
  const { ctx, run } = createSession();
  assert.equal(await run(true), true);
  assert.equal(vm.runInContext("trips[0].name", ctx), "Newer cloud copy");
  assert.equal(vm.runInContext("cloudUnsavedTripIds.size", ctx), 0);
  assert.equal(vm.runInContext("cloudSaveError === null", ctx), true);
  assert.equal(vm.runInContext("cloudTripSaveSequence.size", ctx), 0);
  await vm.runInContext("cloudWriteQueue", ctx);
});

test("failed cloud read must not discard unsaved edits or errors", async () => {
  const { ctx, run } = createSession({ readError: true });
  await assert.rejects(run(true), /Could not refresh trips/);
  assert.equal(vm.runInContext("trips[0].name", ctx), "Unsaved local edit");
  assert.equal(vm.runInContext("cloudUnsavedTripIds.size", ctx), 1);
  assert.equal(vm.runInContext("cloudSaveError !== null", ctx), true);
});

test("new write during refresh cancels the discard", async () => {
  const { ctx, run } = createSession({
    onRead(ctx) { vm.runInContext("cloudWriteGeneration += 1", ctx); }
  });
  await assert.rejects(run(true), /changed while refreshing/);
  assert.equal(vm.runInContext("trips[0].name", ctx), "Unsaved local edit");
});

test("recovery UI requires explicit confirmation and offers backup first", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  for (const id of ["reviewCloudIssueBtn", "cloudRecoveryPanel", "downloadRecoveryBackupBtn",
    "acknowledgeRecoveryDiscard", "discardRecoveryBtn"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(ui, /acknowledgeDiscard\.checked/);
  assert.match(ui, /window\.confirm\(/);
  assert.match(ui, /getCloudRecoverySnapshot/);
  assert.match(ui, /refreshCloudTripsSafely\(currentId, \{ discardUnsaved: true \}\)/);
});
