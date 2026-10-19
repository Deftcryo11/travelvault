"use strict";

/* ==========================================
   TRAVELVAULT AUTHENTICATION
========================================== */

const authScreen = document.getElementById("authScreen");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authMessage = document.getElementById("authMessage");

const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const logoutBtn = document.getElementById("logoutBtn");

/* ==========================================
   SESSION SETTINGS
========================================== */

const IDLE_TIMEOUT = 30 * 60 * 1000;
const ACTIVITY_THROTTLE = 3000;

let activeUserId = null;
let authSequence = 0;

let idleTimer = null;
let lastActivityRecorded = 0;
let logoutInProgress = false;

/* ==========================================
   AUTH UI
========================================== */

function showAuthMessage(message, type = "") {
  authMessage.textContent = message;
  authMessage.className = `auth-message ${type}`;
}

function setAuthenticated(authenticated) {
  document.body.classList.toggle("authenticated", authenticated);

  authScreen.classList.toggle("hidden", authenticated);

  logoutBtn.hidden = !authenticated;

  // Remove the loading screen only after
  // the correct account state is ready.
  document.body.classList.remove("auth-pending");

  if (authenticated) {
    authPassword.value = "";
    showAuthMessage("");
  }
}

function showAuthLoading(message) {
  document.body.classList.add("auth-pending");

  const loadingText = document.querySelector(".loading-content p");

  if (loadingText) {
    loadingText.textContent = message;
  }
}

/* ==========================================
   ACTIVITY STORAGE
========================================== */

function activityKey(userId) {
  return `travelvault.lastActivity.${userId}`;
}

function getLastActivity(userId) {
  try {
    return Number(localStorage.getItem(activityKey(userId))) || 0;
  } catch {
    return 0;
  }
}

function setLastActivity(userId, timestamp) {
  try {
    localStorage.setItem(activityKey(userId), String(timestamp));
  } catch {
    // Storage may be disabled.
  }
}

function clearLastActivity(userId) {
  if (!userId) return;

  try {
    localStorage.removeItem(activityKey(userId));
  } catch {
    // Ignore storage cleanup errors.
  }
}

/* ==========================================
   INACTIVITY TIMER
========================================== */

function stopIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleCheck() {
  stopIdleTimer();

  if (!activeUserId || !cloudReady) {
    return;
  }

  const lastActivity = getLastActivity(activeUserId);
  const elapsed = Date.now() - lastActivity;

  const remaining = Math.max(0, IDLE_TIMEOUT - elapsed);

  idleTimer = setTimeout(() => {
    void checkIdleTimeout();
  }, remaining);
}

async function checkIdleTimeout() {
  if (!activeUserId || !cloudReady) {
    return;
  }

  const lastActivity = getLastActivity(activeUserId);

  if (Date.now() - lastActivity >= IDLE_TIMEOUT) {
    await logoutUser(true);
  } else {
    scheduleIdleCheck();
  }
}

function recordActivity() {
  if (!activeUserId || !cloudReady || logoutInProgress) {
    return;
  }

  const now = Date.now();

  if (now - lastActivityRecorded < ACTIVITY_THROTTLE) {
    return;
  }

  lastActivityRecorded = now;

  setLastActivity(activeUserId, now);
  scheduleIdleCheck();
}

function startIdleTracking(userId) {
  activeUserId = userId;

  // Preserve an existing activity timestamp
  // when restoring a session after refresh.
  if (!getLastActivity(userId)) {
    setLastActivity(userId, Date.now());
  }

  lastActivityRecorded = 0;
  scheduleIdleCheck();
}

/* ==========================================
   SIGN OUT
========================================== */

