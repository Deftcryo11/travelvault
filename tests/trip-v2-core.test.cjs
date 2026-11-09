"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const code=fs.readFileSync(path.join(root,"trip-v2-core.js"),"utf8");
const ctx=vm.createContext({window:{},Date,Number,Math});
vm.runInContext(code,ctx);
const c=ctx.window.voyafundraV2Core;
const plain=x=>JSON.parse(JSON.stringify(x));

test("expense calculator records actual MVR and exchange-rate snapshot",()=>{
 const x=c.expenseInput({expense_date:"2026-11-09",description:"Hotel",
  category:"Accommodation",original_amount:"100.20",currency:"USD",
  exchange_rate:"15.42",entry_type:"expense",payment_status:"paid",
  notes:"",booking_id:"booking-1"});
 assert.equal(x.amount_mvr,1545.08);
 assert.equal(x.exchange_rate,15.42);
 assert.equal(x.booking_id,"booking-1");
 assert.equal(c.expenseInput({...x,currency:"MVR",exchange_rate:99}).exchange_rate,1);
});

test("refunds affect net spending only when completed; planned costs are separate",()=>{
 const rows=[
  {category:"Flights",amount_mvr:4500,entry_type:"expense",payment_status:"paid"},
  {category:"Food",amount_mvr:1500,entry_type:"expense",payment_status:"planned"},
  {category:"Flights",amount_mvr:500,entry_type:"refund",payment_status:"paid"}
 ];
 const sum=c.expenseSummary(rows,10000);
 assert.equal(sum.spent,4000);
 assert.equal(sum.planned,1500);
 assert.equal(sum.refunds,500);
 assert.equal(sum.remaining,6000);
 assert.equal(sum.categories.find(x=>x.category==="Flights").actual,4000);
});

test("zero expense, invalid date, rate, currency and future-dated refunds are rejected",()=>{
 const valid={expense_date:"2026-11-09",description:"Test",category:"Food",
  original_amount:0,currency:"MVR",entry_type:"expense",payment_status:"paid"};
 assert.equal(c.expenseInput(valid).amount_mvr,0);
 assert.throws(()=>c.expenseInput({...valid,expense_date:"2026-02-30"}),/date/);
 assert.throws(()=>c.expenseInput({...valid,currency:"EUR"}),/currency/);
 assert.throws(()=>c.expenseInput({...valid,currency:"USD",exchange_rate:0}),/rate/);
 assert.throws(()=>c.expenseInput({...valid,original_amount:-1}),/non-negative/);
 assert.throws(()=>c.expenseInput({...valid,entry_type:"refund",payment_status:"planned"}),/Refunds/);
 assert.throws(()=>c.expenseInput({...valid,original_amount:""}),/valid amount/);
});

test("plan events validate local date/times and prevent backwards durations",()=>{
 const valid={kind:"hotel",title:"Check in",start_date:"2027-01-12",
  start_time:"14:00",end_date:"2027-01-14",end_time:"10:00",
  time_zone:"Asia/Colombo",booking_status:"confirmed",committed_mvr:1500};
 assert.equal(c.itineraryInput(valid).start_time,"14:00");
 assert.throws(()=>c.itineraryInput({...valid,end_date:"2027-01-10"}),/End date/);
 assert.throws(()=>c.itineraryInput({...valid,start_time:"25:00"}),/24-hour/);
 assert.throws(()=>c.itineraryInput({...valid,title:""}),/title/);
 assert.throws(()=>c.itineraryInput({...valid,kind:"bad"}),/type/);
});

test("itinerary sorting groups by day and local time without changing records",()=>{
 const rows=[{start_date:"2027-01-10",start_time:"14:00",title:"B"},
  {start_date:"2027-01-09",start_time:null,title:"A"},
  {start_date:"2027-01-10",start_time:"07:00",title:"C"}];
 const groups=plain(c.groupItinerary(rows));
 assert.equal(groups.length,2);
 assert.equal(groups[0].date,"2027-01-09");
 assert.equal(groups[1].items[0].title,"C");
 assert.equal(rows[0].title,"B");
});

test("saver forecasts retain historical contributions and count local months",()=>{
 const trip={budget:10000,departure:"2027-01-12",
  people:[{id:"p",name:"A",monthlyTarget:2500}],
  savings:[{month:"Nov 2026",contributions:{p:{saved:1500,planned:2500}}}]};
 const f=c.saverForecast(trip,"2026-11-09");
 assert.equal(f.remaining,8500);
 assert.equal(f.months,3);
 assert.equal(f.requiredMonthly,2833.33);
 assert.equal(f.people[0].saved,1500);
 assert.equal(f.people[0].projectedAdditional,7500);
});

test("categories, overdue tasks and CSV formula injection are handled safely",()=>{
 const trip={budget:2000,budgetCategories:{Flights:800,Food:500},
  checklist:[{id:"1",title:"Visa",done:false,dueDate:"2026-11-01"},
    {id:"2",title:"Pack",done:true,dueDate:"2026-11-10"}]};
 const rows=[{category:"Flights",amount_mvr:300,payment_status:"paid",entry_type:"expense"}];
 const cats=plain(c.categoryBudgets(trip,rows));
 assert.equal(cats[0].variance,500);
 assert.equal(c.checklistUpcoming(trip,"2026-11-09")[0].overdue,true);
 assert.ok(c.csvSafe('=HYPERLINK("x")').startsWith('"\'='));
 assert.equal(c.dateValid("2027-02-29"),false);
 assert.equal(c.dateValid("2028-02-29"),true);
});

test("version 2 integration loads before auth and prevents unsafe refresh or logout",()=>{
 const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
 const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
 const auth=fs.readFileSync(path.join(root,"auth.js"),"utf8");
 const pwa=fs.readFileSync(path.join(root,"pwa-updates.js"),"utf8");
 for(const asset of ["trip-v2.js","trip-v2-core.js","trip-v2-drafts.js","trip-v2.css"])
   assert.ok(html.includes(asset),asset);
 assert.ok(html.indexOf('src="trip-v2-core.js"')<
   html.indexOf('src="trip-v2.js"'));
 assert.ok(html.indexOf('src="trip-v2.js"')<
   html.indexOf('src="auth.js"'));
 assert.match(app,/voyafundraV2\?\.enhanceTrip/);
 assert.match(app,/voyafundraV2\?\.load/);
 assert.match(auth,/v2Status\?\.unconfirmed/);
 assert.match(pwa,/voyafundraV2\?\.status/);
});
