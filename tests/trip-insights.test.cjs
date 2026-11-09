"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(root, "trip-insights.js"), "utf8");
const features = fs.readFileSync(path.join(root, "trip-features.js"), "utf8");
const ctx = vm.createContext({ window: {}, Date, Number, Math });
vm.runInContext(code + "\n" + features, ctx);
const api = ctx.window.voyafundraInsights;
const ui = ctx.window.voyafundraFeatures;
const trip = {
  id: "a", name: "Japan", destination: "Tokyo", departure: "2027-01-15",
  budget: 34000, status: "Planning",
  people: [
    { id: "p1", name: "A", monthlyTarget: 3000 },
    { id: "p2", name: "B", monthlyTarget: 4000 }
  ],
  savings: [
    { id: "s1", month: "Nov 2026",
      contributions: { p1: {planned:3000,saved:2000}, p2:{planned:4000,saved:1000} } },
    { id: "s2", month: "Dec 2026",
      contributions: { p1: {planned:3000,saved:0}, p2:{planned:4000,saved:0} } },
  ],
  options: [
    { id:"o1",name:"Option A",ticket:8000,dollars:500,rate:15,stay:3000,other:1000 },
    { id:"o2",name:"Option B",ticket:10000,dollars:200,rate:15,stay:4000,other:600 },
  ],
};
test("calendar countdown is timezone-stable, includes today and past dates", () => {
  assert.equal(api.countdown("2027-01-15", "2027-01-14").days, 1);
  assert.equal(api.countdown("2027-01-15", "2027-01-15").phase, "today");
  assert.equal(api.countdown("2027-01-15", "2027-01-16").days, -1);
  assert.equal(api.countdown("2024-02-29", "2024-02-28").days, 1);
  assert.equal(api.countdown("2027-02-29", "2027-02-28").phase, "unset");
  assert.equal(api.countdown("", "2027-01-01").phase, "unset");
});

test("savings insights preserve existing contributions and define monthly goal", () => {
  const forecast = api.savingsForecast(trip, "2026-11-08");
  assert.equal(forecast.saved, 3000);
  assert.equal(forecast.remaining, 31000);
  assert.equal(forecast.monthlyTarget, 7000);
  assert.equal(forecast.remainingMonths, 3);
  assert.equal(forecast.monthlyNeeded, 10333.33);
  assert.equal(forecast.onTrack, false);
  assert.equal(forecast.history[0].planned, 7000);
  assert.equal(forecast.history[0].saved, 3000);
  assert.equal(forecast.savingsHistory, undefined);
  const complete = api.savingsForecast({ budget: 10, savings:[], people:[] },
    "2026-11-08");
  assert.equal(complete.monthlyNeeded, null);
});

test("travel costs use one alternative, with currency conversion counted once", () => {
  const cheapest = api.cheapestTravelOption(trip);
  assert.equal(cheapest.name, "Option B");
  assert.equal(cheapest.exchange, 3000);
  assert.equal(cheapest.total, 17600);
  assert.equal(cheapest.budgetLeft, 16400);
  assert.equal(cheapest.overBudget, false);
  assert.equal(api.cheapestTravelOption({ options:[] }), null);
});

test("legacy savers and saved values remain supported", () => {
  const old = { budget: 1000, personA: "W", personB: "H",
    savings:[{id:"1",month:"Jan 2027",savedA:200,savedB:50,planA:500,planB:500}] };
  const x = api.savingsForecast(old, "2026-11-08");
  assert.equal(x.saved, 250);
  assert.equal(x.history[0].planned, 1000);
});

test("checklist summary and starter tasks remain optional", () => {
  assert.equal(api.checklistSummary(trip).total, 0);
  assert.equal(api.STARTER_CHECKLIST.length >= 5, true);
  const sum = api.checklistSummary({
    checklist:[{done:true},{done:false},{done:true}]
  });
  assert.equal(sum.done, 2);
  assert.equal(sum.percent, 67);
});

