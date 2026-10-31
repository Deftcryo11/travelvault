"use strict";

/*
  Voyafundra update prompt, adapted from Penvoria's user-approved update UX.
  Compare the deployed application's public, same-origin source assets.
  This avoids service-worker caching private trips and works for both browser
  and iPhone Home Screen installs. A changed deployed asset prompts to reload.
*/
(() => {
  const notice = document.getElementById("versionUpdateNotice");
  const applyButton = document.getElementById("applyVersionUpdate");
  const laterButton = document.getElementById("deferVersionUpdate");
  const message = document.getElementById("versionUpdateMessage");
  if (!notice || !applyButton || !laterButton || !message) return;

  // Detect HTML, desktop/mobile styling, authentication and app code changes.
  // Fetch source files without involving any private Supabase data.
  const FILES = [
    "index.html", "app.js", "auth.js", "styles.css",
    "mobile.css", "mobile.js", "experience.css", "experience.js",
    "pwa-updates.js", "manifest.webmanifest"
  ];
  const CHECK_INTERVAL_MS = 120000;
  let baseline = null;
  let pendingVersion = null;
  let dismissedVersion = null;
  let checking = false;
  let applying = false;

  // Lightweight deterministic hash. Not a security hash; only change detection.
  function fingerprint(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  async function deployedVersion() {
    // A protected Vercel preview may redirect assets to Vercel SSO.
    // If any asset is inaccessible, skip this check rather than showing
    // a misleading update prompt.
    const parts = await Promise.all(FILES.map(async (path) => {
      const assetUrl = new URL(path, document.baseURI);
      const response = await fetch(assetUrl, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "follow"
      });
      const finalUrl = new URL(response.url);
      if (!response.ok || finalUrl.origin !== location.origin ||
          finalUrl.pathname !== assetUrl.pathname) {
        throw new Error("Update check asset unavailable: " + path);
      }
      const source = await response.text();
      return path + ":" + source.length + ":" + fingerprint(source);
    }));
    return fingerprint(parts.join("|"));
  }

  function blocker() {
    if (!navigator.onLine) return "Reconnect to the internet before updating.";
    if (document.body.classList.contains("auth-pending")) {
      return "Finish loading your account before updating.";
    }
    if (document.body.classList.contains("authenticated")) {
      if (typeof cloudReady === "undefined" || !cloudReady) {
        return "Your cloud workspace is still loading.";
      }
      if (typeof cloudSaveError !== "undefined" && cloudSaveError) {
        return "A cloud save failed. Resolve unsaved trip changes before updating.";
      }
      if (typeof cloudWritesPending !== "undefined" && cloudWritesPending > 0) {
        return "Trip changes are still saving. Try again when all changes are saved.";
      }
    }
    const modal = document.getElementById("modalLayer");
    if (modal && !modal.classList.contains("hidden")) {
      return "Finish or close the trip editor before updating.";
    }
    return null;
  }

  async function checkForUpdate() {
    if (checking || !navigator.onLine || document.hidden || applying) return;
    checking = true;
    try {
      const version = await deployedVersion();
      if (baseline === null) {
        baseline = version;
      } else if (version !== baseline) {
        pendingVersion = version;
        if (version !== dismissedVersion) {
          notice.hidden = false;
          message.textContent = "";
        }
      } else {
        pendingVersion = null;
        notice.hidden = true;
      }
    } catch (error) {
      // Authentication-protected previews and transient network errors
      // should not interrupt a running trip editor.
      console.debug("Voyafundra update check unavailable:", error.message);
    } finally {
      checking = false;
    }
  }

  applyButton.addEventListener("click", async () => {
    if (applying || !pendingVersion) return;
    applying = true;
    applyButton.disabled = true;
    message.textContent = "Checking trip changes before updating...";

    try {
      // Wait for queued writes and respect any cloud error.
      if (typeof waitForCloudSaves === "function") {
        await waitForCloudSaves();
      }
      const reason = blocker();
      if (reason) {
        message.textContent = reason;
        return;
      }
      // The selected update should still exist on the server.
      const latest = await deployedVersion();
      if (latest === baseline) {
        message.textContent = "The update is no longer available.";
        pendingVersion = null;
        notice.hidden = true;
        return;
      }
      message.textContent = "Opening the updated version...";
      window.location.reload();
    } catch (error) {
      message.textContent = "Update paused: " + (error.message || String(error));
    } finally {
      applying = false;
      applyButton.disabled = false;
    }
  });

  laterButton.addEventListener("click", () => {
    dismissedVersion = pendingVersion;
    notice.hidden = true;
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void checkForUpdate();
  });
  window.addEventListener("focus", () => void checkForUpdate());
  window.addEventListener("online", () => void checkForUpdate());

  // Initial snapshot then periodic checks; no automatic page reload.
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
})();
