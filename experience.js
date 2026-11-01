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

  if (!status || !statusText || !refreshButton || !offlineBanner ||
      !reviewButton || !recoveryPanel || !recoveryDetails ||
      !recoveryMessage || !downloadBackupButton || !closeRecoveryButton ||
      !discardButton || !acknowledgeDiscard) return;

  let state = "loading";
  let lastMessage = "Checking cloud connection...";
  let refreshing = false;
  let recovering = false;

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
    if (!loggedIn || !unsaved) {
      recoveryPanel.hidden = true;
      acknowledgeDiscard.checked = false;
    } else if (!recoveryPanel.hidden) {
      updateRecoveryDetails();
    }
  }

  function showRecovery() {
    if (!hasUnconfirmedChanges() || !cloudReady) return;
    updateRecoveryDetails();
    recoveryMessage.textContent = "";
    recoveryPanel.hidden = false;
    recoveryPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
