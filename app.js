"use strict";

/* ==========================================
   TRAVELVAULT - APPLICATION CONFIGURATION
========================================== */

const STORAGE_KEY = "travelvault.trips.v1";
const THEME_KEY = "travelvault-theme";

const $ = (selector) => document.querySelector(selector);

/* ==========================================
   APPLICATION STATE
========================================== */

// Trips are loaded from Supabase after login.
let trips = [];

let selectedTripId = null;
let currentView = "all";
let toastTimer = null;

// Cloud connection state.
let cloudUserId = null;
let cloudReady = false;

// Used to invalidate operations after account changes.
let cloudEpoch = 0;

// Ensures cloud writes execute in order.
let cloudWriteQueue = Promise.resolve();
// Guard against refreshing or closing with pending/failed saves.
let cloudWritesPending = 0;
let cloudSaveError = null;

/* ==========================================
   GENERAL HELPERS
========================================== */

function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value, currency = "MVR") {
  return `${currency} ${num(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function money(value) {
  return formatCurrency(value, "MVR");
}

function usd(value) {
  return formatCurrency(value, "USD");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });
}

function generateId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function today() {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function defaultStartMonth() {
  return today().slice(0, 7);
}

function nextMonth(start, index) {
  const [year, month] = start.split("-").map(Number);

  const date = new Date(Date.UTC(year, month - 1 + index, 1));

  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function niceDate(value) {
  if (!value) return "Date not set";

  const date = new Date(`${value}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/* ==========================================
   SUPABASE CLOUD STORAGE
========================================== */

/**
 * Return the currently selected trip.
 */
function getSelectedTrip() {
  return trips.find((trip) => trip.id === selectedTripId);
}

/**
 * Load a user's trips from Supabase.
 *
 * Important:
 * This function never reads old LocalStorage trips.
 */
async function loadCloudTrips(user) {
  const epoch = ++cloudEpoch;

  cloudUserId = user.id;
  cloudReady = false;
  window.voyafundraUX?.setStatus("loading", "Loading your trips...");

  // Immediately clear data from any previous account.
  trips = [];
  selectedTripId = null;
  currentView = "all";

  render();

  const { data, error } = await supabaseClient
    .from("trips")
    .select("id, trip_data")
    .eq("user_id", user.id)
    .order("created_at", {
      ascending: false,
    });

  // An account change occurred during loading.
  if (epoch !== cloudEpoch) {
    return false;
  }

  if (error) {
    throw new Error(`Could not load trips: ${error.message}`);
  }

  trips = (data || [])
    .filter((row) => row.trip_data && typeof row.trip_data === "object")
    .map((row) => ({
      ...row.trip_data,
      id: row.id,
    }));

  cloudReady = true;
  cloudSaveError = null;
  window.voyafundraUX?.setStatus("saved", "Trips up to date");

  render();

  return true;
}

/**
 * Clear all trip information from application memory.
 *
 * This is called when the user signs out.
 * It does not delete anything from Supabase.
 */
function clearCloudTrips() {
  cloudEpoch++;

  cloudUserId = null;
  cloudReady = false;
  cloudSaveError = null;
  window.voyafundraUX?.setStatus("loading", "Sign in to sync trips");

  trips = [];
  selectedTripId = null;
  currentView = "all";

  render();
}

/**
 * Save the complete current trip collection.
 *
 * Saves are queued to prevent an older save from
 * finishing after a newer one.
 *
 * Each trip is stored as an individual database row.
 */
function saveTrips() {
  if (!cloudReady || !cloudUserId) {
    notify("Sign in before saving changes.");
    return false;
  }

  const userId = cloudUserId;
  const epoch = cloudEpoch;

  // Capture an independent copy at save time.
  const snapshot = JSON.parse(JSON.stringify(trips));
  cloudWritesPending += 1;
  window.voyafundraUX?.setStatus("saving", "Saving trips...");

  cloudWriteQueue = cloudWriteQueue
    .catch(() => {
      // A previous failed save must not block
      // subsequent attempts.
    })
    .then(async () => {
      if (epoch !== cloudEpoch || userId !== cloudUserId) {
        return;
      }

      // Read existing database trip IDs.
      const { data: existing, error: readError } = await supabaseClient
        .from("trips")
        .select("id")
        .eq("user_id", userId);

      if (readError) {
        throw readError;
      }

      if (epoch !== cloudEpoch || userId !== cloudUserId) {
        return;
      }

      // Create or update current trips.
      if (snapshot.length > 0) {
        const rows = snapshot.map((trip) => ({
          id: trip.id,
          user_id: userId,
          trip_data: trip,
          updated_at: new Date().toISOString(),
        }));

        const { error: writeError } = await supabaseClient
          .from("trips")
          .upsert(rows, {
            onConflict: "user_id,id",
          });

        if (writeError) {
          throw writeError;
        }
      }

      if (epoch !== cloudEpoch || userId !== cloudUserId) {
        return;
      }

      // Remove trips deleted from the dashboard.
      const currentIds = new Set(snapshot.map((trip) => trip.id));

      const deletedIds = (existing || [])
        .map((row) => row.id)
        .filter((id) => !currentIds.has(id));

      if (deletedIds.length > 0) {
        const { error: deleteError } = await supabaseClient
          .from("trips")
          .delete()
          .eq("user_id", userId)
          .in("id", deletedIds);

        if (deleteError) {
          throw deleteError;
        }
      }

      // Only report success for the current account.
      if (epoch === cloudEpoch && userId === cloudUserId) {
        cloudSaveError = null;
        window.voyafundraUX?.setStatus("saved", "All changes saved");
        console.log("Voyafundra: Trips synchronized with Supabase.");
      }
    });

  // Report cloud failures instead of treating them
  // as successful saves.
  cloudWriteQueue.catch((error) => {
    if (epoch === cloudEpoch && userId === cloudUserId) {
      cloudSaveError = error;
      console.error("Voyafundra cloud save failed:", error);
      window.voyafundraUX?.setStatus("error", "Save failed — changes not confirmed");
      notify(
        "Cloud save failed. Keep this tab open and retry saving before refreshing.",
      );
    }
  }).finally(() => {
    cloudWritesPending = Math.max(0, cloudWritesPending - 1);
    // A newer save can still be running; do not hide its pending state.
    if (epoch === cloudEpoch && userId === cloudUserId &&
        cloudWritesPending === 0 && !cloudSaveError) {
      window.voyafundraUX?.setStatus("saved", "All changes saved");
    }
  });

  return true;
}

/**
 * Wait for pending cloud saves.
 */
async function waitForCloudSaves() {
  await cloudWriteQueue;
}

/* ==========================================
   NOTIFICATIONS
========================================== */

function notify(message) {
  const toast = $("#toast");

  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4000);
}

