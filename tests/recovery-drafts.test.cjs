"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { TextEncoder } = require("node:util");
const root = path.resolve(__dirname, "..");
const draftsCode = fs.readFileSync(path.join(root, "recovery-drafts.js"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "auth.js"), "utf8");

function storage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    data,
  };
}
function makeJournal(store = storage()) {
  const ctx = vm.createContext({
    window: {}, localStorage: store, TextEncoder,
    Date, Math,
  });
  vm.runInContext(draftsCode, ctx);
  return { draft: ctx.window.voyafundraDrafts, store };
}
const trip = (id, name) => ({ id, name, budget: 1500, savings: [],
  options: [] });

test("emergency journal saves private per-account snapshots and requires explicit cleanup", () => {
  const { draft, store } = makeJournal();
  const token = draft.record("user-1", "trip-a", "save", trip("trip-a", "Japan"), null);
  assert.ok(token);
  assert.equal(draft.list("user-1").length, 1);
  assert.equal(draft.list("user-2").length, 0);
  assert.equal(draft.list("user-1")[0].trip.name, "Japan");
  assert.equal(draft.covers("user-1", ["trip-a"]), true);
  assert.equal(draft.covers("user-2", ["trip-a"]), false);
  assert.equal(store.data.size, 1);
  assert.equal(draft.forget("user-1", "trip-a", token), true);
  assert.equal(draft.list("user-1").length, 0);
});

test("an earlier queued save cannot erase a newer journal revision", () => {
  const { draft } = makeJournal();
  const a = draft.record("user-1", "trip-a", "save", trip("trip-a", "Before"), "v1");
  const b = draft.record("user-1", "trip-a", "save", trip("trip-a", "After"), "v2");
  assert.notEqual(a, b);
  assert.equal(draft.forget("user-1", "trip-a", a), false);
  assert.equal(draft.list("user-1")[0].trip.name, "After");
  assert.equal(draft.list("user-1")[0].baseVersion, "v1");
  assert.equal(draft.forget("user-1", "trip-a", b), true);
});

test("failed storage writes cannot be described as saved recovery copies", () => {
  const store = storage();
  store.setItem = () => { throw Error("Storage denied"); };
  const { draft } = makeJournal(store);
  assert.throws(() =>
    draft.record("user-1", "trip-a", "save", trip("trip-a", "Test"), null),
    /Storage denied/);
  assert.equal(draft.covers("user-1", ["trip-a"]), false);
});

test("oversized recovery draft is rejected without erasing existing drafts", () => {
  const { draft } = makeJournal();
  draft.record("user-1", "trip-a", "save", trip("trip-a", "Original"), null);
  assert.throws(() => draft.record("user-1", "trip-a", "save",
    { id: "trip-a", name: "X".repeat(450000) }, null), /size limit/);
  assert.equal(draft.list("user-1")[0].trip.name, "Original");
});

test("damaged drafts are not silently deleted or overwritten", () => {
  const store = storage();
  const { draft } = makeJournal(store);
  store.setItem("voyafundra.recovery.v1.user-1.trip-a", "{broken");
  assert.throws(() => draft.list("user-1"), /damaged/);
  assert.equal(store.length, 1);
  assert.throws(() => draft.record("user-1", "trip-a", "save",
    trip("trip-a", "New"), null), /damaged/);
  assert.equal(store.length, 1);
});

test("restoration overlays local memory only on explicit user action", () => {
  const start = app.indexOf("function restoreSavedDraftsForReview()");
  const end = app.indexOf("\n/**\n * Clear all trip information", start);
  assert.ok(start >= 0 && end > start, "restore helper should exist");
  const { draft } = makeJournal();
  draft.record("user-1", "trip-a", "save", trip("trip-a", "Local recovery"), "old");
  const ctx = vm.createContext({
    window: { voyafundraDrafts: draft, voyafundraUX: { setStatus() {} } },
    render() {}, notify() {},
  });
  const init = [
    'let cloudReady=true, cloudUserId="user-1", cloudWritesPending=0;',
    'let cloudRecoveryReadError=null, cloudSaveError=null;',
    'let cloudRecoveryPendingDrafts=[{tripId:"trip-a"}];',
    'let cloudRestoredDrafts=new Map(), cloudRecoveryStorageFaults=new Set();',
    'let cloudUnsavedTripIds=new Set(), cloudTripSaveSequence=new Map();',
    'let cloudTripVersions=new Map([["trip-a","newer"]]);',
    'let trips=[{id:"trip-a",name:"Cloud version"}];'
  ].join("\n");
  vm.runInContext(init + "\n" + app.slice(start, end), ctx);
  assert.equal(vm.runInContext('trips[0].name', ctx), "Cloud version");
  assert.equal(vm.runInContext('restoreSavedDraftsForReview()', ctx), 1);
  assert.equal(vm.runInContext('trips[0].name', ctx), "Local recovery");
  assert.equal(vm.runInContext('cloudTripVersions.get("trip-a")', ctx), "old");
  assert.equal(vm.runInContext('cloudUnsavedTripIds.has("trip-a")', ctx), true);
  assert.equal(draft.list("user-1").length, 1);
});

