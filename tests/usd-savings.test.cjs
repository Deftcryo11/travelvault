"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"trip-v2-core.js"),"utf8");
const ctx=vm.createContext({window:{},Date,Number,Math});
vm.runInContext(source,ctx);
const core=ctx.window.voyafundraV2Core;
const copy=x=>JSON.parse(JSON.stringify(x));
const trip=()=>({
  id:"trip-1",budget:20000,departure:"2027-03-01",
  people:[
    {id:"a",name:"Me",monthlyTarget:3000},
    {id:"b",name:"Friend",monthlyTarget:2500}
  ],
  savings:[
    {id:"nov",month:"Nov 2026",contributions:{
      a:{planned:5000,saved:5000},b:{planned:3000,saved:3000}
    }}
  ],
  usdPurchases:[]
});
const input=(usd,rate,person="a")=>core.usdPurchaseInput({
  purchaseDate:"2026-11-13",personId:person,
  usdAmount:usd,mvrPerUsd:rate,note:"Bank exchange"
});

test("buying USD deducts exactly the historical MVR cost, not the saved total",()=>{
  const t=trip();
  t.usdPurchases=[{id:"usd-1",...input(200,15.4)}];
  const w=copy(core.ensureUsdSavingsCovered(t));
  assert.equal(w.contributedMvr,8000);
  assert.equal(w.mvrConverted,3080);
  assert.equal(w.mvrAvailable,4920);
  assert.equal(w.usdHeld,200);
  assert.equal(w.people[0].mvrAvailable,1920);
  assert.equal(w.people[0].usdHeld,200);
  assert.equal(core.saverForecast(t).totalSaved,8000,"currency conversion is not added saving");
});

test("different bank rates remain attached to each purchase",()=>{
  const t=trip();
  t.usdPurchases=[
    {id:"usd-1",...input(200,15.4)},
    {id:"usd-2",...input(50,15.7)},
  ];
  const w=copy(core.ensureUsdSavingsCovered(t));
  assert.equal(t.usdPurchases[0].mvrCost,3080);
  assert.equal(t.usdPurchases[1].mvrCost,785);
  assert.equal(w.mvrConverted,3865);
  assert.equal(w.usdHeld,250);
  assert.equal(w.mvrAvailable,4135);
  assert.equal(w.effectiveRate,15.46);
});

test("per-person wallets do not spend somebody else's MVR savings",()=>{
  const t=trip();
  t.usdPurchases=[{id:"usd-1",...input(150,15.5,"b")}];
  const w=copy(core.ensureUsdSavingsCovered(t));
  assert.equal(w.people[0].mvrAvailable,5000);
  assert.equal(w.people[0].usdHeld,0);
  assert.equal(w.people[1].mvrAvailable,675);
  assert.equal(w.people[1].usdHeld,150);
  t.usdPurchases.push({id:"usd-2",...input(100,15.5,"b")});
  assert.throws(()=>core.ensureUsdSavingsCovered(t),/more USD than/);
});

test("edit and delete recalculate balances without changing earlier rates",()=>{
  const t=trip();
  const old={id:"usd-1",...input(100,15.25)};
  t.usdPurchases=[old];
  const edited={id:"usd-1",...input(120,15.6)};
  const alternate={...t,usdPurchases:[edited]};
  assert.equal(core.ensureUsdSavingsCovered(alternate).mvrAvailable,6128);
  assert.equal(t.usdPurchases[0].mvrPerUsd,15.25,"editing must replace a row, not mutate original");
  assert.equal(core.ensureUsdSavingsCovered({...t,usdPurchases:[]}).usdHeld,0);
  assert.equal(core.ensureUsdSavingsCovered({...t,usdPurchases:[]}).mvrAvailable,8000);
});

test("negative, zero, bad dates, invalid savers, fractional cents and rates are rejected",()=>{
  assert.throws(()=>input(0,15.4),/positive USD/);
  assert.throws(()=>input(-10,15.4),/positive USD/);
  assert.throws(()=>input(10.001,15.4),/two decimal/);
  assert.throws(()=>input(50,0),/positive bank rate/);
  assert.throws(()=>core.usdPurchaseInput({
    purchaseDate:"2026-02-30",personId:"a",usdAmount:5,mvrPerUsd:15
  }),/valid USD purchase date/);
  assert.throws(()=>core.ensureUsdSavingsCovered({
    ...trip(),usdPurchases:[{id:"x",...input(10,15.2,"missing")}]
  }),/missing saver/);
});

test("reducing or deleting an already-exchanged monthly saving is blocked",()=>{
  const t=trip();
  t.usdPurchases=[{id:"usd-1",...input(200,15.4)}];
  const reduced=copy(t);
  reduced.savings[0].contributions.a.saved=2000;
  assert.throws(()=>core.ensureUsdSavingsCovered(reduced),/more USD than/);
  assert.throws(()=>core.ensureUsdSavingsCovered({...t,savings:[]}),/more USD than/);
});

test("legacy two-person trips can record per-saver USD purchases",()=>{
 const legacy={id:"old",budget:10000,personA:"A",personB:"B",
   savings:[{id:"j",month:"Jan 2026",savedA:4000,savedB:1000}]};
 legacy.usdPurchases=[{id:"bought",...input(100,15,"legacy-a")}];
 const w=copy(core.ensureUsdSavingsCovered(legacy));
 assert.equal(w.contributedMvr,5000);
 assert.equal(w.mvrAvailable,3500);
 assert.equal(w.people[0].mvrAvailable,2500);
 assert.equal(w.people[1].mvrAvailable,1000);
});

test("UI and savings edits use revision-protected trip persistence",()=>{
 const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
 const ui=fs.readFileSync(path.join(root,"trip-v2.js"),"utf8");
 assert.match(ui,/function usdWalletSection\(trip\)/);
 assert.match(ui,/function usdPurchaseForm\(trip,existing=null\)/);
 assert.match(ui,/mvrCost/);
 assert.match(ui,/usdPurchases=candidate/);
 assert.match(ui,/saveTrips\(trip.id\)/);
 assert.match(app,/ensureUsdSavingsCovered\(\{\s*\.\.\.trip, savings:newSavings/);
 assert.match(app,/ensureUsdSavingsCovered\(updated\)/);
 assert.match(app,/savings: trip.savings.filter\(\(row\) => row.id !== id\)/);
});