/* ==========================================
   SAVINGS CALCULATIONS
========================================== */

function getPeople(trip) {
  if (Array.isArray(trip.people) && trip.people.length) {
    return trip.people;
  }

  // Support older trips with W and H columns.
  return [
    {
      id: "legacy-a",
      name: trip.personA || "W",
      monthlyTarget: 0,
    },
    {
      id: "legacy-b",
      name: trip.personB || "H",
      monthlyTarget: 0,
    },
  ];
}

function getContribution(row, person, type) {
  const contribution = row.contributions?.[person.id];

  if (contribution) {
    return num(contribution[type]);
  }

  // Support savings recorded in older versions.
  if (person.id === "legacy-a") {
    return num(row[type === "planned" ? "planA" : "savedA"]);
  }

  if (person.id === "legacy-b") {
    return num(row[type === "planned" ? "planB" : "savedB"]);
  }

  return 0;
}

function totalContributions(trip, type) {
  const people = getPeople(trip);

  return (trip.savings || []).reduce((total, row) => {
    const rowTotal = people.reduce(
      (sum, person) => sum + getContribution(row, person, type),
      0,
    );

    return total + rowTotal;
  }, 0);
}

function totalSaved(trip) {
  return totalContributions(trip, "saved");
}

function totalPlanned(trip) {
  return totalContributions(trip, "planned");
}

function monthlyTarget(trip) {
  return getPeople(trip).reduce(
    (total, person) => total + num(person.monthlyTarget),
    0,
  );
}

function savingsProgress(trip) {
  const budget = num(trip.budget);

  if (budget <= 0) return 0;

  return Math.max(0, Math.min(100, (totalSaved(trip) / budget) * 100));
}

/* ==========================================
   TRAVEL COST CALCULATIONS
========================================== */

function travelCost(option) {
  const ticket = num(option.ticket);
  const dollars = num(option.dollars);
  const rate = num(option.rate);
  const stay = num(option.stay);
  const other = num(option.other);

  return ticket + dollars * rate + stay + other;
}

function getStatusClass(trip) {
  if (trip.status === "Completed") return "completed";
  if (trip.status === "Upcoming") return "upcoming";

  return "";
}

/* ==========================================
   REUSABLE HTML COMPONENTS
========================================== */

function statCard(label, value, note, className = "") {
  return `
    <div class="stat">
      <div class="stat-label">${label}</div>

      <div class="stat-value ${className}">
        ${value}
      </div>

      <div class="stat-note">${note}</div>
    </div>
  `;
}

function progressBar(percent) {
  return `
    <div class="progress">
      <div style="width: ${percent}%"></div>
    </div>
  `;
}

function tripCard(trip) {
  const progress = savingsProgress(trip);

  return `
    <article
      class="trip-card"
      data-action="open"
      data-id="${escapeHTML(trip.id)}"
      tabindex="0"
      role="button"
      aria-label="Open ${escapeHTML(trip.name)}"
    >
      <div class="trip-heading">
        <div class="trip-name">
          ${escapeHTML(trip.name)}
        </div>

        <span class="badge ${getStatusClass(trip)}">
          ${escapeHTML(trip.status)}
        </span>
      </div>

      <div class="trip-destination">
        ${escapeHTML(trip.destination)}
      </div>

      <div class="trip-date">
        ◷ ${niceDate(trip.departure)}
        —
        ${niceDate(trip.returnDate)}
      </div>

      <div class="card-bottom">
        <div>
          <span>Budget</span>
          <strong>${money(trip.budget)}</strong>
        </div>

        <div class="number">
          <span>Saved</span>
          <strong class="teal">
            ${money(totalSaved(trip))}
          </strong>
        </div>
      </div>

      ${progressBar(progress)}

      <div class="progress-caption">
        ${progress.toFixed(1)}% of savings goal
      </div>
    </article>
  `;
}

