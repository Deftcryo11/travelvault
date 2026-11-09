"use strict";
/* Emergency journal for newly introduced expense and itinerary records.
   Never stores tokens/passwords; records are readable to scripts in this
   browser, so backup exports and this device must be kept private. */
(() => {
  const PREFIX="voyafundra.v2.draft.";
  const valid = x=>typeof x==="string"&&/^[a-zA-Z0-9_.-]{1,150}$/.test(x);
  const kinds=["trip_expenses","trip_plan_items"];
  const key=(user,table,id)=>{
    if(!valid(user)||!valid(id)||!kinds.includes(table))
      throw new Error("Invalid recovery draft key.");
    return PREFIX+user+"."+table+"."+id;
  };
  const clone = x=>JSON.parse(JSON.stringify(x));
  function read(user,table,id) {
    const raw=localStorage.getItem(key(user,table,id));
    if(raw===null)return null;
    try {
      const data=JSON.parse(raw);
      if(data.schema!=="voyafundra-v2-draft"||data.userId!==user||
        data.table!==table||data.id!==id||!data.tripId||
        !data.record||typeof data.token!=="string")throw Error();
      return data;
    } catch {
      throw new Error("A local expense/itinerary draft is damaged. Do not clear site data.");
    }
  }
  function list(user) {
    if(!valid(user))throw new Error("Invalid recovery account.");
    const prefix=PREFIX+user+".";
    const keys=[];
    for(let i=0;i<localStorage.length;i++){
      const storageKey=localStorage.key(i);
      if(storageKey?.startsWith(prefix))keys.push(storageKey);
    }
    return keys.sort().map(k=>{
      const suffix=k.slice(prefix.length);
      const table=kinds.find(t=>suffix.startsWith(t+"."));
      if(!table)throw Error("Unknown recovery record. Do not clear site data.");
      return read(user,table,suffix.slice(table.length+1));
    });
  }
  function store(user,table,id,tripId,record,baseRevision) {
    const storageKey=key(user,table,id);
    if(!valid(tripId))throw Error("Invalid trip for recovery.");
    const before=read(user,table,id);
    const token=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);
    const payload={
      schema:"voyafundra-v2-draft",userId:user,table,id,tripId,
      record:clone(record),baseRevision:before?.baseRevision??baseRevision??null,
      writtenAt:new Date().toISOString(),token,
    };
    const raw=JSON.stringify(payload);
    if(raw.length>150000)throw Error("Recovery draft is too large.");
    const current=list(user);
    if(!before&&current.length>=60)throw Error("Too many unconfirmed recovery drafts.");
    localStorage.setItem(storageKey,raw);
    if(read(user,table,id)?.token!==token)throw Error("Recovery draft was not stored.");
    return token;
  }
  function forget(user,table,id,token) {
    const entry=read(user,table,id);
    if(!entry)return false;
    if(entry.token!==token)return false;
    localStorage.removeItem(key(user,table,id));
    if(localStorage.getItem(key(user,table,id))!==null)
      throw Error("Could not clear a confirmed recovery draft.");
    return true;
  }
  window.voyafundraV2Drafts={list,store,read,forget};
})();
