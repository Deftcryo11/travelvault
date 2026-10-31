"use strict";

/* Penvoria-inspired connection feedback with safe, explicit refresh.
   This does not cache private trip data or auto-merge multi-device changes. */
(() => {
  const status = document.querySelector(".cloud-status");
  const statusText = document.getElementById("cloudStatusText");
  const refreshButton = document.getElementById("refreshTripsBtn");
  const offlineBanner = document.getElementById("connectionBanner");
  if (!status || !statusText || !refreshButton || !offlineBanner) return;

  let state = "loading";
  let lastMessage = "Checking cloud connection...";
  let refreshing = false;
  const view = {
    setStatus(nextState, message) {
      state = nextState;
      lastMessage = message;
      redraw();
    }
  };
  window.voyafundraUX = view;

  function redraw() {
    const offline = !navigator.onLine;
    const loggedIn = document.body.classList.contains("authenticated");
    offlineBanner.hidden = !offline || !loggedIn;
    status.dataset.state = offline ? "offline" : state;
    statusText.textContent = offline
      ? "Offline — cloud access unavailable"
      : lastMessage;
    refreshButton.disabled = offline || refreshing || !loggedIn || !cloudReady;
  }

  async function refreshTrips() {
    if (refreshing || !navigator.onLine || !cloudReady || !cloudUserId) return;
    if (cloudWritesPending > 0) {
      view.setStatus("saving", "Wait for current saves before refreshing");
      return;
    }
    if (cloudSaveError) {
      view.setStatus("error", "Unsaved changes detected — refresh blocked");
      alert("Cloud saving previously failed. Refresh could discard unsaved trip changes. Keep this page open and resolve the save failure first.");
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
      if (cloudSaveError || cloudWritesPending > 0) {
        throw new Error("An unsaved trip change is still pending.");
      }
      const { data, error } = await supabaseClient.auth.getUser();
      if (error || !data.user || data.user.id !== cloudUserId) {
        throw new Error("Your session has changed. Sign in again.");
      }
      const loaded = await refreshCloudTripsSafely(data.user.id);
      if (!loaded) throw new Error("A different account session interrupted refresh.");
      view.setStatus("saved", "Trips refreshed from the cloud");
    } catch (error) {
      view.setStatus("error", error.message || "Unable to refresh trips");
    } finally {
      refreshing = false;
      redraw();
    }
  }

  refreshButton.addEventListener("click", () => void refreshTrips());
  window.addEventListener("online", redraw);
  window.addEventListener("offline", redraw);
  new MutationObserver(redraw).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"]
  });

  window.addEventListener("beforeunload", (event) => {
    if (!cloudUserId || (cloudWritesPending === 0 && !cloudSaveError)) return;
    event.preventDefault();
    event.returnValue = "";
  });
  redraw();
})();