/* ==========================================
   NAVIGATION & PAGE RENDERING
========================================== */

function updateNavigation() {
  $("#allTripsNav").classList.toggle("active", currentView === "all");

  $("#historyNav").classList.toggle("active", currentView === "history");
}

function render() {
  updateNavigation();

  if (selectedTripId && getSelectedTrip()) {
    renderTripDetails();
    return;
  }

  selectedTripId = null;
  renderTripList();
}

/* ==========================================
   MY TRIPS & COMPLETED TRIPS
========================================== */

function renderTripList() {
  const isHistory = currentView === "history";

  const visibleTrips = trips.filter((trip) => {
    return isHistory
      ? trip.status === "Completed"
      : trip.status !== "Completed";
  });

  const totalBudget = visibleTrips.reduce(
    (total, trip) => total + num(trip.budget),
    0,
  );

  const totalSavings = visibleTrips.reduce(
    (total, trip) => total + totalSaved(trip),
    0,
  );

  const completedCount = trips.filter(
    (trip) => trip.status === "Completed",
  ).length;

  $("#pageTitle").textContent = isHistory ? "Trip history" : "My trips";

  $("#pageSubtitle").textContent = isHistory
    ? "Look back on every completed adventure."
    : "Plan smarter. Save confidently. Remember every trip.";

  let html = `
    <div class="stats">
      ${statCard("Total trips", visibleTrips.length, "Trips in this view")}

      ${statCard(
        "Combined budgets",
        money(totalBudget),
        "Across displayed trips",
      )}

      ${statCard(
        "Total savings recorded",
        money(totalSavings),
        "All savings entries",
        "teal",
      )}

      ${statCard(
        "Completed trips",
        completedCount,
        "Preserved in your history",
      )}
    </div>

    <div class="section-head">
      <h2>
        ${isHistory ? "Past adventures" : "Your travel plans"}
      </h2>

      <span class="subtle">
        ${visibleTrips.length}
        ${visibleTrips.length === 1 ? "trip" : "trips"}
      </span>
    </div>
  `;

  if (visibleTrips.length === 0) {
    html += isHistory
      ? `
        <div class="empty completed-empty">
          <div class="emoji">🗃️</div>

          <h2>No trips currently completed</h2>

          <p>
            Once a trip is marked as Completed,
            it will appear here.
          </p>
        </div>
      `
      : `
        <div class="empty">
          <div class="emoji">🧳</div>

          <h2>Your next adventure starts here</h2>

          <p>
            Create a trip to start comparing flights,
            planning spending and tracking savings.
          </p>

          <button class="btn btn-primary" data-action="new">
            + Create a trip
          </button>
        </div>
      `;
  } else {
    html += `
      <div class="trip-grid">
        ${visibleTrips.map(tripCard).join("")}
      </div>
    `;
  }

  $("#appContent").innerHTML = html;
}

/* ==========================================
   TRIP DETAIL DASHBOARD
========================================== */

function renderTripDetails() {
  const trip = getSelectedTrip();

  if (!trip) return;

  const budget = num(trip.budget);
  const saved = totalSaved(trip);
  const remaining = budget - saved;
  const progress = savingsProgress(trip);

  $("#pageTitle").textContent = trip.destination;
  $("#pageSubtitle").textContent = trip.name;

  let html = `
    <button class="btn-link back" data-action="back">
      ← All trips
    </button>

    <div class="detail-meta">
      <span class="badge ${getStatusClass(trip)}">
        ${escapeHTML(trip.status)}
      </span>

      <span>
        📅 ${niceDate(trip.departure)}
        —
        ${niceDate(trip.returnDate)}
      </span>
    </div>

    <div class="detail-top">
      <div class="pill-row">
        <span class="pill">
          ${(trip.options || []).length} travel options
        </span>

        <span class="pill">
          ${(trip.savings || []).length} saving periods
        </span>
      </div>

      <div class="detail-actions">
        <button
          class="btn btn-outline btn-small"
          data-action="edit-trip"
        >
          Edit trip
        </button>

        <button
          class="btn btn-outline btn-small"
          data-action="change-status"
        >
          Change status
        </button>

        <button
          class="btn btn-danger btn-small"
          data-action="delete-trip"
        >
          Delete
        </button>
      </div>
    </div>

    <div class="stats" style="margin-top: 19px">
      ${statCard("Savings target", money(budget), "Your full trip budget")}

      ${statCard(
        "Currently saved",
        money(saved),
        "Recorded contributions",
        "teal",
      )}

      ${statCard(
        "Still to save",
        money(Math.max(0, remaining)),
        remaining < 0
          ? `${money(-remaining)} over target`
          : "Until you reach your goal",
        remaining <= 0 ? "positive" : "",
      )}

      ${statCard(
        "Savings progress",
        `${budget > 0 ? ((saved / budget) * 100).toFixed(2) : "0.00"}%`,
        "Of your savings target",
      )}
    </div>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Savings progress</h2>
          <p>
            ${money(saved)} saved out of ${money(budget)}
          </p>
        </div>
      </div>

      ${progressBar(progress)}
    </section>
  `;

  html += renderTravelOptions(trip);
  html += renderSavingsTracker(trip);

  html += `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Trip notes</h2>

          <p>
            ${
              trip.notes
                ? escapeHTML(trip.notes)
                : "Add notes from Edit trip to keep booking details, ideas, and memories together."
            }
          </p>
        </div>
      </div>
    </section>
  `;

  $("#appContent").innerHTML = html;
}

