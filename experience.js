"use strict";

/* Cloud status, explicit refresh, and reviewable recovery of failed saves.
   This module never silently discards local edits. */
(() => {
  const status = document.querySelector(".cloud-status");
  const statusText = document.getElementById("cloudStatusText");
  const refreshButton = document.getElementById("refreshTripsBtn");
  const offlineBanner = document.getElementById("connectionBanner");
  const reviewButton = document.getElementById("reviewCloudIssueBtn");
  const recoveryPanel = document.getElementById("cloudRecoveryPanel");
  const recoveryDetails = document.getElementById("cloudRecoveryDetails");
  const recoveryMessage = document.getElementById("cloudRecoveryMessage");
  const downloadBackupButton = document.getElementById("downloadRecoveryBackupBtn");
  const closeRecoveryButton = document.getElementById("closeCloudRecoveryBtn");
  const discardButton = document.getElementById("discardRecoveryBtn");
  const acknowledgeDiscard = document.getElementById("acknowledgeRecoveryDiscard");
  const compareTripSelect = document.getElementById("cloudConflictTripSelect");
  const compareButton = document.getElementById("compareCloudTripBtn");
  const compareSection = document.getElementById("cloudConflictComparison");
  const compareTable = document.getElementById("cloudConflictTable");
  const compareNotice = document.getElementById("cloudConflictChangeNotice");
  const acceptCloudButton = document.getElementById("acceptCloudTripBtn");
  const acceptLocalButton = document.getElementById("acceptLocalTripBtn");
  const acknowledgeConflict = document.getElementById("acknowledgeConflictChoice");

  if (!status || !statusText || !refreshButton || !offlineBanner ||
      !reviewButton || !recoveryPanel || !recoveryDetails ||
      !recoveryMessage || !downloadBackupButton || !closeRecoveryButton ||
      !discardButton || !acknowledgeDiscard || !compareTripSelect ||
      !compareButton || !compareSection || !compareTable || !compareNotice ||
      !acceptCloudButton || !acceptLocalButton || !acknowledgeConflict) return;

  let state = "loading";
  let lastMessage = "Checking cloud connection...";
  let refreshing = false;
  let recovering = false;
  let comparing = false;
  let currentComparison = null;

  const view = {
    setStatus(nextState, message) {
      state = nextState;
      lastMessage = message;
      redraw();
    },
  };
  window.voyafundraUX = view;

  function hasUnconfirmedChanges() {
    return !!cloudSaveError || cloudUnsavedTripIds.size > 0;
  }

  function updateRecoveryDetails() {
    const names = Array.from(cloudUnsavedTripIds).map((id) => {
      const trip = trips.find((item) => item.id === id);
      return trip ? trip.name || "Unnamed trip" : "Trip pending deletion";
    });
    const message = cloudSaveError?.message || "A trip edit has not been confirmed.";
    recoveryDetails.textContent =
      "Last save issue: " + message +
      ". Unconfirmed trip(s): " + (names.join(", ") || "none identified") + ".";
  }

  function redraw() {
    const offline = !navigator.onLine;
    const loggedIn = document.body.classList.contains("authenticated");
    const unsaved = loggedIn && hasUnconfirmedChanges();
    offlineBanner.hidden = !offline || !loggedIn;
    status.dataset.state = offline ? "offline" : state;
    statusText.textContent = offline
      ? "Offline — cloud access unavailable"
      : unsaved && !cloudWritesPending
        ? "Unsaved changes — review before refreshing"
        : lastMessage;
    refreshButton.disabled = offline || refreshing || recovering ||
      !loggedIn || !cloudReady || cloudWritesPending > 0;
    reviewButton.hidden = !unsaved || cloudWritesPending > 0;
    reviewButton.disabled = offline || refreshing || recovering;
    if (!recoveryPanel.hidden) {
      compareButton.disabled = offline || refreshing || recovering ||
        comparing || cloudWritesPending > 0 || !compareTripSelect.value;
    }
    if (!loggedIn || !unsaved) {
      recoveryPanel.hidden = true;
      acknowledgeDiscard.checked = false;
    } else if (!recoveryPanel.hidden) {
      updateRecoveryDetails();
    }
  }

  function updateConflictChoices() {
    const previousId = compareTripSelect.value;
    compareTripSelect.replaceChildren();
    for (const id of cloudUnsavedTripIds) {
      const trip = trips.find((item) => item.id === id);
      const option = document.createElement("option");
      option.value = id;
      option.textContent = trip?.name || "Trip pending deletion";
      compareTripSelect.appendChild(option);
    }
    if (cloudUnsavedTripIds.has(previousId)) compareTripSelect.value = previousId;
    compareButton.disabled = !compareTripSelect.value || comparing || recovering ||
      cloudWritesPending > 0 || !navigator.onLine;
  }

  function clearComparison() {
    currentComparison = null;
    compareSection.hidden = true;
    acknowledgeConflict.checked = false;
    compareTable.replaceChildren();
  }

  function showRecovery() {
    if (!hasUnconfirmedChanges() || !cloudReady) return;
    updateRecoveryDetails();
    updateConflictChoices();
    clearComparison();
    recoveryMessage.textContent = "";
    recoveryPanel.hidden = false;
    recoveryPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function displayValue(trip, key) {
    if (!trip) return "Trip not available";
    const value = trip[key];
    if (Array.isArray(value)) return value.length + " entries";
    if (value === null || value === undefined || value === "") return "Not set";
    return String(value);
  }

  function renderConflictComparison(review) {
    compareTable.replaceChildren();
    const fields = [
      ["Trip name", "name"],
      ["Destination", "destination"],
      ["Departure date", "departure"],
      ["Return date", "returnDate"],
      ["Trip budget (MVR)", "budget"],
      ["Status", "status"],
      ["First savings month", "startMonth"],
      ["Savings months", "monthCount"],
      ["Notes", "notes"],
      ["Savers", "people"],
      ["Travel options", "options"],
      ["Savings entries", "savings"],
    ];
    const heading = document.createElement("div");
    heading.className = "cloud-conflict-row cloud-conflict-heading";
    for (const label of ["Field", "This device", "Saved cloud"]) {
      const cell = document.createElement("strong");
      cell.textContent = label;
      heading.appendChild(cell);
    }
    compareTable.appendChild(heading);
    let differences = 0;
    for (const [label, key] of fields) {
      const row = document.createElement("div");
      row.className = "cloud-conflict-row";
      const changed = JSON.stringify(review.local?.[key] ?? null) !==
        JSON.stringify(review.remote?.[key] ?? null);
      if (changed) {
        differences++;
        row.classList.add("is-changed");
      }
      const field = document.createElement("strong");
      field.textContent = label + (changed ? " · different" : "");
      const local = document.createElement("span");
      local.textContent = displayValue(review.local, key);
      const remote = document.createElement("span");
      remote.textContent = displayValue(review.remote, key);
      row.append(field, local, remote);
      compareTable.appendChild(row);

      // Detailed comparisons for embedded lists are opt-in, so the main
      // panel stays compact even with long savings histories.
      if (["people", "options", "savings"].includes(key) && changed) {
        const detail = document.createElement("details");
        detail.className = "cloud-conflict-details";
        const summary = document.createElement("summary");
        summary.textContent = "View " + label.toLowerCase() + " details";
        const columns = document.createElement("div");
        columns.className = "cloud-conflict-raw";
        for (const [side, trip] of [
          ["This device", review.local], ["Cloud", review.remote],
        ]) {
          const pre = document.createElement("pre");
          pre.textContent = side + "\n" + JSON.stringify(trip?.[key] ?? null, null, 2);
          columns.appendChild(pre);
        }
        detail.append(summary, columns);
        compareTable.appendChild(detail);
      }
    }
    compareNotice.textContent = review.remote
      ? differences + " field(s) differ. Cloud last updated: " +
        new Date(review.updatedAt).toLocaleString() + "."
      : "This trip no longer exists in the cloud. You can accept its removal " +
        "or download your local backup. To recreate it, use a new trip.";
    acceptLocalButton.disabled = !review.remote || !review.local;
    compareSection.hidden = false;
  }

  async function compareUnsavedTrip() {
    if (comparing || recovering || !compareTripSelect.value ||
        cloudWritesPending > 0 || !navigator.onLine) return;
    comparing = true;
    compareButton.disabled = true;
    clearComparison();
    const id = compareTripSelect.value;
    recoveryMessage.textContent = "Reading the latest cloud copy...";
    try {
      await verifyAccount();
      const review = await window.voyafundraConflicts.review(id);
      if (compareTripSelect.value !== id) {
        throw new Error("Selected trip changed. Compare again.");
      }
      currentComparison = review;
      renderConflictComparison(review);
      recoveryMessage.textContent = "Comparison ready. No changes have been saved or discarded.";
    } catch (error) {
      recoveryMessage.textContent = error.message || "Could not compare trip versions.";
    } finally {
      comparing = false;
      updateConflictChoices();
    }
  }

  async function chooseConflictVersion(choice) {
    if (recovering || comparing || !currentComparison) return;
    if (!acknowledgeConflict.checked) {
      recoveryMessage.textContent = "Please acknowledge the replacement warning first.";
      return;
    }
    const reviewed = currentComparison;
    const local = choice === "local";
    const warning = local
      ? "Replace the saved CLOUD trip with this device's entire trip, " +
        "including its savings and travel options? This will not merge changes."
      : "Replace this device's unsaved trip with the latest CLOUD version? " +
        "Download your backup first if you may need your local changes.";
    if (!window.confirm(warning)) return;
    recovering = true;
    acceptCloudButton.disabled = true;
    acceptLocalButton.disabled = true;
    recoveryMessage.textContent = "Verifying and applying your choice...";
    try {
      await verifyAccount();
      if (local) await window.voyafundraConflicts.useLocal(reviewed);
      else await window.voyafundraConflicts.useCloud(reviewed);
      clearComparison();
      updateConflictChoices();
      if (hasUnconfirmedChanges()) {
        recoveryMessage.textContent =
          "Trip resolved. Other unsaved trips still need review.";
        updateRecoveryDetails();
      } else {
        recoveryPanel.hidden = true;
        recoveryMessage.textContent = "";
      }
    } catch (error) {
      clearComparison();
      recoveryMessage.textContent =
        (error.message || "Resolution failed.") + " No local edits were discarded.";
    } finally {
      recovering = false;
      updateConflictChoices();
      redraw();
    }
  }

  async function verifyAccount() {
    const currentId = cloudUserId;
    const { data, error } = await supabaseClient.auth.getUser();
    if (error || !data?.user || !currentId || data.user.id !== currentId) {
      throw new Error("Your account changed. Please sign in again.");
    }
    return currentId;
  }

  async function refreshTrips() {
    if (refreshing || recovering || !navigator.onLine || !cloudReady || !cloudUserId) return;
    if (cloudWritesPending > 0) {
      view.setStatus("saving", "Wait for current saves before refreshing");
      return;
    }
    if (cloudSaveError || cloudUnsavedTripIds.size) {
      view.setStatus("error", "Unsaved changes detected — refresh blocked");
      showRecovery();
      return;
    }
    if (!document.getElementById("modalLayer")?.classList.contains("hidden")) {
      alert("Close the trip editor before refreshing.");
      return;
    }
    if (!window.confirm("Reload trips from the cloud? This returns you to My Trips.")) return;
    refreshing = true;
    refreshButton.disabled = true;
    view.setStatus("loading", "Refreshing trips...");
    try {
      await waitForCloudSaves();
      if (cloudSaveError || cloudWritesPending > 0 || cloudUnsavedTripIds.size) {
        throw new Error("An unsaved trip change is still pending.");
      }
      const currentId = await verifyAccount();
      await refreshCloudTripsSafely(currentId);
      view.setStatus("saved", "Trips refreshed from the cloud");
    } catch (error) {
      view.setStatus("error", error.message || "Unable to refresh trips");
      recoveryMessage.textContent = error.message || "Unable to refresh trips";
    } finally {
      refreshing = false;
      redraw();
    }
  }

  function downloadUnsavedBackup() {
    if (!hasUnconfirmedChanges()) {
      recoveryMessage.textContent = "There are no unconfirmed trip edits to export.";
      return;
    }
    const snapshot = getCloudRecoverySnapshot();
    if (!snapshot.unsaved.length) {
      recoveryMessage.textContent = "No unsaved trip snapshots are available.";
      return;
    }
    // Download is user-initiated. We cannot verify that the file was saved,
    // so the discard acknowledgement must still be checked by the user.
    const contents = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "voyafundra-unsaved-" +
      new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
    recoveryMessage.textContent =
      "Backup download requested. Confirm it was saved before discarding edits.";
  }

  async function discardAndRefresh() {
    if (recovering || !hasUnconfirmedChanges()) return;
    if (!acknowledgeDiscard.checked) {
      recoveryMessage.textContent =
        "First save a backup or confirm these are disposable test changes.";
      return;
    }
    if (!navigator.onLine || cloudWritesPending > 0) {
      recoveryMessage.textContent = "Reconnect and finish pending writes first.";
      return;
    }
    if (!document.getElementById("modalLayer")?.classList.contains("hidden")) {
      recoveryMessage.textContent = "Close the trip editor before continuing.";
      return;
    }
    if (!window.confirm(
      "Discard this device's unconfirmed trip changes and reload the saved " +
      "version from Supabase? Changes in the downloaded backup will NOT " +
      "automatically be restored."
    )) return;

    recovering = true;
    discardButton.disabled = true;
    recoveryMessage.textContent = "Checking the account and reloading cloud trips...";
    try {
      const currentId = await verifyAccount();
      // This operation replaces local trips ONLY after a successful cloud
      // read with the same account and no intervening local writes.
      await refreshCloudTripsSafely(currentId, { discardUnsaved: true });
      recoveryPanel.hidden = true;
      acknowledgeDiscard.checked = false;
      view.setStatus("saved", "Trips refreshed — local test edits discarded");
    } catch (error) {
      recoveryMessage.textContent =
        "Recovery was not completed: " + (error.message || String(error));
      view.setStatus("error", "Unsaved changes — recovery not completed");
    } finally {
      recovering = false;
      discardButton.disabled = false;
      redraw();
    }
  }

  compareButton.addEventListener("click", () => void compareUnsavedTrip());
  compareTripSelect.addEventListener("change", () => {
    clearComparison();
    recoveryMessage.textContent = "";
  });
  acceptCloudButton.addEventListener("click",
    () => void chooseConflictVersion("cloud"));
  acceptLocalButton.addEventListener("click",
    () => void chooseConflictVersion("local"));
  refreshButton.addEventListener("click", () => void refreshTrips());
  reviewButton.addEventListener("click", showRecovery);
  closeRecoveryButton.addEventListener("click", () => {
    recoveryPanel.hidden = true;
  });
  downloadBackupButton.addEventListener("click", () => {
    try {
      downloadUnsavedBackup();
    } catch (error) {
      recoveryMessage.textContent = "Backup failed: " + (error.message || String(error));
    }
  });
  discardButton.addEventListener("click", () => void discardAndRefresh());

  window.addEventListener("online", redraw);
  window.addEventListener("offline", redraw);
  new MutationObserver(redraw).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });

  window.addEventListener("beforeunload", (event) => {
    if (!cloudUserId ||
        (cloudWritesPending === 0 && !cloudSaveError &&
         cloudUnsavedTripIds.size === 0)) return;
    event.preventDefault();
    event.returnValue = "";
  });
  redraw();
})();
