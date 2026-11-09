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
   VOYAFUNDRA PASSWORD RECOVERY
========================================== */

const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const forgotEmail = document.getElementById("forgotEmail");
const sendResetBtn = document.getElementById("sendResetBtn");
const forgotBackBtn = document.getElementById("forgotBackBtn");
const resetPasswordForm = document.getElementById("resetPasswordForm");
const newPassword = document.getElementById("newPassword");
const confirmNewPassword = document.getElementById("confirmNewPassword");
const saveNewPasswordBtn = document.getElementById("saveNewPasswordBtn");
const resetBackBtn = document.getElementById("resetBackBtn");

// This marker prevents normal sign-in from loading private trips
// while Supabase is processing a recovery link.
const recoveryParameters = new URLSearchParams(window.location.search);
const recoveryHash = new URLSearchParams(window.location.hash.slice(1));
let recoveryActive =
  recoveryParameters.get("reset") === "1" ||
  recoveryHash.get("type") === "recovery";
let recoveryVerified = false;

function showSignInForm() {
  authForm.hidden = false;
  signUpBtn.hidden = false;
  forgotPasswordBtn.hidden = false;
  forgotPasswordForm.hidden = true;
  resetPasswordForm.hidden = true;
}

function showForgotPasswordForm() {
  authForm.hidden = true;
  signUpBtn.hidden = true;
  forgotPasswordBtn.hidden = true;
  resetPasswordForm.hidden = true;
  forgotPasswordForm.hidden = false;
  forgotEmail.value = authEmail.value.trim();
  showAuthMessage("");
  forgotEmail.focus();
}

function showRecoveryForm() {
  authForm.hidden = true;
  signUpBtn.hidden = true;
  forgotPasswordBtn.hidden = true;
  forgotPasswordForm.hidden = true;
  resetPasswordForm.hidden = false;
  setAuthenticated(false);
}

function clearRecoveryAddress() {
  // Recovery tokens should not remain in the displayed address.
  window.history.replaceState(null, "", window.location.pathname);
}

resetBackBtn.addEventListener("click", async () => {
  recoveryActive = false;
  recoveryVerified = false;
  clearRecoveryAddress();
  newPassword.value = "";
  confirmNewPassword.value = "";
  showSignInForm();
  try {
    // A recovery link can establish a temporary signed-in session.
    await supabaseClient.auth.signOut();
  } catch (error) {
    showAuthMessage("Could not exit the reset session. Reload the page.", "error");
    return;
  }
  showAuthMessage("You can request a fresh reset link if the previous one expired.");
});

forgotPasswordBtn.addEventListener("click", showForgotPasswordForm);
forgotBackBtn.addEventListener("click", () => {
  showSignInForm();
  showAuthMessage("");
});

forgotPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!forgotPasswordForm.reportValidity()) return;

  sendResetBtn.disabled = true;
  showAuthMessage("Requesting a password reset...");

  try {
    const redirectTo =
      window.location.origin + window.location.pathname + "?reset=1";
    const { error } = await supabaseClient.auth.resetPasswordForEmail(
      forgotEmail.value.trim(),
      { redirectTo },
    );
    if (error) throw error;

    // Same message whether or not the account exists.
    showAuthMessage(
      "If an account exists for this email, a reset link will be sent. Check your inbox and spam folder.",
      "success",
    );
  } catch (error) {
    showAuthMessage(
      error.message || "Could not send the reset link. Please try again.",
      "error",
    );
  } finally {
    sendResetBtn.disabled = false;
  }
});

resetPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!resetPasswordForm.reportValidity()) return;

  if (!recoveryVerified) {
    showAuthMessage(
      "This reset link could not be verified. Request a new reset email.",
      "error",
    );
    return;
  }

  if (newPassword.value !== confirmNewPassword.value) {
    showAuthMessage("Passwords do not match.", "error");
    return;
  }

  saveNewPasswordBtn.disabled = true;
  showAuthMessage("Updating password...");

  try {
    const { error } = await supabaseClient.auth.updateUser({
      password: newPassword.value,
    });
    if (error) throw error;

    newPassword.value = "";
    confirmNewPassword.value = "";
    recoveryActive = false;
    recoveryVerified = false;
    clearRecoveryAddress();
    showSignInForm();
    // End the temporary recovery session. The user must sign in again.
    const { error: signOutError } = await supabaseClient.auth.signOut();
    if (signOutError) throw signOutError;

    showAuthMessage(
      "Password updated. Sign in with your new password.",
      "success",
    );
  } catch (error) {
    showAuthMessage(
      error.message || "Password update failed. Try again.",
      "error",
    );
  } finally {
    saveNewPasswordBtn.disabled = false;
  }
});

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
  if (logoutInProgress) return;
  logoutInProgress = true;
  stopIdleTimer();
  logoutBtn.disabled = true;

  const userId = activeUserId;
  try {
    // A submitted edit can still fail after its promise settles. Never
    // equate "the queue is empty" with "everything reached Supabase".
    try {
      await waitForCloudSaves();
    } catch (saveError) {
      console.warn("Sign-out check found a failed cloud write:", saveError);
    }

    if (cloudWritesPending > 0 || window.voyafundraBackup?.isBusy?.()) {
      throw new Error("Wait for the backup restore or current saves to finish.");
    }
    // Full-account restoration uses its own write loop rather than the
    // ordinary per-trip queue. Never sign out while those writes are active.
    if (cloudWritesPending > 0 || window.voyafundraBackup?.isBusy?.()) {
      throw new Error("Wait for the current trip save or backup restore to finish.");
    }

    const openEditor = !document.getElementById("modalLayer")
      ?.classList.contains("hidden");
    if (openEditor) {
      throw new Error("Close or save the open form before signing out.");
    }

    const v2Status = window.voyafundraV2?.status?.();
    const unconfirmed = !!cloudSaveError || cloudUnsavedTripIds.size > 0 ||
      cloudRecoveryPendingDrafts.length > 0 || !!cloudRecoveryReadError ||
      !!v2Status?.unconfirmed;
    if (unconfirmed) {
      if (!isAutomatic) {
        window.voyafundraUX?.showRecovery?.();
        window.voyafundraUX?.showDrafts?.();
        window.voyafundraV2?.showDrafts?.();
        throw new Error(
          "Some trip changes have not been confirmed by Supabase. " +
          "Review the saved drafts or conflicts before logging out."
        );
      }

      // Privacy: automatic sign-out may proceed after inactivity ONLY when
      // all in-memory unsaved edits have verified persistent recovery copies.
      // Restored-but-unreviewed drafts stay stored for the next login.
      const stored = !!window.voyafundraDrafts &&
        window.voyafundraDrafts.covers(userId,
          Array.from(cloudUnsavedTripIds));
      if (!stored || cloudRecoveryStorageFaults.size > 0 ||
          cloudRecoveryReadError || v2Status?.protected === false ||
          (v2Status?.writes || 0) > 0) {
        throw new Error(
          "Session expiration delayed: unconfirmed edits have no verified local backup."
        );
      }
    }

    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    clearLastActivity(userId);
    if (isAutomatic) {
      console.log("Voyafundra: Session closed after inactivity.");
    }
    // Session listener clears only in-memory trip data. Stored recovery
    // drafts are scoped to this account and remain available at next login.
  } catch (error) {
    console.error("Logout paused:", error);
    if (isAutomatic) {
      // Keep the local copy available when browser storage is unavailable.
      // Retry the idle check in one minute instead of looping immediately.
      showAuthMessage(error.message +
        " Keep this browser tab open and secure the changes.", "error");
      window.voyafundraUX?.setStatus("error",
        "Automatic sign-out paused: unresolved edits need protection");
      idleTimer = setTimeout(() => void checkIdleTimeout(), 60 * 1000);
    } else {
      window.alert("Could not log out safely: " + error.message);
      scheduleIdleCheck();
    }
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

  if (recoveryActive) {
    // Reset links create a temporary Supabase auth session.
    // Do not treat that session as normal app sign-in.
    stopIdleTimer();
    activeUserId = null;
    clearCloudTrips();
    showRecoveryForm();
    if (!recoveryVerified) {
      showAuthMessage(
        "Verifying your reset link. If it does not complete, request a new link.",
      );
    }
    return;
  }
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
  if (event === "PASSWORD_RECOVERY") {
    recoveryActive = true;
    recoveryVerified = true;
    setTimeout(() => {
      showRecoveryForm();
      showAuthMessage("Reset link verified. Enter your new password.", "success");
    }, 0);
    return;
  }

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
