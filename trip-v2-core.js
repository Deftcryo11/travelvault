"use strict";

/* Voyafundra 2: tested, dependency-free finance and itinerary rules.
   Amounts shown in MVR; USD values retain the exact bank rate used. */
(() => {
  const CATEGORIES = Object.freeze(["Flights","Accommodation","Food",
    "Local Transport","Activities","Shopping","Other"]);
  const KINDS = Object.freeze(["flight","hotel","transport","activity","meal","custom"]);
  const STATUSES = Object.freeze(["idea","pending","confirmed","cancelled"]);
  const dateRE = /^\d{4}-\d{2}-\d{2}$/;
  const timeRE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const str = (v,limit = 250) => {
    const x = String(v ?? "").trim();
    if (x.length > limit) throw new Error("A text field is too long.");
    return x;
  };
  const positive = (v,maximum = 1e9) => {
    if (v === null || v === undefined || String(v).trim() === "") {
      throw new Error("Enter a valid amount.");
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > maximum)
      throw new Error("Amount must be a non-negative number.");
    return round(n);
  };
  const dateValid = (v) => {
    if (!dateRE.test(String(v ?? ""))) return false;
    const [year,month,day] = v.split("-").map(Number);
    const stamp = new Date(Date.UTC(year,month-1,day));
    return year >= 1900 && year <= 9999 && stamp.getUTCFullYear()===year &&
      stamp.getUTCMonth()===month-1 && stamp.getUTCDate()===day;
  };
  function expenseInput(form) {
    const expense_date = str(form.expense_date,10);
    if (!dateValid(expense_date)) throw new Error("Choose a valid expense date.");
    const category = str(form.category,70);
    if (!category) throw new Error("Choose an expense category.");
    const description = str(form.description,250);
    if (!description) throw new Error("Enter an expense description.");
    const currency = str(form.currency,3);
    if (!["MVR","USD"].includes(currency)) throw new Error("Unsupported currency.");
    const original_amount = positive(form.original_amount);
    const submittedRate = currency==="MVR" ? 1 : Number(form.exchange_rate);
    if (!Number.isFinite(submittedRate) || submittedRate<=0 || submittedRate>1e6)
      throw new Error("Enter a positive bank exchange rate for USD.");
    // Supabase stores the rate with six decimal places. Calculate MVR from
    // that same rounded snapshot, so JSON exports can be validated reliably.
    const exchange_rate = Math.round(submittedRate * 1e6) / 1e6;
    if (exchange_rate <= 0) throw new Error("Exchange rate is too small.");
    const amount_mvr = round(original_amount * exchange_rate);
    if (amount_mvr > 1e9) throw new Error("Converted expense is too large.");
    const entry_type = str(form.entry_type,10);
    if (!["expense","refund"].includes(entry_type)) throw new Error("Choose a payment type.");
    const payment_status = str(form.payment_status,10);
    if (!["paid","planned"].includes(payment_status)) throw new Error("Choose payment status.");
    if (entry_type === "refund" && payment_status !== "paid") {
      throw new Error("Refunds must be recorded as completed.");
    }
    const booking_id = str(form.booking_id,150) || null;
    return {
      expense_date, category, description, original_amount, currency,
      exchange_rate: currency==="MVR"?1:exchange_rate, amount_mvr,
      entry_type, payment_status, booking_id, notes:str(form.notes,2000)
    };
  }
  function itineraryInput(form) {
    const kind = str(form.kind,15);
    const booking_status = str(form.booking_status,15);
    const title = str(form.title,250);
    const start_date = str(form.start_date,10);
    const end_date = str(form.end_date,10);
    if (!KINDS.includes(kind)) throw new Error("Unsupported itinerary type.");
    if (!STATUSES.includes(booking_status)) throw new Error("Invalid booking status.");
    if (!title) throw new Error("Enter an itinerary title.");
    if (!dateValid(start_date)) throw new Error("Choose a valid itinerary date.");
    if (end_date && (!dateValid(end_date) || end_date < start_date)) {
      throw new Error("End date cannot be before start date.");
    }
    const start_time = str(form.start_time,5) || null;
    const end_time = str(form.end_time,5) || null;
    if ((start_time && !timeRE.test(start_time)) ||
        (end_time && !timeRE.test(end_time))) {
      throw new Error("Use a valid 24-hour time.");
    }
    if (end_date && end_date === start_date && start_time && end_time &&
        end_time < start_time) {
      throw new Error("End time cannot be before start time.");
    }
    return {
      kind,title,start_date,start_time,end_date:end_date||null,end_time,
      time_zone:str(form.time_zone,80),location:str(form.location,250),
      provider:str(form.provider,160),
      booking_reference:str(form.booking_reference,160),booking_status,
      committed_mvr:positive(form.committed_mvr || 0),
      notes:str(form.notes,2000)
    };
  }
  const savedAmount = (person,row,field) => {
    const entry = row?.contributions?.[person.id];
    const legacy = field==="saved" ?
      (person.id==="legacy-a"?"savedA":"savedB") :
      (person.id==="legacy-a"?"planA":"planB");
    const v = entry ? entry[field] : row?.[legacy];
    const n = Number(v || 0);
    return Number.isFinite(n) && n>0?n:0;
  };
  function saverForecast(trip,currentDate) {
    const people=Array.isArray(trip?.people)&&trip.people.length?
      trip.people:[
        {id:"legacy-a",name:trip?.personA||"Saver A",monthlyTarget:0},
        {id:"legacy-b",name:trip?.personB||"Saver B",monthlyTarget:0}
      ];
    const savedRows=Array.isArray(trip?.savings)?trip.savings:[];
    const target=Number(trip?.budget)||0;
    const allSaved=people.reduce((total,p)=>total+
      savedRows.reduce((sum,r)=>sum+savedAmount(p,r,"saved"),0),0);
    const now=currentDate||localDate();
    const due=trip?.departure;
    const start = dateValid(now)?now.slice(0,7):null;
    const finish=dateValid(due)?due.slice(0,7):null;
    const months=start&&finish&&due>now?
      Math.max(1,(Number(finish.slice(0,4))-Number(start.slice(0,4)))*12+
        Number(finish.slice(5))-Number(start.slice(5))+1):0;
    const remaining=Math.max(0,target-allSaved);
    return {
      totalSaved:round(allSaved),remaining:round(remaining),months,
      requiredMonthly: months ? round(remaining/months) : null,
      people:people.map(p=>{
        const saved=round(savedRows.reduce((sum,r)=>sum+savedAmount(p,r,"saved"),0));
        const planned=round(savedRows.reduce((sum,r)=>sum+savedAmount(p,r,"planned"),0));
        const monthlyTarget=round(Math.max(0,Number(p.monthlyTarget)||0));
        return {id:p.id,name:p.name,saved,planned,monthlyTarget,
          projectedAdditional:round(monthlyTarget*months)};
      })
    };
  }
  function localDate(date = new Date()) {
    const pad = n=>String(n).padStart(2,"0");
    return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate());
  }
  // USD is purchased *from* already-recorded MVR savings. Every exchange
  // retains its own historical rate. Purchasing USD is neither new saving
  // nor a trip expense, so the goal progress must not count it twice.
  function usdPurchaseInput(form) {
    const purchaseDate = str(form.purchaseDate,10);
    if (!dateValid(purchaseDate)) throw Error("Choose a valid USD purchase date.");
    const personId = str(form.personId,150);
    if (!personId || !/^[a-zA-Z0-9_.-]{1,150}$/.test(personId))
      throw Error("Choose the saver who purchased USD.");
    const note = str(form.note,250);
    const amount = Number(form.usdAmount);
    if (!Number.isFinite(amount) || amount<=0 || amount>1e7 ||
        String(form.usdAmount??"").trim()==="")
      throw Error("Enter a positive USD amount.");
    const usdAmount = round(amount);
    if (usdAmount<=0 || Math.abs(amount-usdAmount)>0.0000001)
      throw Error("USD amount must have no more than two decimal places.");
    const bankRate=Number(form.mvrPerUsd);
    if(!Number.isFinite(bankRate)||bankRate<=0||bankRate>1e6||
       String(form.mvrPerUsd??"").trim()==="")
      throw Error("Enter a positive bank rate in MVR per USD.");
    const mvrPerUsd=Math.round(bankRate*1e6)/1e6;
    if(mvrPerUsd<=0)throw Error("Bank rate is too small.");
    const mvrCost=round(usdAmount*mvrPerUsd);
    if (mvrCost<=0||mvrCost>1e9)
      throw Error("The MVR cost must be positive and within limits.");
    return {purchaseDate,personId,usdAmount,mvrPerUsd,mvrCost,note};
  }

  function usdSavingsWallet(trip) {
    const savings=saverForecast(trip);
    const purchases=Array.isArray(trip?.usdPurchases)?trip.usdPurchases:[];
    const people=new Map(savings.people.map(p=>[p.id,{
      id:p.id,name:p.name,savedMvr:round(p.saved),
      mvrConvertedCents:0,usdCents:0
    }]));
    let convertedCents=0,usdCents=0;
    for (const purchase of purchases) {
      if (!people.has(purchase.personId)) {
        throw Error("A USD purchase refers to a missing saver. Restore that saver before editing.");
      }
      const usd=Math.round(Number(purchase.usdAmount)*100);
      const spent=Math.round(Number(purchase.mvrCost)*100);
      if(!Number.isSafeInteger(usd)||usd<=0||!Number.isSafeInteger(spent)||spent<=0)
        throw Error("A USD purchase has invalid saved amounts.");
      const person=people.get(purchase.personId);
      person.usdCents+=usd;
      person.mvrConvertedCents+=spent;
      convertedCents+=spent;usdCents+=usd;
    }
    return {
      contributedMvr:round(savings.totalSaved),
      mvrConverted:round(convertedCents/100),
      mvrAvailable:round(savings.totalSaved-convertedCents/100),
      usdHeld:round(usdCents/100),
      effectiveRate:usdCents?round(convertedCents/usdCents):null,
      purchases:purchases.length,
      people:[...people.values()].map(p=>({
        id:p.id,name:p.name,savedMvr:p.savedMvr,
        mvrConverted:round(p.mvrConvertedCents/100),
        mvrAvailable:round(p.savedMvr-p.mvrConvertedCents/100),
        usdHeld:round(p.usdCents/100),
      }))
    };
  }

  function ensureUsdSavingsCovered(trip) {
    const wallet=usdSavingsWallet(trip);
    const overdrawn=wallet.people.find(p=>p.mvrAvailable < -0.001);
    if(overdrawn)throw Error(
      overdrawn.name+" has bought more USD than their recorded MVR savings cover. "+
      "Increase their saved MVR or edit their USD purchases first."
    );
    return wallet;
  }

  function expenseSummary(expenses,budget) {
    const rows=Array.isArray(expenses)?expenses:[];
    let spentCents=0, plannedCents=0, refundsCents=0;
    const categories=new Map();
    for (const row of rows) {
      const cents=Math.round(Number(row.amount_mvr||0)*100);
      if (!Number.isSafeInteger(cents) || cents<0) continue;
      const refund=row.entry_type==="refund";
      if (row.payment_status==="planned") { plannedCents+=cents;continue; }
      const effect=refund?-cents:cents;
      spentCents+=effect;
      if(refund) refundsCents+=cents;
      categories.set(row.category,(categories.get(row.category)||0)+effect);
    }
    const cap = Math.max(0, Number(budget)||0);
    return {
      spent:round(spentCents/100),
      planned:round(plannedCents/100),
      refunds:round(refundsCents/100),
      remaining:round(cap-spentCents/100),
      overspent:spentCents/100>cap,
      categories:[...categories.entries()].map(([category,cents])=>({
        category,actual:round(cents/100)
      })).sort((a,b)=>b.actual-a.actual)
    };
  }
  function categoryBudgets(trip,expenses) {
    const configured=trip?.budgetCategories && typeof trip.budgetCategories==="object" &&
      !Array.isArray(trip.budgetCategories) ? trip.budgetCategories : {};
    const summary=expenseSummary(expenses,trip?.budget);
    const cat=new Map(summary.categories.map(x=>[x.category,x.actual]));
    return Object.entries(configured).filter(([name,value])=>
      name && Number.isFinite(Number(value)) && Number(value)>=0)
      .map(([category,estimate])=>({
        category,estimate:round(Number(estimate)),actual:cat.get(category)||0,
        variance:round(Number(estimate)-(cat.get(category)||0))
      }));
  }
  function groupItinerary(items) {
    const rows=(Array.isArray(items)?items:[]).slice().sort((a,b)=>
      String(a.start_date).localeCompare(String(b.start_date))||
      String(a.start_time||"").localeCompare(String(b.start_time||""))||
      String(a.title).localeCompare(String(b.title)));
    const groups=[];
    for(const row of rows) {
      if(groups.at(-1)?.date!==row.start_date)groups.push({date:row.start_date,items:[]});
      groups.at(-1).items.push(row);
    }
    return groups;
  }
  function checklistUpcoming(trip,currentDate=localDate()){
    return (Array.isArray(trip?.checklist)?trip.checklist:[])
      .filter(t=>!t.done)
      .slice().sort((a,b)=>
        String(a.dueDate||"9999").localeCompare(String(b.dueDate||"9999")))
      .map(t=>({...t,overdue:!!(t.dueDate && dateValid(t.dueDate)&&t.dueDate<currentDate)}));
  }
  function csvSafe(value) {
    let valueText=String(value??"");
    if(/^[\s]*[=+@-]/.test(valueText))valueText="'"+valueText;
    return '"'+valueText.replace(/"/g,'""')+'"';
  }
  window.voyafundraV2Core={
    CATEGORIES,KINDS,STATUSES,expenseInput,itineraryInput,
    saverForecast,usdPurchaseInput,usdSavingsWallet,ensureUsdSavingsCovered,
    expenseSummary,categoryBudgets,groupItinerary,
    checklistUpcoming,dateValid,localDate,csvSafe,round
  };
})();
