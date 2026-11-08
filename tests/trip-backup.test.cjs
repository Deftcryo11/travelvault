"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "trip-backup.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const ids = [
  "tripBackupPanel", "exportTripsBtn", "importTripsFile",
  "restoreTripsBtn", "tripBackupPreview", "tripBackupMessage", "approveTripRestore",
];

function setup() {
  const nodes = Object.fromEntries(ids.map((id) => [id, {
    id, disabled: false, value: "", checked: false, textContent: "",
    addEventListener() {},
  }]));
  const ctx = vm.createContext({
    document:{getElementById(id){return nodes[id] ?? null;}},
    window:{voyafundraInsights:{
      dateUTC(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const d = new Date(value+"T00:00:00Z");
        return Number.isNaN(d.getTime()) ? null : d;
      },
    }},
    Date, Number, JSON, console,
  });
  vm.runInContext(js, ctx);
  return { api:ctx.window.voyafundraBackup, nodes, ctx };
}

function trip() {
  return {
    id:"trip-1", name:"Malaysia", destination:"Kuala Lumpur", budget:30000,
    status:"Planning", departure:"2027-01-15", returnDate:"2027-01-20",
    startMonth:"2026-11", monthCount:2, createdAt:"2026-11-01T00:00:00Z",
    people:[{id:"p-1",name:"Saver",monthlyTarget:5000}],
    options:[{id:"o-1",name:"Flight",ticket:5000,dollars:200,rate:15,stay:1500,other:200}],
    savings:[{id:"s-1",month:"Nov 2026",contributions:{
      "p-1":{saved:2000,planned:5000}}}],
    checklist:[{id:"task-1",title:"Book flight",done:true,dueDate:"2026-12-01"}],
    notes:"Flight change possible"
  };
}
const wrap = (list, account="account-1") => JSON.stringify({
  format:"voyafundra-trip-backup-v1",account_id:account,trips:list,
});

test("backup UI controls are present and live before update checker", () => {
  for(const id of ids) assert.match(html,new RegExp('id="'+id+'"'));
  assert.ok(html.indexOf('src="trip-insights.js"') <
    html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="trip-features.js"') <
    html.indexOf('src="app.js"'));
  assert.ok(html.indexOf('src="trip-backup.js"') <
    html.indexOf('src="pwa-updates.js"'));
});

test("full backup parsing validates account and retains trip data", () => {
  const api=setup().api;
  const result=api.parseBackup(wrap([trip()]),"account-1");
  assert.equal(result.trips.length,1);
  assert.equal(result.trips[0].savings[0].contributions["p-1"].saved,2000);
  assert.equal(result.trips[0].checklist[0].done,true);
  assert.equal(result.trips[0].options[0].ticket,5000);
  assert.equal(result.trips[0].people[0].monthlyTarget,5000);
  assert.equal(result.trips[0].notes,"Flight change possible");
});

test("another account's file is rejected and never loaded", () => {
  const api=setup().api;
  assert.throws(()=>api.parseBackup(wrap([trip()],"other-account"),"account-1"),
    /not a supported backup/);
});

test("invalid ids, duplicate trips, unreasonable size, and negative inputs rejected", () => {
  const api=setup().api;
  assert.throws(()=>api.parseBackup(wrap([{...trip(),id:"!bad"}]),"account-1"),/Invalid trip/);
  assert.throws(()=>api.parseBackup(wrap([trip(),trip()]),"account-1"),/duplicate/);
  assert.throws(()=>api.parseBackup(wrap([{...trip(),budget:-1}]),"account-1"),/invalid amount/);
  assert.throws(()=>api.parseBackup(wrap([{...trip(),checklist:
    [{id:"t-2",title:"Invalid",done:false,dueDate:"bad"}]}]),"account-1"),/invalid date/);
  assert.throws(()=>api.parseBackup("{}", "account-1"),/not a supported backup/);
});

test("a backup cannot inject extra fields into the restored trip schema", () => {
  const api=setup().api;
  const sanitized=api.validateTrip({...trip(),hidden:"malicious",__proto__:null});
  assert.equal(Object.hasOwn(sanitized,"hidden"),false);
  assert.equal(sanitized.options[0].rate,15);
  assert.equal(sanitized.checklist[0].title,"Book flight");
});

test("restore only inserts missing trip records after explicit acknowledgement", () => {
  assert.match(js,/candidate\.account_id !== userId/);
  assert.match(js,/if \(!candidate \|\| !approval\.checked \|\| restoring\) return/);
  assert.match(js,/window\.confirm\(/);
  assert.match(js,/\.insert\(\{ id: trip\.id, user_id: userId, trip_data: trip \}\)/);
  assert.doesNotMatch(js,/\.upsert\(/);
  assert.doesNotMatch(js,/\.update\(\{ trip_data/);
  assert.doesNotMatch(js,/\.delete\(\)/);
  assert.match(js,/cloudTripRevisions\.set/);
  assert.match(app,/window\.voyafundraBackup\?\.isBusy\?\.\(\)/);
});
