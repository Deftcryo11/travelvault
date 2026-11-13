"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const code=fs.readFileSync(path.resolve(__dirname,"../trip-v2-drafts.js"),"utf8");
const store=new Map();
const storage={
  get length(){return store.size;},
  key(i){return [...store.keys()][i]??null;},
  getItem(k){return store.has(k)?store.get(k):null;},
  setItem(k,v){store.set(k,String(v));},
  removeItem(k){store.delete(k);}
};
const ctx=vm.createContext({window:{},localStorage:storage,Date,Math,JSON});
vm.runInContext(code,ctx);
const drafts=ctx.window.voyafundraV2Drafts;
const user="11111111-2222-4333-8444-555555555555";
const row={id:"tripExpense",trip_id:"trip-one",description:"Lunch",amount_mvr:230};

test("version 2 drafts are isolated by account, table, and record",()=>{
  store.clear();
  const token=drafts.store(user,"trip_expenses","item-1","trip-one",row,1);
  assert.equal(drafts.list(user).length,1);
  assert.equal(drafts.list("11111111-2222-4333-8444-666666666666").length,0);
  assert.equal(drafts.list(user)[0].baseRevision,1);
  assert.equal(drafts.forget(user,"trip_expenses","item-1",token),true);
  assert.equal(drafts.list(user).length,0);
});

test("a queued older write cannot erase a newer expense draft",()=>{
  store.clear();
  const first=drafts.store(user,"trip_expenses","item-1","trip-one",row,2);
  const newer=drafts.store(user,"trip_expenses","item-1","trip-one",
    {...row,amount_mvr:500},3);
  assert.notEqual(first,newer);
  assert.equal(drafts.forget(user,"trip_expenses","item-1",first),false);
  assert.equal(drafts.list(user)[0].baseRevision,2);
  assert.equal(drafts.list(user)[0].record.amount_mvr,500);
  assert.equal(drafts.forget(user,"trip_expenses","item-1",newer),true);
});

test("damaged local drafts are not silently deleted",()=>{
  store.clear();
  storage.setItem("voyafundra.v2.draft."+user+".trip_expenses.item-1","{invalid");
  assert.throws(()=>drafts.list(user),/damaged/);
  assert.equal(store.size,1);
  store.clear();
});

test("only activity tables with safe IDs may be journalled",()=>{
  store.clear();
  assert.throws(()=>drafts.store(user,"trips","x","trip-one",row,1),/Invalid/);
  assert.throws(()=>drafts.store(user,"trip_expenses","../bad","trip-one",row,1),/Invalid/);
  assert.equal(store.size,0);
});

test("new expense/plan writers use revision guards and journal first",()=>{
 const source=fs.readFileSync(path.resolve(__dirname,"../trip-v2.js"),"utf8");
 assert.match(source,/journal\(\)\.store\(/);
 assert.match(source,/\.eq\("revision",baseRevision\)/);
 assert.match(source,/\.eq\("revision",record\.revision\)/);
 assert.match(source,/\.insert\(payload\)/);
 assert.doesNotMatch(source,/\.upsert\(/);
 assert.match(source,/window\.voyafundraV2\s*=/);
 assert.match(source,/window\.confirm\(/);
});