test("rendered insights and checklist escape untrusted strings", () => {
  const unsafe = { ...trip, options:[{...trip.options[0],name:'<script>alert(1)</script>'}],
    checklist:[{id:"t1",title:"<img src=x onerror=alert(1)>",done:false,dueDate:""}] };
  const html=ui.renderInsights(unsafe)+ui.renderChecklist(unsafe);
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/&lt;img/);
  assert.match(html,/Budget &amp; savings insights/);
  assert.match(html,/aria-pressed="false"/);
  assert.match(ui.cardCountdown(trip),/until departure|Departure was/);
});

test("checklist starter, toggle, edit, delete actions use the per-trip save path", () => {
  const t={...trip,checklist:[]};
  const events=[];
  let submit;
  let counter=0;
  const app={
    generateId(){return "g-"+(++counter);},
    saveTrips(id){events.push("save:"+id);return Promise.resolve(true);},
    notify(msg){events.push("notice:"+msg);},
    render(){events.push("render");},
    field(name){return "<input name='"+name+"'>";},
    selectField(name){return "<select name='"+name+"'></select>";},
    showModal(title,body,handler){submit=handler;events.push("modal");},
    confirmRemove(prompt,fn){fn();events.push("confirmed");app.saveTrips(t.id);app.render();},
  };
  assert.equal(ui.handleChecklistAction("checklist-starter",t,null,app),true);
  assert.equal(t.checklist.length,api.STARTER_CHECKLIST.length);
  const id=t.checklist[0].id;
  ui.handleChecklistAction("checklist-toggle",t,id,app);
  assert.equal(t.checklist[0].done,true);
  ui.handleChecklistAction("checklist-edit",t,id,app);
  assert.equal(submit({taskTitle:"Ticket confirmed",taskDue:"2027-01-01",taskCategory:"Bookings",taskPriority:"High"}),true);
  assert.equal(t.checklist[0].title,"Ticket confirmed");
  assert.equal(t.checklist[0].dueDate,"2027-01-01");
  ui.handleChecklistAction("checklist-add",t,"",app);
  assert.equal(submit({taskTitle:"",taskDue:""}),false);
  assert.equal(submit({taskTitle:"Pack bags",taskDue:"",taskCategory:"Packing",taskPriority:"Normal"}),true);
  assert.equal(t.checklist.length,api.STARTER_CHECKLIST.length+1);
  ui.handleChecklistAction("checklist-delete",t,id,app);
  assert.equal(t.checklist.some(x=>x.id===id),false);
  assert.ok(events.some(x=>x==="save:a"));
});

test("international and weekend templates add tasks without duplicating existing ones",()=>{
 const t={id:"trip-a",checklist:[{id:"existing",title:"Check passport validity",done:true}]};
 const events=[];let submit;let id=0;
 const app={
   generateId(){return "new-"+(++id);},
   saveTrips(tripId){events.push("save:"+tripId);return Promise.resolve(true);},
   notify(text){events.push(text);},
   render(){events.push("render");},
   selectField(){return "<select name='taskTemplate'></select>";},
   showModal(_,__,handler){submit=handler;},
 };
 ui.handleChecklistAction("checklist-template",t,null,app);
 assert.equal(submit({taskTemplate:"International travel"}),true);
 assert.equal(t.checklist.filter(x=>x.title==="Check passport validity").length,1);
 assert.ok(t.checklist.some(x=>x.title.includes("visa")));
 assert.ok(t.checklist.some(x=>x.category==="Documents"));
 assert.ok(events.includes("save:trip-a"));
 const length=t.checklist.length;
 assert.equal(submit({taskTemplate:"International travel"}),false);
 assert.equal(t.checklist.length,length);
 ui.handleChecklistAction("checklist-template",t,null,app);
 assert.equal(submit({taskTemplate:"Weekend getaway"}),true);
 assert.ok(t.checklist.some(x=>x.title==="Pack essentials"));
});
