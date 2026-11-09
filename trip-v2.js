"use strict";

/* Voyafundra 2 trip workspace. All new records belong to the logged-in
   account and parent trip, and every mutation is revision-guarded. */
(() => {
  const root=document.getElementById("appContent");
  if(!root)return;
  const core=()=>window.voyafundraV2Core;
  const journal=()=>window.voyafundraV2Drafts;
  const h=v=>String(v??"").replace(/[&<>"']/g,c=>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const m=n=>"MVR "+Number(n||0).toLocaleString("en-US",{
    minimumFractionDigits:2,maximumFractionDigits:2
  });
  const button=(action,title,kind="btn-outline",id="")=>
    '<button type="button" class="btn btn-small '+kind+
    '" data-vf2-action="'+action+'"'+(id?' data-vf2-id="'+h(id)+'"':'')+
    '>'+h(title)+'</button>';
  const TABLE={expenses:"trip_expenses",plan:"trip_plan_items"};
  const state={
    account:null,epoch:0,expenses:[],plans:[],drafts:[],
    writes:0,unsafe:false,loadError:null,loading:false,
    tab:"overview",tripId:null,reviewed:null
  };
  const scoped=(table,tripId)=>table==="trip_expenses"
    ?state.expenses.filter(x=>x.trip_id===tripId)
    :state.plans.filter(x=>x.trip_id===tripId);
  const errorText=err=>err?.message||String(err||"Unknown error");

  function status(){
    return {
      unconfirmed:state.writes>0||state.unsafe||state.drafts.length>0,
      protected:!state.unsafe,
      writes:state.writes,
      drafts:state.drafts.length,
      loadError:state.loadError
    };
  }
  function reset(){
    state.epoch++;
    state.account=null;state.expenses=[];state.plans=[];
    state.drafts=[];state.writes=0;state.unsafe=false;
    state.loading=false;state.loadError=null;state.reviewed=null;
    state.tripId=null;state.tab="overview";
  }
  async function load(userId){
    const epoch=++state.epoch;
    state.account=userId;
    state.loading=true;state.loadError=null;state.reviewed=null;
    state.expenses=[];state.plans=[];
    try {
      const [expenses,plans]=await Promise.all([
        supabaseClient.from(TABLE.expenses).select("*")
          .eq("user_id",userId).order("expense_date",{ascending:false}),
        supabaseClient.from(TABLE.plan).select("*")
          .eq("user_id",userId).order("start_date",{ascending:true})
      ]);
      if(state.epoch!==epoch||cloudUserId!==userId)return false;
      if(expenses.error||plans.error)throw expenses.error||plans.error;
      state.expenses=expenses.data||[];
      state.plans=plans.data||[];
      state.drafts=journal()?.list(userId)||[];
      state.loading=false;
      return true;
    }catch(err){
      if(state.epoch!==epoch)return false;
      state.loadError=errorText(err);
      state.loading=false;
      try {state.drafts=journal()?.list(userId)||[];}
      catch(e){state.unsafe=true;state.loadError+="; "+errorText(e);}
      return false;
    }
  }
  function refreshView(){
    if(!state.account||!cloudReady)return;
    render();
  }
  function inlineNotice(){
    if(state.loading)return '<div class="vf2-notice">Loading spending and itinerary records...</div>';
    if(state.loadError)return '<div class="vf2-notice" role="alert">'+
      'Could not load all trip records: '+h(state.loadError)+' '+
      button("retry-load","Try again")+'</div>';
    return "";
  }
  function draftNotice(tripId){
    const drafts=state.drafts.filter(x=>!tripId||x.tripId===tripId);
    if(!drafts.length)return "";
    return '<div class="vf2-notice" role="alert">'+drafts.length+
      ' unconfirmed expense/itinerary draft(s) saved in this browser. '+
      'They are not automatically uploaded. '+button("review-drafts","Review saved drafts")+
      '</div>';
  }
  function card(label,value,subtitle){
    return '<div class="vf2-metric"><small>'+h(label)+'</small><strong>'+
      h(value)+'</strong><small>'+h(subtitle||"")+'</small></div>';
  }
  function overview(trip){
    const expenses=scoped(TABLE.expenses,trip.id);
    const plan=scoped(TABLE.plan,trip.id);
    const money=core().expenseSummary(expenses,trip.budget);
    const checklist=core().checklistUpcoming(trip);
    const next=core().groupItinerary(plan.filter(x=>x.booking_status!=="cancelled"&&
      x.start_date>=core().localDate()))[0]?.items?.[0];
    return '<div class="vf2-overview">'+
      '<div class="vf2-metrics">'+
      card("Actual spending",m(money.spent),"Paid expenses less refunds")+
      card("Unspent budget",m(money.remaining),"Trip budget minus actual spending")+
      card("Planned expenses",m(money.planned),"Not yet paid")+
      card("Upcoming bookings",plan.filter(x=>x.start_date>=core().localDate()&&
        x.booking_status==="confirmed").length,"Confirmed future itinerary items")+
      '</div><div class="vf2-overview-grid">'+
      '<div class="vf2-summary"><h3>Next itinerary item</h3><p>'+
      (next?h(next.start_date+' · '+(next.start_time||"")+' '+next.title):
        'Nothing scheduled yet.')+'</p>'+
      button("tab-plan","Open itinerary")+'</div>'+
      '<div class="vf2-summary"><h3>Preparation tasks</h3><p>'+
      (checklist.length?h(checklist.length+' remaining · '+checklist[0].title+
        (checklist[0].overdue?' (overdue)':'')):'All current tasks completed')+
      '</p>'+button("tab-checklist","Open checklist")+'</div></div></div>';
  }
  function expenseSection(trip){
    const rows=scoped(TABLE.expenses,trip.id).slice().sort((a,b)=>
      b.expense_date.localeCompare(a.expense_date));
    const sum=core().expenseSummary(rows,trip.budget);
    const categories=core().categoryBudgets(trip,rows);
    return '<section class="panel vf2-section">'+
      '<div class="panel-head"><div><h2>Actual expenses</h2>'+
      '<p>Paid expenses, refunds and planned costs are tracked separately.</p></div>'+
      button("expense-new","+ Add expense","btn-primary")+'</div>'+
      '<div class="vf2-metrics">'+
      card("Net spent",m(sum.spent),"Includes completed refunds")+
      card("Unspent",m(sum.remaining),"Negative means over budget")+
      card("Planned",m(sum.planned),"Not counted as spent")+
      card("Refunds",m(sum.refunds),"Already deducted from spent")+
      '</div>'+
      (categories.length?
      '<div class="vf2-category-list"><h3>Category budgets</h3>'+
      categories.map(item=>
        '<div class="vf2-category-line"><span>'+h(item.category)+'</span>'+
        '<strong>'+h(m(item.actual))+' / '+h(m(item.estimate))+'</strong>'+
        '<div class="vf2-meter"><span style="width:'+Math.max(0,Math.min(100,
          item.estimate?item.actual/item.estimate*100:0)).toFixed(2)+'%"></span></div></div>'
      ).join("")+'</div>':'')+
      '<div class="vf2-toolbar">'+button("category-edit","Edit category budgets")+
      button("expense-csv","Export expenses CSV")+'</div>'+
      (rows.length?'<div class="vf2-record-list">'+rows.map(x=>{
        const linked=x.booking_id?state.plans.find(p=>p.id===x.booking_id):null;
        const detail=x.expense_date+' · '+x.category+' · '+
          (x.entry_type==="refund"?"Refund":x.payment_status==="paid"?"Paid":"Planned");
        return '<article class="vf2-record"><div><h3>'+h(x.description)+'</h3>'+
          '<p>'+h(detail)+'</p>'+
          (linked?'<small>Linked to '+h(linked.title)+'</small>':'')+
          (x.currency==="USD"?'<small>USD '+h(x.original_amount)+
            ' × '+h(x.exchange_rate)+' MVR/USD</small>':'')+
          (x.notes?'<small>'+h(x.notes)+'</small>':'')+
          '</div><div class="vf2-record-right"><strong>'+
          (x.entry_type==="refund"?"−":"")+h(m(x.amount_mvr))+'</strong>'+
          '<div class="vf2-actions">'+button("expense-edit","Edit","btn-outline",x.id)+
          button("expense-delete","Delete","btn-outline",x.id)+'</div></div></article>';
      }).join("")+'</div>':'<p class="vf2-empty">No expenses recorded yet. Estimates in travel options are not actual spending.</p>')+
      '</section>';
  }
  function savingsSection(trip){
    const info=core().saverForecast(trip);
    return '<section class="panel vf2-section"><div class="panel-head"><div>'+
      '<h2>Savings by person</h2><p>Individual targets and recorded contributions</p>'+
      '</div></div><div class="vf2-metrics">'+
      card("Amount left to save",m(info.remaining),"Across all savers")+
      card("Monthly needed",info.requiredMonthly===null?"—":m(info.requiredMonthly),
        info.months+' calendar month(s) remaining')+'</div>'+
      (info.people.length?'<div class="vf2-saver-list">'+info.people.map(p=>
        '<div class="vf2-saver"><div><strong>'+h(p.name)+'</strong>'+
        '<small>Saved '+h(m(p.saved))+' · Planned '+h(m(p.planned))+'</small></div>'+
        '<div><strong>'+h(m(p.monthlyTarget))+'</strong>'+
        '<small>Monthly target · projected additional '+h(m(p.projectedAdditional))+
        '</small></div></div>').join("")+'</div>':
        '<p class="vf2-empty">Add people saving for this trip to see individual progress.</p>')+
      '<p class="vf2-hint">Forecasts are estimates based on entered monthly targets; they are not actual account balances.</p></section>';
  }
  function itinerarySection(trip){
    const rows=scoped(TABLE.plan,trip.id);
    const groups=core().groupItinerary(rows);
    const paid=state.expenses.filter(x=>x.trip_id===trip.id&&
      x.payment_status==="paid"&&x.entry_type==="expense");
    return '<section class="panel vf2-section"><div class="panel-head"><div>'+
      '<h2>Itinerary & bookings</h2><p>Dates and times are entered in the destination’s local time.</p></div>'+
      button("plan-new","+ Add event","btn-primary")+'</div>'+
      '<p class="vf2-hint">Booking references are private to your account. '+
      'Do not store payment passwords or security codes. Confirmed booking costs are not '+
      'automatically counted as spending.</p>'+
      (groups.length?groups.map(group=>
        '<div class="vf2-day"><h3>'+h(group.date)+'</h3>'+
        group.items.map(x=>{
          const linked=paid.filter(e=>e.booking_id===x.id);
          return '<article class="vf2-record">'+
            '<div><strong>'+h(x.title)+'</strong><p>'+h(
              x.kind+' · '+x.booking_status+
              (x.start_time?' · '+x.start_time:'')+
              (x.time_zone?' ('+x.time_zone+')':'')
            )+'</p>'+
            (x.location?'<small>Location: '+h(x.location)+'</small>':'')+
            (x.provider?'<small>Provider: '+h(x.provider)+'</small>':'')+
            (x.booking_reference?'<small>Reference: '+h(x.booking_reference)+'</small>':'')+
            (x.notes?'<small>'+h(x.notes)+'</small>':'')+
            '</div><div class="vf2-record-right"><small>Committed estimate</small>'+
            '<strong>'+h(m(x.committed_mvr))+'</strong>'+
            '<small>'+linked.length+' linked paid expense(s)</small>'+
            '<div class="vf2-actions">'+button("plan-edit","Edit","btn-outline",x.id)+
            button("plan-delete","Delete","btn-outline",x.id)+'</div></div></article>';
        }).join("")+'</div>').join(""):
        '<p class="vf2-empty">No itinerary events yet. Add flights, hotels, transport or activities.</p>')+
      '</section>';
  }
  function reportSection(trip){
    return '<section class="panel vf2-section"><div class="panel-head"><div>'+
      '<h2>Trip report</h2><p>Review planning, savings and spending together.</p></div>'+
      '</div><div class="vf2-toolbar">'+button("report-print","Print trip summary")+
      button("report-json","Download trip report (JSON)")+'</div></section>';
  }
  function enhanceTrip(trip){
    if(state.tripId!==trip.id){state.tripId=trip.id;state.tab="overview";}
    const children=[...root.children];
    const top=children.find(x=>x.classList?.contains("detail-top"));
    if(!top)return;
    const tabs=["overview","budget","savings","plan","checklist"];
    const names=["Overview","Budget & Expenses","Savings","Itinerary & Bookings","Checklist"];
    const nav=document.createElement("div");
    nav.className="vf2-tabs";nav.setAttribute("role","tablist");
    nav.setAttribute("aria-label","Trip workspace");
    tabs.forEach((tab,index)=>{
      const b=document.createElement("button");
      b.type="button";b.dataset.vf2Action="tab-"+tab;b.dataset.vf2Tab=tab;
      b.id="vf2-tab-"+tab;b.setAttribute("role","tab");
      b.textContent=names[index];nav.appendChild(b);
    });
    top.insertAdjacentElement("afterend",nav);
    const area=document.createElement("div");
    area.className="vf2-area";nav.insertAdjacentElement("afterend",area);
    const containers={};
    for(const tab of tabs) {
      const div=document.createElement("div");
      div.className="vf2-panel";
      div.dataset.vf2Panel=tab;
      div.id="vf2-panel-"+tab;div.setAttribute("role","tabpanel");
      div.setAttribute("aria-labelledby","vf2-tab-"+tab);
      area.appendChild(div);containers[tab]=div;
    }
    for(const child of children){
      if(child.classList?.contains("stats"))containers.overview.appendChild(child);
      if(!child.classList?.contains("panel"))continue;
      const title=child.querySelector("h2")?.textContent?.trim()||"";
      const where=title==="Savings progress"?"overview":
        title==="Budget & savings insights"||title==="Monthly savings tracker"?"savings":
        title.includes("Flight & trip cost comparison")?"budget":
        title==="Travel checklist"||title==="Trip notes"?"checklist":null;
      if(where)containers[where].appendChild(child);
    }
    containers.overview.insertAdjacentHTML("beforeend",inlineNotice()+
      draftNotice(trip.id)+overview(trip)+reportSection(trip));
    containers.budget.insertAdjacentHTML("beforeend",inlineNotice()+
      draftNotice(trip.id)+expenseSection(trip));
    containers.savings.insertAdjacentHTML("beforeend",savingsSection(trip));
    containers.plan.insertAdjacentHTML("beforeend",inlineNotice()+
      draftNotice(trip.id)+itinerarySection(trip));
    containers.checklist.insertAdjacentHTML("afterbegin",
      '<p class="vf2-hint">Choose a task priority and category in the task editor. '+
      'Overdue tasks are highlighted.</p>');
    setTab(state.tab);
  }
  function enhanceList(){
    state.tripId=null;
    if(state.drafts.length)root.insertAdjacentHTML("afterbegin",
      draftNotice(null));
    if(state.loadError)root.insertAdjacentHTML("afterbegin",inlineNotice());
  }
  function setTab(tab){
    const area=root.querySelector(".vf2-tabs");
    if(!area)return;
    const allowed=["overview","budget","savings","plan","checklist"];
    state.tab=allowed.includes(tab)?tab:"overview";
    root.querySelectorAll("[data-vf2-tab]").forEach(btn=>{
      const active=btn.dataset.vf2Tab===state.tab;
      btn.classList.toggle("is-active",active);
      btn.setAttribute("aria-selected",String(active));
      btn.tabIndex=active?0:-1;
    });
    root.querySelectorAll("[data-vf2-panel]").forEach(panel=>{
      panel.hidden=panel.dataset.vf2Panel!==state.tab;
    });
  }

  function expenseForm(trip,existing=null){
    if(state.loadError||state.loading)return notify("Trip records are not available yet.");
    const date=existing?.expense_date||core().localDate();
    const categories=[...new Set([...core().CATEGORIES,
      ...Object.keys(trip.budgetCategories||{}),
      ...state.expenses.filter(x=>x.trip_id===trip.id).map(x=>x.category)])];
    const bookingOptions=scoped(TABLE.plan,trip.id);
    const bookingSelect='<div class="field"><label for="vf2-booking">Related booking (optional)</label>'+
      '<select id="vf2-booking" name="booking_id"><option value="">No linked booking</option>'+
      bookingOptions.map(p=>'<option value="'+h(p.id)+'" '+
        (existing?.booking_id===p.id?'selected':'')+'>'+h(p.title)+'</option>').join("")+
      '</select></div>';
    const body=field("expense_date","Expense date",date,"date",{required:true})+
      field("description","Description",existing?.description||"","text",{required:true})+
      selectField("category","Category",existing?.category||"Other",categories)+
      field("original_amount","Amount in chosen currency",existing?.original_amount??"","number",
        {required:true})+
      selectField("currency","Currency",existing?.currency||"MVR",["MVR","USD"])+
      field("exchange_rate","Bank rate: MVR per USD (only for USD)",
        existing?.currency==="USD"?existing.exchange_rate:15.42,"number")+
      selectField("entry_type","Entry type",existing?.entry_type||"expense",
        ["expense","refund"])+
      selectField("payment_status","Payment status",existing?.payment_status||"paid",
        ["paid","planned"])+
      bookingSelect+
      field("notes","Notes (optional)",existing?.notes||"","text",{full:true})+
      '<p id="vf2-form-message" class="vf2-form-message" role="alert"></p>';
    showModal(existing?"Edit expense":"Add expense",body,(form)=>{
      void submitEntry(TABLE.expenses,trip,form,existing);
      return false;
    });
  }
  function itineraryForm(trip,existing=null){
    if(state.loadError||state.loading)return notify("Trip records are not available yet.");
    const body=selectField("kind","Type",existing?.kind||"activity",
        core().KINDS)+
      field("title","Title",existing?.title||"","text",{required:true})+
      field("start_date","Date",existing?.start_date||trip.departure||
        core().localDate(),"date",{required:true})+
      field("start_time","Start time (destination local)",
        existing?.start_time?.slice(0,5)||"","time")+
      field("end_date","End date (optional)",existing?.end_date||"","date")+
      field("end_time","End time (optional)",existing?.end_time?.slice(0,5)||"","time")+
      field("time_zone","Destination time zone (optional)",
        existing?.time_zone||"","text",{placeholder:"Asia/Colombo"})+
      field("location","Location",existing?.location||"","text")+
      field("provider","Provider / airline / hotel",existing?.provider||"","text")+
      field("booking_reference","Booking reference",existing?.booking_reference||"","text")+
      selectField("booking_status","Booking status",
        existing?.booking_status||"idea",core().STATUSES)+
      field("committed_mvr","Committed estimate (MVR)",
        existing?.committed_mvr??0,"number")+
      field("notes","Notes",existing?.notes||"","text",{full:true})+
      '<p id="vf2-form-message" class="vf2-form-message" role="alert"></p>';
    showModal(existing?"Edit itinerary item":"Add itinerary item",body,(form)=>{
      void submitEntry(TABLE.plan,trip,form,existing);
      return false;
    });
  }
  function modalBusy(value,msg){
    const form=document.getElementById("activeForm");
    if(!form)return;
    form.querySelectorAll("button").forEach(b=>b.disabled=value);
    const close=document.getElementById("modalClose");
    if(close)close.disabled=value;
    const message=document.getElementById("vf2-form-message");
    if(message)message.textContent=msg||"";
  }
  async function submitEntry(table,trip,form,existing){
    if(state.writes>0)return;
    let body;
    try{
      body=table===TABLE.expenses?core().expenseInput(form):
        core().itineraryInput(form);
      if(body.booking_id &&
        !state.plans.some(x=>x.id===body.booking_id&&x.trip_id===trip.id))
        throw Error("Selected booking is no longer available.");
    }catch(err){modalBusy(false,errorText(err));return;}
    modalBusy(true,"Saving to Supabase...");
    try{
      await saveRecord(table,trip.id,body,existing);
      closeModal();refreshView();notify("Change confirmed by Supabase.");
    }catch(err){
      modalBusy(false,"Save not confirmed: "+errorText(err)+
        ". Your recovery draft is preserved.");
      notify("Could not save; review this draft before logging out.");
      refreshView();
    }
  }
  async function saveRecord(table,tripId,body,existing=null){
    if(state.writes>0)throw Error("Finish the previous save first.");
    if(!cloudReady||!cloudUserId||state.account!==cloudUserId||
      state.loadError||state.loading)throw Error("Cloud workspace is not ready.");
    const user=cloudUserId,epoch=state.epoch;
    const id=existing?.id||generateId();
    const baseRevision=existing?.revision??null;
    const payload={...body,user_id:user,trip_id:tripId,id};
    let token=null;
    try {
      token=journal().store(user,table,id,tripId,payload,baseRevision);
      state.drafts=journal().list(user);
      state.unsafe=false;
    } catch(err) {
      state.unsafe=true;
      throw Error("Could not protect your local edit: "+errorText(err));
    }
    state.writes++;
    try{
      if(!navigator.onLine)throw Error("Offline: your local draft is preserved; reconnect to retry.");
      const query=supabaseClient.from(table);
      const result=baseRevision===null?
        await query.insert(payload).select("*"):
        await query.update(body).eq("user_id",user).eq("trip_id",tripId)
          .eq("id",id).eq("revision",baseRevision).select("*");
      if(result.error)throw result.error;
      if(!result.data||result.data.length!==1)throw Error(
        "Another device changed this record. Compare versions before replacing it.");
      if(state.epoch!==epoch||state.account!==user)return false;
      const list=table===TABLE.expenses?state.expenses:state.plans;
      const index=list.findIndex(x=>x.id===id);
      if(index>=0)list[index]=result.data[0];else list.push(result.data[0]);
      journal().forget(user,table,id,token);
      state.drafts=journal().list(user);
      state.unsafe=false;
      return true;
    }catch(err){
      try{state.drafts=journal().list(user);}
      catch(e){state.unsafe=true;}
      throw err;
    }finally{if(state.epoch===epoch)state.writes=Math.max(0,state.writes-1);}
  }
  async function deleteRecord(table,trip,id){
    if(state.writes>0||state.loadError||state.loading)
      return notify("Finish loading and saving first.");
    const arr=scoped(table,trip.id),record=arr.find(x=>x.id===id);
    if(!record)return;
    if(!window.confirm("Permanently delete "+(record.description||record.title)+
      "? A booking's linked expenses will remain recorded."))return;
    const user=state.account,epoch=state.epoch;
    state.writes++;
    try{
      const {data,error}=await supabaseClient.from(table).delete()
        .eq("user_id",user).eq("trip_id",trip.id).eq("id",id)
        .eq("revision",record.revision).select("id");
      if(error)throw error;
      if(!data||data.length!==1)throw Error("Deletion blocked: this record changed elsewhere.");
      if(state.epoch!==epoch)return;
      const list=table===TABLE.expenses?state.expenses:state.plans;
      const index=list.findIndex(x=>x.id===id);
      if(index>=0)list.splice(index,1);
      notify("Record deleted and confirmed in Supabase.");
      refreshView();
    }catch(e){notify("Deletion not confirmed: "+errorText(e));}
    finally{if(state.epoch===epoch)state.writes=Math.max(0,state.writes-1);}
  }
  function editCategories(trip){
    const keys=[...new Set([...core().CATEGORIES,...Object.keys(trip.budgetCategories||{})])];
    const body=keys.map((category,i)=>field("cat"+i,category+" budget (MVR)",
      trip.budgetCategories?.[category]??0,"number")).join("")+
      field("extraCategory","New custom category (optional)","","text",{full:true})+
      field("extraAmount","New category amount (MVR)",0,"number");
    showModal("Budget categories",body,form=>{
      const values={};
      try{
        keys.forEach((c,i)=>{const n=Number(form["cat"+i]);if(!Number.isFinite(n)||
          n<0||n>1e9)throw Error("Invalid category budget.");if(n>0)values[c]=core().round(n);});
        const name=String(form.extraCategory||"").trim();
        if(name) {
          if(name.length>70)throw Error("Category name is too long.");
          const amt=Number(form.extraAmount);
          if(!Number.isFinite(amt)||amt<0||amt>1e9)
            throw Error("Invalid new category amount.");
          values[name]=core().round(amt);
        }
      }catch(e){notify(errorText(e));return false;}
      trip.budgetCategories=values;
      saveTrips(trip.id);
      notify("Budget category update queued — check cloud save status.");
      return true;
    });
  }
  function download(text,filename,mime="application/json"){
    const url=URL.createObjectURL(new Blob([text],{type:mime}));
    const anchor=document.createElement("a");
    anchor.download=filename;anchor.href=url;
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  function exportCSV(trip){
    const cols=["Date","Category","Description","Currency","Original amount",
      "Bank rate","MVR amount","Entry type","Payment status","Booking","Notes"];
    const rows=scoped(TABLE.expenses,trip.id).map(e=>
      [e.expense_date,e.category,e.description,e.currency,e.original_amount,
        e.exchange_rate,e.amount_mvr,e.entry_type,e.payment_status,e.booking_id,e.notes]);
    download([cols,...rows].map(r=>r.map(core().csvSafe).join(",")).join("\r\n"),
      "voyafundra-expenses-"+trip.id+".csv","text/csv;charset=utf-8");
  }
  function report(trip){
    const expenses=scoped(TABLE.expenses,trip.id);
    const itinerary=scoped(TABLE.plan,trip.id);
    const summary=core().expenseSummary(expenses,trip.budget);
    const savings=core().saverForecast(trip);
    const check=core().checklistUpcoming(trip);
    return {
      format:"voyafundra-trip-report-v2",
      created_at:new Date().toISOString(),
      trip:{id:trip.id,name:trip.name,destination:trip.destination,
        departure:trip.departure,returnDate:trip.returnDate,status:trip.status,
        budget:trip.budget},
      finance:summary,savings,expense_count:expenses.length,
      expenses:expenses.map(x=>({...x})),
      itinerary:itinerary.map(x=>({...x})),
      checklist:Array.isArray(trip.checklist)?trip.checklist:[],
      checklist_remaining:check.length
    };
  }
  function printReport(trip){
    const target=document.createElement("section");
    target.className="vf2-print-target";
    const info=report(trip);
    target.innerHTML='<h1>'+h(trip.name)+'</h1><p>'+
      h(trip.destination)+' · '+h(trip.departure)+' to '+h(trip.returnDate)+'</p>'+
      '<h2>Financial summary</h2><p>Budget: '+h(m(trip.budget))+
      ' · Saved: '+h(m(info.savings.totalSaved))+
      ' · Actual spent: '+h(m(info.finance.spent))+
      ' · Remaining: '+h(m(info.finance.remaining))+'</p>'+
      '<h2>Expenses</h2>'+info.expenses.map(x=>
        '<p>'+h(x.expense_date)+' · '+h(x.description)+' · '+
        h(x.entry_type)+" "+h(m(x.amount_mvr))+'</p>').join("")+
      '<h2>Itinerary</h2>'+info.itinerary.map(x=>
        '<p>'+h(x.start_date)+' · '+h(x.title)+' · '+h(x.booking_status)+'</p>').join("")+
      '<h2>Checklist</h2>'+info.checklist.map(x=>
        '<p>'+(x.done?'✓ ':'□ ')+h(x.title)+'</p>').join("");
    document.body.appendChild(target);
    const cleanup=()=>target.remove();
    window.addEventListener("afterprint",cleanup,{once:true});
    window.print();
    // Fallback for browsers that never fire afterprint.
    setTimeout(cleanup,60000);
  }
  function reviewDrafts(){
    if(!state.drafts.length)return notify("No unconfirmed drafts remain.");
    const rows=state.drafts.map((x,i)=>
      '<article class="vf2-draft-row"><strong>'+h(x.table===TABLE.expenses?
        x.record.description:x.record.title)+'</strong>'+
      '<small>'+h(x.table===TABLE.expenses?"Expense":"Itinerary")+
      ' · '+h(x.writtenAt)+'</small>'+
      '<div class="vf2-actions">'+button("draft-compare","Compare", "btn-outline",String(i))+
      button("draft-discard","Discard", "btn-outline",String(i))+'</div></article>').join("");
    showModal("Unconfirmed local drafts",
      '<p class="vf2-hint">Drafts are stored only on this device. '+
      'Nothing is automatically uploaded. Keep this browser private.</p>'+
      '<div class="vf2-draft-list">'+rows+'</div>'+
      '<p id="vf2-form-message" role="alert"></p>',()=>false);
  }
  async function compareDraft(index){
    const draft=state.drafts[index];
    if(!draft)return;
    if(state.writes>0)return notify("Wait until saving finishes.");
    const {data,error}=await supabaseClient.from(draft.table).select("*")
      .eq("user_id",state.account).eq("trip_id",draft.tripId)
      .eq("id",draft.id).maybeSingle();
    if(error)return notify("Could not compare versions: "+errorText(error));
    state.reviewed={draft,remote:data,revision:data?.revision??null};
    const description=draft.table===TABLE.expenses?"expense":"itinerary";
    const panel='<p class="vf2-hint">This compares the full '+description+
      ' entry. If the cloud copy changed, saving the device copy can replace '+
      'those changes only after an explicit confirmation.</p>'+
      '<div class="vf2-compare"><div><strong>This device</strong><pre>'+
      h(JSON.stringify(draft.record,null,2))+'</pre></div>'+
      '<div><strong>Cloud</strong><pre>'+
      h(JSON.stringify(data||"Record not found",null,2))+
      '</pre></div></div>'+
      '<div class="vf2-actions">'+button("draft-keep-cloud","Use cloud / discard draft")+
      button("draft-retry","Save this device version")+'</div>'+
      '<p id="vf2-form-message" role="alert"></p>';
    showModal("Compare local and cloud "+description,panel,()=>false);
  }
  async function applyDraftChoice(choice){
    const review=state.reviewed;if(!review)return;
    const {draft,remote}=review;
    if(state.writes>0)return;
    if(choice==="cloud") {
      if(!window.confirm("Discard the unsaved local draft? The cloud record will not change."))return;
      try{
        journal().forget(draft.userId,draft.table,draft.id,draft.token);
        state.drafts=journal().list(state.account);
        state.reviewed=null;closeModal();
        await load(state.account);
        refreshView();
      }catch(e){notify(errorText(e));}return;
    }
    if(!window.confirm(
      remote && remote.revision!==draft.baseRevision?
        "The cloud entry changed after your draft. Replace the entire cloud entry with this device's version?":
        "Save this device's draft? It will be checked against the current cloud revision."
    ))return;
    const type=draft.table===TABLE.expenses?core().expenseInput:core().itineraryInput;
    let clean;try{clean=type(draft.record);}catch(e){return notify(errorText(e));}
    const original=remote?{id:remote.id,revision:remote.revision}:null;
    try{
      // Compare against the revision shown above, not a newer silent refresh.
      await saveRecord(draft.table,draft.tripId,clean,original);
      state.reviewed=null;closeModal();refreshView();
      notify("Recovered record saved to cloud.");
    }catch(e){
      notify("Cloud version may have changed. Compare again: "+errorText(e));
    }
  }
  root.addEventListener("click",async event=>{
    const b=event.target.closest("[data-vf2-action]");
    if(!b)return;
    const action=b.dataset.vf2Action,id=b.dataset.vf2Id;
    if(action.startsWith("tab-"))return setTab(action.slice(4));
    const trip=getSelectedTrip();
    if(action==="retry-load" && state.account) {
      await load(state.account);refreshView();return;
    }
    if(action==="review-drafts")return reviewDrafts();
    if(action==="draft-compare")return void compareDraft(Number(id));
    if(action==="draft-discard")return;
    if(!trip)return;
    if(!canStartTripEdit(trip.id)&&
      /^(expense|plan|category)/.test(action))return;
    if(action==="expense-new")return expenseForm(trip);
    if(action==="expense-edit")return expenseForm(trip,
      scoped(TABLE.expenses,trip.id).find(x=>x.id===id));
    if(action==="expense-delete")return void deleteRecord(TABLE.expenses,trip,id);
    if(action==="plan-new")return itineraryForm(trip);
    if(action==="plan-edit")return itineraryForm(trip,
      scoped(TABLE.plan,trip.id).find(x=>x.id===id));
    if(action==="plan-delete")return void deleteRecord(TABLE.plan,trip,id);
    if(action==="category-edit")return editCategories(trip);
    if(action==="expense-csv")return exportCSV(trip);
    if(action==="report-print")return printReport(trip);
    if(action==="report-json")return download(
      JSON.stringify(report(trip),null,2),"voyafundra-trip-report-"+trip.id+".json");
  });
  document.getElementById("modalBody")?.addEventListener("click",event=>{
    const button=event.target.closest("[data-vf2-action]");
    if(!button)return;
    event.preventDefault();
    const action=button.dataset.vf2Action;
    if(action==="draft-compare")return void compareDraft(Number(button.dataset.vf2Id));
    if(action==="draft-discard"){
      const x=state.drafts[Number(button.dataset.vf2Id)];
      if(!x)return;
      if(!window.confirm("Discard this one unsaved draft without writing to the cloud?"))return;
      try{journal().forget(x.userId,x.table,x.id,x.token);
        state.drafts=journal().list(state.account);reviewDrafts();}
      catch(e){notify(errorText(e));}
    }
    if(action==="draft-keep-cloud"||action==="draft-retry"){
      void applyDraftChoice(action==="draft-keep-cloud"?"cloud":"local");
    }
  });
  window.voyafundraV2={
    status,reset,load,enhanceTrip,enhanceList,
    showDrafts:()=>{if(state.drafts.length)reviewDrafts();},
    exportRows:()=>({expenses:state.expenses.slice(),plan_items:state.plans.slice()}),
    reload:async()=>{if(state.account){await load(state.account);refreshView();}},
    expenseSummary:tripId=>core().expenseSummary(scoped(TABLE.expenses,tripId),
      trips.find(x=>x.id===tripId)?.budget||0),
    report,
  };
})();
