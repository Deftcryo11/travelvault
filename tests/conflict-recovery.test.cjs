"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "conflict-recovery.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "experience.js"), "utf8");

const row = (id, name, timestamp = "2026-11-01T01:00:00.000Z") =>
  ({ id, user_id: "user-1", updated_at: timestamp,
     trip_data: { id, name, budget: 100, options: [], savings: [] } });

function setup({ remote = [row("a", "PC copy")],
  local = [{ id: "a", name: "Phone edit", budget: 150, options: [], savings: [] }],
  pending = ["a"] } = {}) {
  const records = new Map(remote.map(r => [r.id, JSON.parse(JSON.stringify(r))]));
  const calls = [];
  const client = {
    from(name) {
      assert.equal(name, "trips");
      const filter = {};
      let action = "read", payload;
      const query = {
        eq(k,v) { filter[k]=v; return query; },
        update(body) { action="update"; payload=body; return query; },
        select() {
          if (action !== "update") return query;
          calls.push({ action, ...filter });
          const stored = records.get(filter.id);
          if (!stored || Object.entries(filter).some(([k,v]) => stored[k]!==v)) {
            return Promise.resolve({ data:[], error:null });
          }
          const changed = { ...stored, ...JSON.parse(JSON.stringify(payload)) };
          records.set(stored.id, changed);
          return Promise.resolve({ data:[{updated_at:changed.updated_at}],error:null });
        },
        async maybeSingle() {
          calls.push({ action:"read",...filter });
          const stored=records.get(filter.id);
          return { data:stored && stored.user_id===filter.user_id
            ? JSON.parse(JSON.stringify(stored)) : null, error:null };
        },
      };
      return query;
    }
  };
  const ctx=vm.createContext({
    window:{voyafundraUX:{setStatus() {}}},
    navigator:{onLine:true},supabaseClient:client,
    initialLocal:local, initialPending:pending, Date, render() {}
  });
  const globals=[
    'let trips=JSON.parse(JSON.stringify(initialLocal));',
    'let cloudReady=true, cloudUserId="user-1", cloudEpoch=1;',
    'let cloudTripVersions=new Map([["a","2026-10-01T01:00:00.000Z"]]);',
    'let cloudUnsavedTripIds=new Set(initialPending);',
    'let cloudTripSaveSequence=new Map([["a",1]]);',
    'let cloudWriteGeneration=5, cloudWritesPending=0;',
    'let cloudSaveError=Error("conflict");',
    'let cloudWriteQueue=Promise.reject(Error("conflict")); cloudWriteQueue.catch(()=>{});',
    'let selectedTripId="a";'
  ].join("\n");
  vm.runInContext(globals+"\n"+source,ctx);
  return {ctx, api:ctx.window.voyafundraConflicts, records, calls};
}

test("comparison is read-only and preserves both versions",async()=>{
  const x=setup(), prev=JSON.stringify(x.records.get("a"));
  const v=await x.api.review("a");
  assert.equal(v.remote.name,"PC copy");
  assert.equal(v.local.name,"Phone edit");
  assert.equal(JSON.stringify(x.records.get("a")),prev);
  assert.equal(x.calls.filter(c=>c.action==="update").length,0);
});

test("accepting cloud resolves only selected trip",async()=>{
  const x=setup({remote:[row("a","PC copy"),row("b","Other cloud")],
    local:[{id:"a",name:"Phone edit"},{id:"b",name:"Pending other"}],pending:["a","b"]});
  const v=await x.api.review("a");
  assert.equal(await x.api.useCloud(v),true);
  assert.equal(vm.runInContext('trips.find(t=>t.id==="a").name',x.ctx),"PC copy");
  assert.equal(vm.runInContext('trips.find(t=>t.id==="b").name',x.ctx),"Pending other");
  assert.equal(vm.runInContext('cloudUnsavedTripIds.has("b")',x.ctx),true);
  assert.equal(x.calls.filter(c=>c.action==="update").length,0);
});

test("user-approved local version uses atomic updated_at condition",async()=>{
  const x=setup({remote:[row("a","PC copy"),row("b","Other cloud")]});
  const v=await x.api.review("a");
  assert.equal(await x.api.useLocal(v),true);
  assert.equal(x.records.get("a").trip_data.name,"Phone edit");
  assert.equal(x.records.get("b").trip_data.name,"Other cloud");
  const writes=x.calls.filter(c=>c.action==="update");
  assert.equal(writes.length,1);
  assert.equal(writes[0].updated_at,v.updatedAt);
  assert.equal(vm.runInContext('cloudUnsavedTripIds.size',x.ctx),0);
});

test("newer cloud changes reject stale local overwrite",async()=>{
  const x=setup(), v=await x.api.review("a");
  x.records.set("a",row("a","More recent", "2026-11-01T02:00:00.000Z"));
  await assert.rejects(x.api.useLocal(v),/Cloud changed again/);
  assert.equal(x.records.get("a").trip_data.name,"More recent");
  assert.equal(vm.runInContext('trips[0].name',x.ctx),"Phone edit");
  assert.equal(vm.runInContext('cloudUnsavedTripIds.has("a")',x.ctx),true);
});

test("newer cloud changes reject stale cloud acceptance",async()=>{
  const x=setup(), v=await x.api.review("a");
  x.records.set("a",row("a","More recent", "2026-11-01T02:00:00.000Z"));
  await assert.rejects(x.api.useCloud(v),/Cloud version changed again/);
  assert.equal(vm.runInContext('trips[0].name',x.ctx),"Phone edit");
});

test("new local edit and account switch invalidate an old comparison",async()=>{
  const x=setup(), v=await x.api.review("a");
  vm.runInContext('trips[0].budget=180',x.ctx);
  await assert.rejects(x.api.useCloud(v),/Local trip changed/);
  vm.runInContext('cloudUserId="other-user"',x.ctx);
  await assert.rejects(x.api.useLocal(v),/The trip or account changed|no longer has an unresolved save/);
});

test("deleted cloud trip cannot be silently recreated by overwrite",async()=>{
  const x=setup({remote:[]}), v=await x.api.review("a");
  assert.equal(v.remote,null);
  await assert.rejects(x.api.useLocal(v),/deleted or is missing/);
  assert.equal(x.records.size,0);
});

test("review UI presents user-confirmed choices, never automatic merge",()=>{
  for(const id of ["cloudConflictTripSelect","compareCloudTripBtn",
    "cloudConflictComparison","acceptCloudTripBtn","acceptLocalTripBtn",
    "acknowledgeConflictChoice"]) assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,/acknowledgeConflict\.checked/);
  assert.match(ui,/window\.confirm\(warning\)/);
  assert.match(ui,/voyafundraConflicts\.review/);
  assert.match(ui,/voyafundraConflicts\.useCloud/);
  assert.match(ui,/voyafundraConflicts\.useLocal/);
  assert.match(html,/src="conflict-recovery\.js"/);
});
