"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const js = fs.readFileSync(path.join(root, "trip-backup.js"), "utf8");
const core = fs.readFileSync(path.join(root, "trip-v2-core.js"), "utf8");
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
  vm.runInContext(core + "\n" + js, ctx);
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
  assert.match(js,/candidate\.account_id!==userId/);
  assert.match(js,/if \(!candidate \|\| !approval\.checked \|\| restoring\) return/);
  assert.match(js,/window\.confirm\(/);
  assert.match(js,/\.from\("trips"\)\.insert\(\{/);
  assert.match(js,/\.from\(table\)\.insert\(\{/);
  assert.doesNotMatch(js,/\.upsert\(/);
  assert.doesNotMatch(js,/\.update\(\{ trip_data/);
  assert.doesNotMatch(js,/\.delete\(\)/);
  assert.match(js,/cloudTripRevisions\.set/);
  assert.match(app,/window\.voyafundraBackup\?\.isBusy\?\.\(\)/);
});


test("v2 full backup preserves expense, booking and enhanced checklist records",()=>{
  const api=setup().api;
  const newer={...trip(),budgetCategories:{Flights:10000,Food:2000},
    checklist:[{id:"task-1",title:"Passport",done:false,dueDate:"2026-12-01",
      category:"Documents",priority:"High"}]};
  const expense={id:"expense-1",trip_id:"trip-1",expense_date:"2026-11-09",
    category:"Flights",description:"Airfare",original_amount:200,
    currency:"USD",exchange_rate:15,amount_mvr:3000,entry_type:"expense",
    payment_status:"paid",booking_id:"plan-1",notes:""};
  const plan={id:"plan-1",trip_id:"trip-1",kind:"flight",title:"Morning flight",
    start_date:"2027-01-15",start_time:"09:00",end_date:null,end_time:null,
    time_zone:"Asia/Colombo",location:"CMB",provider:"Airline",
    booking_reference:"REF-1",booking_status:"confirmed",committed_mvr:3000,notes:""};
  const payload=JSON.stringify({format:"voyafundra-trip-backup-v2",
    account_id:"account-1",trips:[newer],expenses:[expense],plan_items:[plan]});
  const parsed=api.parseBackup(payload,"account-1");
  assert.equal(parsed.expenses.length,1);
  assert.equal(parsed.expenses[0].amount_mvr,3000);
  assert.equal(parsed.plan_items[0].booking_reference,"REF-1");
  assert.equal(parsed.trips[0].checklist[0].priority,"High");
  assert.equal(parsed.trips[0].checklist[0].category,"Documents");
  assert.equal(parsed.trips[0].budgetCategories.Flights,10000);
});

test("v2 import rejects malformed expenses and duplicate itinerary records",()=>{
  const api=setup().api;
  const row={id:"a",trip_id:"trip-1",expense_date:"2026-11-09",
    category:"Food",description:"Lunch",original_amount:100,
    amount_mvr:999,currency:"MVR",entry_type:"expense",payment_status:"paid"};
  const wrap2=(expenses,plan_items)=>JSON.stringify({
    format:"voyafundra-trip-backup-v2",account_id:"account-1",
    trips:[trip()],expenses,plan_items});
  assert.throws(()=>api.parseBackup(wrap2([row],[]),"account-1"),/inconsistent/);
  const plan={id:"p",trip_id:"trip-1",kind:"hotel",title:"Stay",
    start_date:"2027-01-15",booking_status:"confirmed",committed_mvr:500};
  assert.throws(()=>api.parseBackup(wrap2([], [plan,plan]),"account-1"),/duplicate/);
  assert.throws(()=>api.parseBackup(wrap2([],[]),"other-account"),/not a supported/);
});

test("backward-compatible version 1 imports keep empty activity collections",()=>{
  const parsed=setup().api.parseBackup(wrap([trip()]),"account-1");
  assert.equal(parsed.format,"voyafundra-trip-backup-v1");
  assert.equal(parsed.expenses.length,0);
  assert.equal(parsed.plan_items.length,0);
});

test("complete backup export reads all three tables and imports never overwrite",()=>{
  assert.match(js,/from\("trip_expenses"\)/);
  assert.match(js,/from\("trip_plan_items"\)/);
  assert.match(js,/format:FORMAT/);
  assert.match(js,/known\.has\(key\)/);
  assert.match(js,/tripIds\.has\(record\.trip_id\)/);
  assert.doesNotMatch(js,/\.upsert\(/);
  assert.doesNotMatch(js,/\.delete\(\)/);
});


test("V2 backups retain USD savings purchases with their original bank rates",()=>{
  const api=setup().api;
  const t=trip();
  t.usdPurchases=[{
    id:"usd-1",personId:"p-1",purchaseDate:"2026-11-13",
    usdAmount:100,mvrPerUsd:15.42,mvrCost:1542,note:"Bank promotion"
  }];
  const json=JSON.stringify({
    format:"voyafundra-trip-backup-v2",account_id:"account-1",
    trips:[t],expenses:[],plan_items:[]
  });
  const parsed=api.parseBackup(json,"account-1");
  assert.equal(parsed.trips[0].usdPurchases.length,1);
  assert.equal(parsed.trips[0].usdPurchases[0].usdAmount,100);
  assert.equal(parsed.trips[0].usdPurchases[0].mvrPerUsd,15.42);
  assert.equal(parsed.trips[0].usdPurchases[0].mvrCost,1542);
  assert.equal(parsed.trips[0].savings[0].contributions["p-1"].saved,2000);
  assert.equal(parsed.trips[0].usdPurchases[0].note,"Bank promotion");
});

test("V2 backups reject tampered rates, overdrafts, and repeated USD purchase IDs",()=>{
  const api=setup().api;
  const row={id:"usd-1",personId:"p-1",purchaseDate:"2026-11-13",
    usdAmount:100,mvrPerUsd:15.42,mvrCost:1542,note:""};
  const format=t=>JSON.stringify({
    format:"voyafundra-trip-backup-v2",account_id:"account-1",
    trips:[t],expenses:[],plan_items:[]
  });
  assert.throws(()=>api.parseBackup(format({
    ...trip(),usdPurchases:[{...row,mvrCost:1400}]
  }),"account-1"),/does not match/);
  assert.throws(()=>api.parseBackup(format({
    ...trip(),usdPurchases:[{...row,usdAmount:200,mvrCost:3084}]
  }),"account-1"),/more USD than/);
  assert.throws(()=>api.parseBackup(format({
    ...trip(),usdPurchases:[row,row]
  }),"account-1"),/duplicate USD/);
});

test("legacy backups without USD purchases remain supported",()=>{
  const data=setup().api.parseBackup(wrap([trip()]),"account-1");
  assert.equal(data.trips[0].usdPurchases.length,0);
});