test("manual logout blocks a failed cloud edit even when queue is settled", async () => {
  const start = auth.indexOf("async function logoutUser(isAutomatic = false)");
  const end = auth.indexOf('\nlogoutBtn.addEventListener(', start);
  assert.ok(start >= 0 && end > start);
  let signOutCount = 0, alerts = [];
  const ctx = vm.createContext({
    supabaseClient: { auth: { async signOut() { signOutCount++; return { error: null }; } } },
    document: { getElementById() {
      return { classList: { contains() { return true; } } };
    }},
    window: {
      alert(msg) { alerts.push(msg); },
      voyafundraUX: { showRecovery() {}, showDrafts() {}, setStatus() {} },
      voyafundraDrafts: { covers() { return true; } }
    },
    logoutBtn: { disabled: false }, console: { warn() {}, error() {}, log() {} },
    stopIdleTimer() {}, scheduleIdleCheck() {}, clearLastActivity() {},
    showAuthMessage() {}, waitForCloudSaves: async () => {},
    setTimeout() { return 1; }
  });
  const init = [
    'let logoutInProgress=false, activeUserId="user-1", idleTimer=null;',
    'let cloudSaveError=Error("Not saved");',
    'let cloudUnsavedTripIds=new Set(["trip-a"]);',
    'let cloudRecoveryPendingDrafts=[], cloudRecoveryReadError=null;',
    'let cloudRecoveryStorageFaults=new Set();'
  ].join("\n");
  vm.runInContext(init + "\n" + auth.slice(start, end), ctx);
  await vm.runInContext("logoutUser(false)", ctx);
  assert.equal(signOutCount, 0);
  assert.ok(alerts.some(msg => /not been confirmed/.test(msg)));
  await vm.runInContext("logoutUser(true)", ctx);
  assert.equal(signOutCount, 1, "verified recoverable drafts allow secure idle logout");
});

test("unprotected failed edits delay automatic logout", async () => {
  const begin = auth.indexOf("async function logoutUser(isAutomatic = false)");
  const end = auth.indexOf("\nlogoutBtn.addEventListener(", begin);
  let signOutCount = 0, retries = 0;
  const ctx=vm.createContext({
    supabaseClient:{auth:{async signOut(){signOutCount++;return{error:null};}}},
    window:{alert(){},voyafundraUX:{setStatus(){},showRecovery(){},showDrafts(){}},
      voyafundraDrafts:{covers(){return false;}}},
    document:{getElementById(){return{classList:{contains(){return true;}}};}},
    console:{warn(){},error(){},log(){}}, logoutBtn:{disabled:false},
    stopIdleTimer(){},waitForCloudSaves:async()=>{},clearLastActivity(){},
    scheduleIdleCheck(){},showAuthMessage(){},checkIdleTimeout(){},
    setTimeout(){retries++;return 42;}
  });
  vm.runInContext([
    'let logoutInProgress=false, activeUserId="user-1", idleTimer=null;',
    'let cloudSaveError=Error("Failed");let cloudUnsavedTripIds=new Set(["trip-a"]);',
    'let cloudRecoveryPendingDrafts=[],cloudRecoveryReadError=null;',
    'let cloudRecoveryStorageFaults=new Set();'
  ].join("\n")+"\n"+auth.slice(begin,end),ctx);
  await vm.runInContext("logoutUser(true)",ctx);
  assert.equal(signOutCount,0);
  assert.equal(retries,1);
});
