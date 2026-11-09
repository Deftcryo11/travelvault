"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"trip-v2.js"),"utf8");
const pure=fs.readFileSync(path.join(root,"trip-v2-core.js"),"utf8");

function harness({errorTable=null}={}) {
  const handlers={};
  const queries=[];
  const element={addEventListener(type,cb){handlers[type]=cb;}};
  const account="account-1";
  const expenses=[
    {id:"a",user_id:account,trip_id:"trip-1",category:"Food",
      amount_mvr:"500",payment_status:"paid",entry_type:"expense"},
    {id:"b",user_id:account,trip_id:"trip-1",category:"Food",
      amount_mvr:"100",payment_status:"paid",entry_type:"refund"},
    {id:"c",user_id:account,trip_id:"trip-2",category:"Food",
      amount_mvr:"250",payment_status:"paid",entry_type:"expense"}
  ];
  const plans=[{id:"book-1",user_id:account,trip_id:"trip-1",
    start_date:"2027-01-10",title:"Hotel",committed_mvr:2000}];
  const client={
    from(table) {
      const options={table,where:{}};
      const q={
        select(){return q;},
        eq(k,v){options.where[k]=v;return q;},
        async order(){
          queries.push(options);
          if(table===errorTable)return {data:null,error:Error("Test cloud unavailable")};
          return {data:(table==="trip_expenses"?expenses:plans)
            .filter(x=>x.user_id===options.where.user_id),error:null};
        }
      };
      return q;
    }
  };
  const context=vm.createContext({
    document:{getElementById(id){return id==="appContent"?element:
      id==="modalBody"?{addEventListener(){}}:null;}},
    window:{voyafundraV2Drafts:{list(){return[];}}},
    supabaseClient:client,console,Date,Math,
    cloudUserId:account,cloudReady:true,
    notify(){},render(){}
  });
  vm.runInContext(pure+"\n"+source,context);
  return {api:context.window.voyafundraV2,context,queries,handlers,account};
}

test("v2 workspace loads only signed-in owner records from both new tables",async()=>{
 const h=harness();
 assert.equal(await h.api.load(h.account),true);
 assert.equal(h.queries.length,2);
 assert.deepEqual(h.queries.map(q=>q.where.user_id),[h.account,h.account]);
 assert.equal(h.api.exportRows().expenses.length,3);
 assert.equal(h.api.exportRows().plan_items.length,1);
 assert.equal(h.api.status().loadError,null);
});

test("trip spending is independent of savings, booking commitments, and other trips",async()=>{
 const h=harness();
 await h.api.load(h.account);
 const sum=h.api.expenseSummary("trip-1");
 assert.equal(sum.spent,400);
 assert.equal(sum.categories[0].actual,400);
 assert.equal(h.api.expenseSummary("trip-2").spent,250);
 assert.equal(h.api.expenseSummary("missing").spent,0);
 // The itinerary's 2000 MVR committed estimate is not a paid expense.
 assert.equal(h.api.exportRows().plan_items[0].committed_mvr,2000);
});

test("account/session reset removes all cached account-specific records",async()=>{
 const h=harness();
 await h.api.load(h.account);
 h.api.reset();
 assert.equal(h.api.exportRows().expenses.length,0);
 assert.equal(h.api.exportRows().plan_items.length,0);
 assert.equal(h.api.status().unconfirmed,false);
});

test("loading failure is visible and prevents unsafe editing",async()=>{
 const h=harness({errorTable:"trip_plan_items"});
 assert.equal(await h.api.load(h.account),false);
 assert.match(h.api.status().loadError,/unavailable/);
 assert.equal(h.api.exportRows().expenses.length,0);
});

test("trip workspace and Settings integration retain existing navigation",()=>{
 const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
 const app=fs.readFileSync(path.join(root,"app.js"),"utf8");
 const css=fs.readFileSync(path.join(root,"trip-v2.css"),"utf8");
 const mobile=fs.readFileSync(path.join(root,"mobile.js"),"utf8");
 assert.match(html,/id="settingsNav"/);
 assert.match(html,/id="mobileSettingsBtn"/);
 assert.match(app,/renderSettings\(\)/);
 assert.match(source,/data-vf2-panel/);
 assert.match(source,/aria-selected/);
 assert.match(source,/ArrowRight/);
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(mobile,/const settings = document\.getElementById\("settingsNav"\)/);
});