/* ==========================================
   FLIGHT & TRAVEL COMPARISON TABLE
========================================== */

function renderTravelOptions(trip) {
  const options = trip.options || [];
  const budget = num(trip.budget);

  let html = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>✈ Flight & trip cost comparison</h2>

          <p>
            Ticket in MVR + bank USD purchase × MVR rate
            + stay + extras
          </p>
        </div>

        <button
          class="btn btn-primary btn-small"
          data-action="add-option"
        >
          ＋ Add option
        </button>
      </div>
  `;

  if (options.length === 0) {
    html += `
      <div class="no-data">
        No options yet. Add flight prices and stay costs
        to compare total budgets.
      </div>
    `;
  } else {
    const rows = options
      .map((option) => {
        const cost = travelCost(option);
        const remaining = budget - cost;

        return `
        <tr>
          <td>
            <strong>${escapeHTML(option.name)}</strong>
          </td>

          <td class="number">${money(option.ticket)}</td>
          <td class="number">${usd(option.dollars)}</td>
          <td class="number">${num(option.rate).toFixed(3)}</td>
          <td class="number">${money(option.stay)}</td>
          <td class="number">${money(option.other)}</td>

          <td class="number">
            <strong>${money(cost)}</strong>
          </td>

          <td class="number ${remaining >= 0 ? "positive" : "negative"}">
            ${money(remaining)}
          </td>

          <td>
            <div class="inline-actions">
              <button
                class="btn-link"
                data-action="edit-option"
                data-id="${escapeHTML(option.id)}"
              >
                Edit
              </button>

              <button
                class="btn-link negative"
                data-action="delete-option"
                data-id="${escapeHTML(option.id)}"
              >
                ×
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    html += `
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Option</th>
              <th class="number">Ticket</th>
              <th class="number">Bank USD</th>
              <th class="number">Rate</th>
              <th class="number">Stay</th>
              <th class="number">Extras</th>
              <th class="number">Total cost</th>
              <th class="number">Budget left</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  const cheapest = options.length ? Math.min(...options.map(travelCost)) : null;

  html += `
    <div class="rate-info">
      Bank USD is the amount of dollars you intend
      to purchase, not the ticket price in USD.

      Exchange rates are entered manually.

      ${
        cheapest === null
          ? ""
          : `
            Cheapest option: ${money(cheapest)}
            (${money(budget - cheapest)} budget remaining).
          `
      }
    </div>
    </section>
  `;

  return html;
}

/* ==========================================
   MONTHLY SAVINGS TRACKER
========================================== */

function renderSavingsTracker(trip) {
  const people = getPeople(trip);
  const savings = trip.savings || [];

  let html = `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>💰 Monthly savings tracker</h2>

          <p>
            ${people.length} saver${people.length === 1 ? "" : "s"}
            · Monthly target ${money(monthlyTarget(trip))}
            · Total planned ${money(totalPlanned(trip))}
          </p>
        </div>

        <button
          class="btn btn-primary btn-small"
          data-action="add-saving"
        >
          ＋ Add month
        </button>
      </div>
  `;

  if (savings.length === 0) {
    html += `
      <div class="no-data">
        No monthly entries yet. Add your first savings
        month, or edit the trip to set a starting month.
      </div>
    `;
  } else {
    const plannedHeaders = people
      .map(
        (person) => `
        <th class="number">
          ${escapeHTML(person.name)} target
        </th>
      `,
      )
      .join("");

    const savedHeaders = people
      .map(
        (person) => `
        <th class="number">
          ${escapeHTML(person.name)} saved
        </th>
      `,
      )
      .join("");

    const rows = savings
      .map((row) => {
        const plannedTotal = people.reduce(
          (total, person) => total + getContribution(row, person, "planned"),
          0,
        );

        const savedTotal = people.reduce(
          (total, person) => total + getContribution(row, person, "saved"),
          0,
        );

        return `
        <tr>
          <td>
            <strong>${escapeHTML(row.month)}</strong>
          </td>

          ${people
            .map(
              (person) => `
            <td class="number">
              ${money(getContribution(row, person, "planned"))}
            </td>
          `,
            )
            .join("")}

          <td class="number">
            ${money(plannedTotal)}
          </td>

          ${people
            .map(
              (person) => `
            <td class="number">
              ${money(getContribution(row, person, "saved"))}
            </td>
          `,
            )
            .join("")}

          <td class="number teal">
            <strong>${money(savedTotal)}</strong>
          </td>

          <td>
            <div class="inline-actions">
              <button
                class="btn-link"
                data-action="edit-saving"
                data-id="${escapeHTML(row.id)}"
              >
                Edit
              </button>

              <button
                class="btn-link negative"
                data-action="delete-saving"
                data-id="${escapeHTML(row.id)}"
              >
                ×
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");

    const plannedFooters = people
      .map(
        (person) => `
      <td class="number">
        ${money(
          savings.reduce(
            (total, row) => total + getContribution(row, person, "planned"),
            0,
          ),
        )}
      </td>
    `,
      )
      .join("");

    const savedFooters = people
      .map(
        (person) => `
      <td class="number">
        ${money(
          savings.reduce(
            (total, row) => total + getContribution(row, person, "saved"),
            0,
          ),
        )}
      </td>
    `,
      )
      .join("");

    html += `
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Month</th>
              ${plannedHeaders}
              <th class="number">Planned total</th>
              ${savedHeaders}
              <th class="number">Saved total</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>${rows}</tbody>

          <tfoot>
            <tr>
              <td>Total</td>
              ${plannedFooters}

              <td class="number">
                ${money(totalPlanned(trip))}
              </td>

              ${savedFooters}

              <td class="number">
                ${money(totalSaved(trip))}
              </td>

              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  html += `
    <div class="rate-info">
      Savings remaining:
      <strong>
        ${money(Math.max(0, num(trip.budget) - totalSaved(trip)))}
      </strong>.

      Planned remaining contributions:
      <strong>
        ${money(Math.max(0, totalPlanned(trip) - totalSaved(trip)))}
      </strong>.

      These measure different things.
    </div>
    </section>
  `;

  return html;
}

/* ==========================================
   FORM FIELD HELPERS
========================================== */

function field(name, label, value = "", type = "text", options = {}) {
  const required = options.required ? "required" : "";
  const numberAttributes = type === "number" ? 'min="0" step="any"' : "";

  const placeholder = options.placeholder
    ? `placeholder="${escapeHTML(options.placeholder)}"`
    : "";

  return `
    <div class="field ${options.full ? "full" : ""}">
      <label for="f-${escapeHTML(name)}">
        ${escapeHTML(label)}
      </label>

      <input
        id="f-${escapeHTML(name)}"
        name="${escapeHTML(name)}"
        type="${type}"
        value="${escapeHTML(value)}"
        ${required}
        ${numberAttributes}
        ${placeholder}
      >

      <span class="hint">
        ${escapeHTML(options.hint || "")}
      </span>
    </div>
  `;
}

function selectField(name, label, value, choices) {
  const options = choices
    .map(
      (choice) => `
    <option
      value="${escapeHTML(choice)}"
      ${value === choice ? "selected" : ""}
    >
      ${escapeHTML(choice)}
    </option>
  `,
    )
    .join("");

  return `
    <div class="field">
      <label for="f-${escapeHTML(name)}">
        ${escapeHTML(label)}
      </label>

      <select
        name="${escapeHTML(name)}"
        id="f-${escapeHTML(name)}"
      >
        ${options}
      </select>
    </div>
  `;
}

/* ==========================================
   MODAL MANAGEMENT
========================================== */

function showModal(title, body, onSubmit) {
  $("#modalHeading").textContent = title;

  $("#modalBody").innerHTML = `
    <form id="activeForm">
      <div class="form-grid">
        ${body}
      </div>

      <div class="modal-actions">
        <button
          type="button"
          class="btn btn-outline"
          id="cancelModal"
        >
          Cancel
        </button>

        <button
          type="submit"
          class="btn btn-primary"
        >
          Save changes
        </button>
      </div>
    </form>
  `;

  $("#modalLayer").classList.remove("hidden");

  $("#cancelModal").onclick = closeModal;

  $("#activeForm").onsubmit = (event) => {
    event.preventDefault();

    const data = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );

    if (onSubmit(data) !== false) {
      closeModal();
      render();
    }
  };

  $("#modalBody input, #modalBody select")?.focus();
}

function closeModal() {
  $("#modalLayer").classList.add("hidden");
  $("#modalBody").innerHTML = "";
}

/* ==========================================
   SAVER EDITOR
========================================== */

function saverRow(person, index) {
  return `
    <div
      class="saver-row"
      data-id="${escapeHTML(person.id)}"
    >
      <div class="field">
        <label>Saver ${index + 1} name</label>

        <input
          data-saver-name
          required
          maxlength="50"
          value="${escapeHTML(person.name)}"
          placeholder="Name"
        >
      </div>

      <div class="field">
        <label>Monthly target (MVR)</label>

        <input
          data-saver-target
          type="number"
          min="0"
          step="any"
          required
          value="${num(person.monthlyTarget)}"
        >
      </div>

      <button
        class="btn btn-outline btn-small saver-remove"
        type="button"
        data-remove-saver
        aria-label="Remove saver"
      >
        ×
      </button>
    </div>
  `;
}

function readSavers() {
  return [...document.querySelectorAll("#peopleEditor .saver-row")].map(
    (row) => ({
      id: row.dataset.id,
      name: row.querySelector("[data-saver-name]").value.trim(),
      monthlyTarget: num(row.querySelector("[data-saver-target]").value),
    }),
  );
}

/* ==========================================
   CREATE & EDIT TRIP
========================================== */

function tripForm(existing = null) {
  const trip = existing || {};
  const people = getPeople(trip);
  const isNew = !existing;

  const locationInput = `
    <div class="field full location-wrap">
      <label for="f-destination">
        Destination (city)
      </label>

      <input
        id="f-destination"
        name="destination"
        type="text"
        autocomplete="off"
        required
        value="${escapeHTML(trip.destination || "")}"
        placeholder="Start typing Colombo, Malé, Dubai..."
      >

      <div
        class="location-suggestions hidden"
        id="locationSuggestions"
        role="listbox"
      ></div>

      <span class="hint" id="locationHint">
        Choose a suggested location when online.
        You can type manually if offline.
      </span>
    </div>
  `;

  const saverEditor = `
    <div class="field full">
      <label>People saving for this trip</label>

      <div id="peopleEditor" class="people-editor">
        ${people.map(saverRow).join("")}
      </div>

      <button
        class="btn btn-outline btn-small"
        type="button"
        id="addSaver"
      >
        ＋ Add saver
      </button>

      <span class="hint">
        Set each person's monthly savings target.
      </span>
    </div>
  `;

  const body = [
    field("name", "Trip name", trip.name || "", "text", {
      required: true,
      placeholder: "January getaway",
    }),

    locationInput,

    field("departure", "Departure date", trip.departure || "", "date"),

    field("returnDate", "Return date", trip.returnDate || "", "date"),

    field(
      "budget",
      "Savings target / trip budget (MVR)",
      trip.budget ?? 34000,
      "number",
      { required: true },
    ),

    selectField("status", "Trip status", trip.status || "Planning", [
      "Planning",
      "Upcoming",
      "Completed",
    ]),

    saverEditor,

    field(
      "startMonth",
      "First savings month",
      trip.startMonth || defaultStartMonth(),
      "month",
      {
        hint: "Used to generate monthly savings rows.",
      },
    ),

    field(
      "monthCount",
      "Number of savings months",
      trip.monthCount ?? 4,
      "number",
      {
        hint: "Maximum 60 months. Existing savings are preserved.",
      },
    ),

    field("notes", "Trip notes", trip.notes || "", "text", {
      full: true,
      placeholder: "Optional notes",
    }),
  ].join("");

  showModal(existing ? "Edit trip" : "Create a trip", body, (data) => {
    const savers = readSavers();

    if (!savers.length || savers.some((p) => !p.name)) {
      notify("Add at least one saver with a name.");
      return false;
    }

    if (data.departure && data.returnDate && data.returnDate < data.departure) {
      notify("Return date must be after departure.");
      return false;
    }

    const monthCount = Number(data.monthCount);

    if (!Number.isInteger(monthCount) || monthCount < 0 || monthCount > 60) {
      notify("Savings months must be between 0 and 60.");
      return false;
    }

    const updated = {
      ...trip,
      id: existing?.id || generateId(),
      name: data.name.trim(),
      destination: data.destination.trim(),
      departure: data.departure,
      returnDate: data.returnDate,
      budget: num(data.budget),
      status: data.status,
      people: savers,
      startMonth: data.startMonth || defaultStartMonth(),
      monthCount,
      notes: data.notes.trim(),
      options: existing?.options || [],
      savings: existing?.savings || [],
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    if (!updated.name || !updated.destination) {
      notify("Enter a trip name and destination.");
      return false;
    }

    if (isNew) {
      for (let index = 0; index < monthCount; index++) {
        updated.savings.push({
          id: generateId(),
          month: nextMonth(updated.startMonth, index),
          contributions: Object.fromEntries(
            savers.map((person) => [
              person.id,
              {
                planned: person.monthlyTarget,
                saved: 0,
              },
            ]),
          ),
        });
      }
    } else {
      // Preserve existing monthly savings.
      for (const row of updated.savings) {
        if (!row.contributions) {
          row.contributions = {};

          for (const person of people) {
            row.contributions[person.id] = {
              planned: getContribution(row, person, "planned"),
              saved: getContribution(row, person, "saved"),
            };
          }
        }

        for (const person of savers) {
          if (!row.contributions[person.id]) {
            row.contributions[person.id] = {
              planned: person.monthlyTarget,
              saved: 0,
            };
          }
        }
      }
    }

    if (existing) {
      Object.assign(existing, updated);
    } else {
      trips.unshift(updated);
      selectedTripId = updated.id;
    }

    saveTrips();
    notify(existing ? "Trip updated." : "Trip created.");

    return true;
  });

  $("#addSaver").onclick = () => {
    const wrapper = document.createElement("div");

    wrapper.innerHTML = saverRow(
      {
        id: generateId(),
        name: "",
        monthlyTarget: 0,
      },
      $("#peopleEditor").children.length,
    );

    $("#peopleEditor").append(wrapper.firstElementChild);
  };

  $("#peopleEditor").onclick = (event) => {
    const removeButton = event.target.closest("[data-remove-saver]");

    if (!removeButton) return;

    if ($("#peopleEditor").children.length <= 1) {
      notify("A trip needs at least one saver.");
      return;
    }

    removeButton.closest(".saver-row").remove();
  };

  setupLocationAutocomplete();
}

/* ==========================================
   LOCATION AUTOCOMPLETE
========================================== */

function setupLocationAutocomplete() {
  const input = $("#f-destination");
  const list = $("#locationSuggestions");
  const hint = $("#locationHint");

  let timer;
  let controller;
  let choices = [];

  input.addEventListener("input", () => {
    clearTimeout(timer);
    controller?.abort();

    const query = input.value.trim();

    list.classList.add("hidden");

    if (query.length < 3) {
      hint.textContent = "Enter at least 3 characters for suggestions.";

      return;
    }

    hint.textContent = "Searching real locations…";

    timer = setTimeout(async () => {
      try {
        controller = new AbortController();

        const url =
          "https://geocoding-api.open-meteo.com/v1/search" +
          `?name=${encodeURIComponent(query)}` +
          "&count=8&language=en&format=json";

        const response = await fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Location service unavailable");
        }

        const data = await response.json();

        if (input.value.trim() !== query) return;

        choices = (data.results || []).map((place) => {
          return [place.name, place.admin1, place.country]
            .filter(Boolean)
            .filter((value, index, array) => array.indexOf(value) === index)
            .join(", ");
        });

        list.innerHTML = choices
          .map(
            (name, index) => `
          <button
            type="button"
            class="location-option"
            data-index="${index}"
            role="option"
          >
            ${escapeHTML(name)}
          </button>
        `,
          )
          .join("");

        list.classList.toggle("hidden", choices.length === 0);

        hint.textContent = choices.length
          ? "Select a suggestion to use its official place name."
          : "No matching cities found. You can type manually.";
      } catch (error) {
        if (error.name !== "AbortError") {
          hint.textContent = "Location lookup unavailable. Enter manually.";
        }
      }
    }, 320);
  });

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-index]");

    if (!button) return;

    input.value = choices[Number(button.dataset.index)];

    list.classList.add("hidden");
    hint.textContent = "Location selected.";
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      list.classList.add("hidden");
    }
  });
}

/* ==========================================
   ADD & EDIT TRAVEL OPTIONS
========================================== */

function travelOptionForm(existing = null) {
  const trip = getSelectedTrip();
  const option = existing || {};

  const body = [
    field("name", "Option name", option.name || "", "text", {
      required: true,
      full: true,
      placeholder: "FlyDubai – Morning flight",
    }),

    field("ticket", "Ticket price (MVR)", option.ticket ?? 0, "number", {
      required: true,
    }),

    field("dollars", "USD purchased from bank", option.dollars ?? 0, "number", {
      required: true,
    }),

    field("rate", "Bank rate (MVR per USD)", option.rate ?? 15.42, "number", {
      required: true,
      hint: "Example: 15.42 MVR for 1 USD",
    }),

    field("stay", "Stay / accommodation (MVR)", option.stay ?? 0, "number", {
      required: true,
    }),

    field("other", "Other planned expenses (MVR)", option.other ?? 0, "number"),
  ].join("");

  showModal(
    existing ? "Edit travel option" : "Add travel option",
    body,
    (data) => {
      if (!data.name.trim()) {
        notify("Enter an option name.");
        return false;
      }

      const updated = {
        id: existing?.id || generateId(),
        name: data.name.trim(),
        ticket: num(data.ticket),
        dollars: num(data.dollars),
        rate: num(data.rate),
        stay: num(data.stay),
        other: num(data.other),
      };

      if (existing) {
        Object.assign(existing, updated);
      } else {
        trip.options.push(updated);
      }

      saveTrips();
      notify("Travel option saved.");

      return true;
    },
  );
}

/* ==========================================
   ADD & EDIT MONTHLY SAVINGS
========================================== */

function savingsForm(existing = null) {
  const trip = getSelectedTrip();
  const row = existing || {};
  const people = getPeople(trip);

  let body = field("month", "Month / period", row.month || "", "text", {
    required: true,
    full: true,
    placeholder: "Oct 2026",
  });

  for (const person of people) {
    body += field(
      `plan_${person.id}`,
      `${person.name} planned (MVR)`,
      existing ? getContribution(row, person, "planned") : person.monthlyTarget,
      "number",
      { required: true },
    );

    body += field(
      `saved_${person.id}`,
      `${person.name} actually saved (MVR)`,
      existing ? getContribution(row, person, "saved") : 0,
      "number",
      { required: true },
    );
  }

  showModal(
    existing ? "Edit savings month" : "Add savings month",
    body,
    (data) => {
      if (!data.month.trim()) {
        notify("Enter the month or period.");
        return false;
      }

      const contributions = Object.fromEntries(
        people.map((person) => [
          person.id,
          {
            planned: num(data[`plan_${person.id}`]),
            saved: num(data[`saved_${person.id}`]),
          },
        ]),
      );

      const updated = {
        ...row,
        id: existing?.id || generateId(),
        month: data.month.trim(),
        contributions,
      };

      if (existing) {
        Object.assign(existing, updated);
      } else {
        trip.savings.push(updated);
      }

      saveTrips();
      notify("Savings saved.");

      return true;
    },
  );
}

/* ==========================================
   CHANGE TRIP STATUS
========================================== */

function changeTripStatus(trip) {
  const choices = ["Planning", "Upcoming", "Completed"];

  const body = selectField(
    "status",
    "Choose trip status",
    trip.status,
    choices,
  );

  showModal("Change trip status", body, (data) => {
    trip.status = data.status;

    saveTrips();

    // Return to the appropriate trip list.
    selectedTripId = null;

    currentView = data.status === "Completed" ? "history" : "all";

    notify(`Trip status changed to ${trip.status}.`);

    return true;
  });
}

/* ==========================================
   DELETE CONFIRMATION
========================================== */

function confirmRemove(message, callback) {
  if (!window.confirm(message)) return;

  callback();

  saveTrips();
  render();

  notify("Deleted.");
}

/* ==========================================
   DARK MODE
========================================== */

function initializeTheme() {
  const toggle = $("#themeToggle");
  const icon = $("#themeIcon");
  const label = $("#themeLabel");

  if (!toggle) return;

  function applyTheme(theme) {
    const dark = theme === "dark";

    document.body.classList.toggle("dark-mode", dark);

    if (icon) {
      icon.textContent = dark ? "☀️" : "🌙";
    }

    if (label) {
      label.textContent = dark ? "Light Mode" : "Dark Mode";
    }

    toggle.setAttribute("aria-pressed", String(dark));
  }

  const savedTheme = localStorage.getItem(THEME_KEY);

  applyTheme(savedTheme === "dark" ? "dark" : "light");

  toggle.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark-mode");

    const newTheme = isDark ? "light" : "dark";

    localStorage.setItem(THEME_KEY, newTheme);
    applyTheme(newTheme);
  });
}

/* ==========================================
   NAVIGATION EVENT LISTENERS
========================================== */

$("#newTripBtn").addEventListener("click", () => {
  tripForm();
});

$("#allTripsNav").addEventListener("click", () => {
  selectedTripId = null;
  currentView = "all";

  render();
});

$("#historyNav").addEventListener("click", () => {
  selectedTripId = null;
  currentView = "history";

  render();
});

/* ==========================================
   MODAL - SAFE OUTSIDE CLICK HANDLING
========================================== */

// Track where the mouse press started.
let modalPointerStartedOutside = false;

// Record whether the initial mouse press
// happened on the modal background.
$("#modalLayer").addEventListener("pointerdown", (event) => {
  modalPointerStartedOutside = event.target === event.currentTarget;
});

// Only close when both the press and release
// happen directly on the modal background.
$("#modalLayer").addEventListener("pointerup", (event) => {
  const endedOutside = event.target === event.currentTarget;

  if (modalPointerStartedOutside && endedOutside) {
    closeModal();
  }

  modalPointerStartedOutside = false;
});

// Reset if the gesture is cancelled.
$("#modalLayer").addEventListener("pointercancel", () => {
  modalPointerStartedOutside = false;
});

/* ==========================================
   TRIP ACTION EVENT HANDLING
========================================== */

$("#appContent").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");

  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  const trip = getSelectedTrip();

  switch (action) {
    case "new":
      tripForm();
      break;

    case "open":
      selectedTripId = id;
      render();
      break;

    case "back":
      selectedTripId = null;
      currentView = "all";
      render();
      break;

    case "edit-trip":
      if (trip) tripForm(trip);
      break;

    case "change-status":
      if (trip) changeTripStatus(trip);
      break;

    case "delete-trip":
      if (!trip) break;

      confirmRemove(
        `Permanently delete "${trip.name}" and all its data?`,
        () => {
          trips = trips.filter((item) => item.id !== trip.id);

          selectedTripId = null;
        },
      );
      break;

    case "add-option":
      if (trip) travelOptionForm();
      break;

    case "edit-option":
      if (!trip) break;

      travelOptionForm(trip.options.find((option) => option.id === id));
      break;

    case "delete-option":
      if (!trip) break;

      confirmRemove("Delete this travel option?", () => {
        trip.options = trip.options.filter((option) => option.id !== id);
      });
      break;

    case "add-saving":
      if (trip) savingsForm();
      break;

    case "edit-saving":
      if (!trip) break;

      savingsForm(trip.savings.find((row) => row.id === id));
      break;

    case "delete-saving":
      if (!trip) break;

      confirmRemove("Delete this monthly savings entry?", () => {
        trip.savings = trip.savings.filter((row) => row.id !== id);
      });
      break;
  }
});

/* ==========================================
   VOYAFUNDRA FOOTER
========================================== */

const yearElement = document.getElementById("currentYear");

if (yearElement) {
  yearElement.textContent = new Date().getFullYear();
}

/* ==========================================
   INITIALIZE APPLICATION
========================================== */
// Load the saved light/dark preference.
initializeTheme();

// Show an empty application until authentication
// has loaded the current user's cloud trips.
render();

// Authentication and cloud loading start in auth.js.
