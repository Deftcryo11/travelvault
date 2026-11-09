"use strict";

/* Trip detail panels / checklist actions. Records live in the existing
 * per-trip JSON column and go through the same revision-guarded cloud save. */
(() => {
  const insights = () => window.voyafundraInsights;
  const h = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const mvr = (value) => "MVR " + Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  function cardCountdown(trip) {
    if (!trip?.departure || trip.status === "Completed") return "";
    const result = insights().countdown(trip.departure);
    if (result.phase === "unset") return "";
    return '<div class="trip-countdown' +
      (result.phase === "past" ? " is-past" : "") + '">' +
      '◷ ' + h(result.label) + '</div>';
  }

  function renderInsights(trip) {
    const math = insights();
    const forecast = math.savingsForecast(trip);
    const countdown = math.countdown(trip.departure);
    const cheapest = math.cheapestTravelOption(trip);
    const monthsLabel = forecast.remainingMonths === 1 ?
      "1 calendar month remaining" :
      forecast.remainingMonths + " calendar months remaining";
    let suggestion;
    if (forecast.remaining === 0) {
      suggestion = "Your recorded savings have reached the target.";
    } else if (forecast.monthlyNeeded === null) {
      suggestion = "Set a future departure date to calculate your required monthly savings.";
    } else if (forecast.onTrack) {
      suggestion = "Your planned monthly target covers the required monthly amount. " +
        "Actual contributions may still differ.";
    } else {
      suggestion = "Your planned monthly target is below the amount needed. " +
        "Consider adjusting contributions or your budget.";
    }

    const history = forecast.history.slice(-8);
    const historyHTML = history.length
      ? '<div class="savings-bars" aria-label="Planned and saved by month">' +
        history.map((row) => {
          const width = row.planned > 0 ?
            Math.min(100, row.saved / row.planned * 100) :
            (row.saved > 0 ? 100 : 0);
          const over = row.planned > 0 && row.saved >= row.planned;
          return '<div class="savings-bar-row">' +
            '<strong>' + h(row.month) + '</strong>' +
            '<div class="savings-track" role="img" aria-label="' +
            h(row.month + ": " + mvr(row.saved) + " saved against " +
              mvr(row.planned) + " planned") + '">' +
            '<div class="savings-fill' + (over ? ' is-over' : '') +
            '" style="width:' + width.toFixed(2) + '%"></div></div>' +
            '<small>' + h(mvr(row.saved)) + ' / ' + h(mvr(row.planned)) + '</small>' +
            '</div>';
        }).join("") + '</div>'
      : '<p class="insight-comment">Add savings entries to see month-by-month progress.</p>';
    const cheapestHTML = cheapest
      ? '<hr class="insight-separator">' +
        '<h3 class="insight-subheading">Lowest estimated travel option: ' +
        h(cheapest.name) + '</h3>' +
        '<div class="travel-breakdown">' +
        [
          ["Tickets", cheapest.ticket],
          ["Bank USD × exchange rate", cheapest.exchange],
          ["Accommodation", cheapest.stay],
          ["Extras", cheapest.extras],
        ].map(([name,value])=> '<div><strong>' + h(mvr(value)) +
            '</strong><small>' + h(name) + '</small></div>').join("") + '</div>' +
        '<p class="insight-comment' + (cheapest.overBudget ? ' overspent' : '') +
        '">Estimated option total: <strong>' + h(mvr(cheapest.total)) +
        '</strong> · ' + (cheapest.overBudget ? 'Over your trip budget by ' :
          'Trip budget remaining after this option: ') +
        '<strong>' + h(mvr(Math.abs(cheapest.budgetLeft))) +
        '</strong>. These are alternative travel estimates, not recorded spending.</p>'
      : '<p class="insight-comment">Add a flight/travel option to compare ' +
        'ticket, exchange, accommodation, and other estimated costs.</p>';

    return '<section class="panel insights-panel" aria-labelledby="tripInsightsHeading">' +
      '<div class="panel-head"><div>' +
      '<h2 id="tripInsightsHeading">Budget &amp; savings insights</h2>' +
      '<p>Estimated savings needed before departure</p></div></div>' +
      '<div class="trip-countdown' + (countdown.phase === "past" ? ' is-past' : '') +
      '" role="status">' + h(countdown.label) + '</div>' +
      '<div class="insights-grid">' +
      '<div class="insight-metric"><div class="insight-label">Still to save</div>' +
      '<strong>' + h(mvr(forecast.remaining)) + '</strong>' +
      '<small>Target minus recorded savings</small></div>' +
      '<div class="insight-metric"><div class="insight-label">Needed per month</div>' +
      '<strong>' + (forecast.monthlyNeeded === null ? '—' :
        h(mvr(forecast.monthlyNeeded))) + '</strong>' +
      '<small>' + (forecast.monthlyNeeded === null ?
        'Departure date required' : h(monthsLabel)) + '</small></div>' +
      '<div class="insight-metric"><div class="insight-label">Your monthly target</div>' +
      '<strong>' + h(mvr(forecast.monthlyTarget)) + '</strong>' +
      '<small>Combined target across savers</small></div></div>' +
      '<p class="insight-comment">' + h(suggestion) + '</p>' +
      '<hr class="insight-separator">' +
      '<h3 class="insight-subheading">Monthly planned vs. saved</h3>' +
      historyHTML + cheapestHTML + '</section>';
  }

  function renderChecklist(trip) {
    const list = Array.isArray(trip.checklist) ? trip.checklist : [];
    const summary = insights().checklistSummary(trip);
    const today = window.voyafundraV2Core?.localDate?.() || "";
    const prioritized = list.slice().sort((a,b) =>
      Number(!!a.done)-Number(!!b.done) ||
      String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31")) ||
      ({High:0,Normal:1,Low:2}[a.priority] ?? 1) -
      ({High:0,Normal:1,Low:2}[b.priority] ?? 1));
    const actions = '<div class="checklist-actions">' +
      '<button type="button" class="btn btn-primary btn-small" data-action="checklist-add">' +
      '+ Add task</button>' +
      (!list.length ? '<button type="button" class="btn btn-outline btn-small" ' +
        'data-action="checklist-starter">Add starter checklist</button>' : '') +
      '</div>';
    const items = !list.length
      ? '<p class="checklist-empty">Keep your bookings and preparations in one place. ' +
        'Start with suggested tasks or add your own.</p>'
      : '<ul class="checklist-list">' +
        prioritized.map((item) => '<li class="checklist-item' +
          (item.done ? ' is-done' : '') +
          (!item.done && item.dueDate && item.dueDate < today ? ' vf2-overdue' : '') + '">' +
          '<button type="button" class="checklist-toggle" data-action="checklist-toggle" ' +
          'data-id="' + h(item.id) + '" aria-label="' +
          h((item.done ? 'Mark incomplete: ' : 'Mark complete: ') + item.title) +
          '" aria-pressed="' + (item.done ? 'true' : 'false') + '">' +
          (item.done ? '✓' : '') + '</button>' +
          '<div class="checklist-task-copy"><strong>' + h(item.title) + '</strong>' +
          '<small>' + h(item.category || 'Preparation') + ' · ' +
          h(item.priority || 'Normal') + ' priority</small>' +
          (item.dueDate ? '<small>' +
            (!item.done && item.dueDate < today ? 'Overdue: ' : 'Due: ') +
            h(item.dueDate) + '</small>' : '') +
          '</div><div class="inline-actions">' +
          '<button type="button" class="btn-link" data-action="checklist-edit" data-id="' +
          h(item.id) + '">Edit</button>' +
          '<button type="button" class="btn-link negative" ' +
          'data-action="checklist-delete" data-id="' + h(item.id) +
          '" aria-label="Delete ' + h(item.title) + '">Delete</button>' +
          '</div></li>').join("") + '</ul>';

    return '<section class="panel trip-checklist-panel" aria-labelledby="checklistHeading">' +
      '<div class="panel-head"><div><h2 id="checklistHeading">Travel checklist</h2>' +
      '<p>' + summary.done + ' of ' + summary.total + ' tasks completed</p></div></div>' +
      '<div class="progress" role="progressbar" aria-label="Checklist progress" ' +
      'aria-valuenow="' + summary.percent +
      '" aria-valuemin="0" aria-valuemax="100"><div style="width:' +
      summary.percent + '%"></div></div>' +
      '<p class="checklist-summary">Each trip keeps its own tasks and optional due dates.</p>' +
      items + '<div style="margin-top:14px">' + actions + '</div></section>';
  }

  function handleChecklistAction(action, trip, itemId, app) {
    if (!trip) return false;
    const tasks = Array.isArray(trip.checklist) ? trip.checklist : [];
    const save = () => {
      app.saveTrips(trip.id);
      app.notify("Checklist change queued — check cloud save status.");
      app.render();
    };

    if (action === "checklist-starter") {
      if (tasks.length) return true;
      trip.checklist = insights().STARTER_CHECKLIST.map((title) => ({
        id: app.generateId(), title, dueDate: "", done: false,
        category: title.toLowerCase().includes("passport") ||
          title.toLowerCase().includes("visa") ? "Documents" :
          title.toLowerCase().includes("packing") ? "Packing" : "Bookings",
        priority: "Normal",
      }));
      save();
      return true;
    }

    if (action === "checklist-toggle") {
      const item = tasks.find((x) => x.id === itemId);
      if (!item) return true;
      item.done = !item.done;
      save();
      return true;
    }

    if (action === "checklist-delete") {
      const item = tasks.find((x) => x.id === itemId);
      if (!item) return true;
      app.confirmRemove('Delete checklist task "' + item.title + '"?', () => {
        trip.checklist = tasks.filter((x) => x.id !== itemId);
      }, trip.id);
      return true;
    }

    if (action === "checklist-add" || action === "checklist-edit") {
      const existing = action === "checklist-edit"
        ? tasks.find((x) => x.id === itemId) : null;
      if (action === "checklist-edit" && !existing) return true;
      const body = app.field("taskTitle", "Task", existing?.title || "",
        "text", { required: true, placeholder: "e.g. Confirm hotel booking" }) +
        app.field("taskDue", "Due date (optional)", existing?.dueDate || "", "date") +
        app.selectField("taskCategory", "Category", existing?.category || "Preparation",
          ["Preparation","Documents","Bookings","Transport","Packing","Health","Other"]) +
        app.selectField("taskPriority", "Priority", existing?.priority || "Normal",
          ["Low","Normal","High"]);
      app.showModal(existing ? "Edit checklist task" : "New checklist task",
        body, (form) => {
          const title = (form.taskTitle || "").trim();
          if (!title || title.length > 160) {
            app.notify("Enter a task name of up to 160 characters.");
            return false;
          }
          if (form.taskDue && !insights().dateUTC(form.taskDue)) {
            app.notify("Choose a valid due date.");
            return false;
          }
          if (!Array.isArray(trip.checklist)) trip.checklist = [];
          if (existing) {
            existing.title = title;
            existing.dueDate = form.taskDue || "";
            existing.category = form.taskCategory;
            existing.priority = form.taskPriority;
          } else {
            if (trip.checklist.length >= 100) {
              app.notify("Maximum 100 checklist tasks per trip.");
              return false;
            }
            trip.checklist.push({
              id: app.generateId(), title, dueDate: form.taskDue || "", done: false,
              category: form.taskCategory, priority: form.taskPriority,
            });
          }
          app.saveTrips(trip.id);
          app.notify("Checklist saved locally — cloud confirmation pending.");
          return true;
        });
      return true;
    }
    return false;
  }

  window.voyafundraFeatures = {
    cardCountdown, renderInsights, renderChecklist, handleChecklistAction,
  };
})();