async function logoutUser(isAutomatic = false) {
  if (logoutInProgress) {
    return;
  }

  logoutInProgress = true;
  stopIdleTimer();

  logoutBtn.disabled = true;

  const userId = activeUserId;

  try {
    // Finish pending trip saves before logout.
    await waitForCloudSaves();

    const { error } = await supabaseClient.auth.signOut();

    if (error) {
      throw error;
    }

    clearLastActivity(userId);

    if (isAutomatic) {
      console.log("TravelVault: Logged out after 30 minutes of inactivity.");
    }

    // The Supabase auth listener will clear
    // the dashboard and show the login page.
  } catch (error) {
    console.error("Logout failed:", error);

    if (isAutomatic) {
      showAuthMessage(
        "Your session timed out, but logout failed. " +
          "Please check your connection.",
        "error",
      );

      // Keep the app hidden until logout succeeds.
      showAuthLoading("Session expired. Checking logout...");

      setTimeout(() => {
        logoutInProgress = false;
        void logoutUser(true);
      }, 10000);

      return;
    }

    window.alert(`Could not log out safely: ${error.message}`);

    scheduleIdleCheck();
  } finally {
    logoutBtn.disabled = false;
    logoutInProgress = false;
  }
}

logoutBtn.addEventListener("click", () => {
  void logoutUser(false);
});

/* ==========================================
   AUTHENTICATION SESSION
========================================== */

async function handleAuthSession(session) {
  const sequence = ++authSequence;
  const user = session?.user;

  if (!user) {
    stopIdleTimer();

    activeUserId = null;

    clearCloudTrips();
    setAuthenticated(false);

    return;
  }

  // A loaded session does not need reloading.
  if (activeUserId === user.id && cloudReady) {
    return;
  }

  showAuthLoading("Loading your trips...");

  const lastActivity = getLastActivity(user.id);

  // Do not restore a session that has been
  // inactive for 30 minutes or longer.
  if (lastActivity && Date.now() - lastActivity >= IDLE_TIMEOUT) {
    activeUserId = user.id;

    await logoutUser(true);
    return;
  }

  try {
    const loaded = await loadCloudTrips(user);

    if (sequence !== authSequence || !loaded) {
      return;
    }

    startIdleTracking(user.id);
    setAuthenticated(true);

    console.log("TravelVault: Account and trips loaded.");
  } catch (error) {
    if (sequence !== authSequence) {
      return;
    }

    activeUserId = null;

    stopIdleTimer();
    clearCloudTrips();
    setAuthenticated(false);

    showAuthMessage(error.message || "Could not load your trips.", "error");
  }
}

/* ==========================================
   SIGN IN
========================================== */

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  signInBtn.disabled = true;
  showAuthMessage("Signing in...");

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: authEmail.value.trim(),
      password: authPassword.value,
    });

    if (error) {
      throw error;
    }

    // Auth listener handles the dashboard.
  } catch (error) {
    showAuthMessage(error.message, "error");
  } finally {
    signInBtn.disabled = false;
  }
});

/* ==========================================
   SIGN UP
========================================== */

signUpBtn.addEventListener("click", async () => {
  if (!authForm.reportValidity()) {
    return;
  }

  signUpBtn.disabled = true;
  showAuthMessage("Creating your account...");

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email: authEmail.value.trim(),
      password: authPassword.value,

      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });

    if (error) {
      throw error;
    }

    if (!data.session) {
      showAuthMessage("Check your email for a confirmation link.", "success");
    }
  } catch (error) {
    showAuthMessage(error.message, "error");
  } finally {
    signUpBtn.disabled = false;
  }
});

/* ==========================================
   USER ACTIVITY LISTENERS
========================================== */

["pointerdown", "keydown", "scroll", "mousemove", "touchstart"].forEach(
  (eventName) => {
    document.addEventListener(eventName, recordActivity, { passive: true });
  },
);

// Check when returning to an inactive tab.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void checkIdleTimeout();
  }
});

// Check the persisted timeout when returning
// to a page from the browser's back/forward cache.
window.addEventListener("pageshow", () => {
  void checkIdleTimeout();
});

// React to activity updates from another
// tab on the same browser origin.
window.addEventListener("storage", (event) => {
  if (activeUserId && event.key === activityKey(activeUserId)) {
    scheduleIdleCheck();
  }
});

/* ==========================================
   SUPABASE AUTH LISTENER
========================================== */

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (
    event === "INITIAL_SESSION" ||
    event === "SIGNED_IN" ||
    event === "SIGNED_OUT"
  ) {
    // Avoid running async Supabase queries
    // directly inside the auth callback.
    setTimeout(() => {
      void handleAuthSession(session);
    }, 0);
  }
});
