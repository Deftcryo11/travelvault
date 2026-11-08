"use strict";

/*
 * Per-account, per-trip emergency journal.
 *
 * Write synchronously BEFORE starting a cloud request, then remove only after
 * confirmed successful persistence (or a user's explicit discard).
 * These drafts are NOT encrypted and remain in this browser's origin storage.
 * Never store passwords, access tokens, or Supabase secrets here.
 */
(() => {
  const PREFIX = "voyafundra.recovery.v1.";
  const MAX_ENTRY_BYTES = 400 * 1024;
  const MAX_ACCOUNT_BYTES = 2 * 1024 * 1024;
  const MAX_ACCOUNT_DRAFTS = 40;

  const validId = (value) =>
    typeof value === "string" && value.length > 0 &&
    value.length <= 150 && /^[A-Za-z0-9_.-]+$/.test(value);
  const prefixFor = (userId) => {
    if (!validId(userId)) throw new Error("Invalid account for recovery storage.");
    return PREFIX + userId + ".";
  };
  const storageKey = (userId, tripId) => {
    if (!validId(tripId)) throw new Error("Invalid trip for recovery storage.");
    return prefixFor(userId) + tripId;
  };
  const byteSize = (value) => new TextEncoder().encode(value).length;
  const copy = (value) => JSON.parse(JSON.stringify(value));

  function readEntry(userId, tripId) {
    const raw = localStorage.getItem(storageKey(userId, tripId));
    if (raw === null) return null;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("A saved recovery draft is damaged. Do not clear site data.");
    }
    if (value?.schema !== "voyafundra-recovery-v1" ||
        value.userId !== userId || value.tripId !== tripId ||
        typeof value.token !== "string" ||
        (value.action !== "save" && value.action !== "delete") ||
        (value.action === "save" && (!value.trip || value.trip.id !== tripId))) {
      throw new Error("Recovery draft format is invalid. Do not clear site data.");
    }
    return value;
  }

  function list(userId) {
    const prefix = prefixFor(userId);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (typeof key === "string" && key.startsWith(prefix)) keys.push(key);
    }
    // A missing/damaged entry must not silently be deleted.
    return keys.sort().map((key) => readEntry(userId, key.slice(prefix.length)));
  }

  function record(userId, tripId, action, trip, baseVersion) {
    if (action !== "save" && action !== "delete") {
      throw new Error("Unsupported recovery draft action.");
    }
    const existing = readEntry(userId, tripId);
    if (action === "save" && (!trip || trip.id !== tripId)) {
      throw new Error("Recovery draft and trip IDs do not match.");
    }
    // Preserve the earliest known cloud version across queued writes.
    // If the first save was acknowledged but a later one was interrupted,
    // a stale version will cause an explicit conflict rather than data loss.
    const token = Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2);
    const entry = {
      schema: "voyafundra-recovery-v1",
      userId, tripId, action,
      trip: action === "save" ? copy(trip) : null,
      baseVersion: existing ? existing.baseVersion : (baseVersion ?? null),
      writtenAt: new Date().toISOString(),
      token,
    };
    const raw = JSON.stringify(entry);
    const size = byteSize(raw);
    if (size > MAX_ENTRY_BYTES) {
      throw new Error("Trip draft exceeds the local recovery size limit.");
    }
    const current = list(userId).filter((item) => item.tripId !== tripId);
    if (current.length >= MAX_ACCOUNT_DRAFTS ||
        current.reduce((total, item) => total + byteSize(JSON.stringify(item)), size) >
          MAX_ACCOUNT_BYTES) {
      throw new Error("Local recovery storage is full; export existing drafts.");
    }
    localStorage.setItem(storageKey(userId, tripId), raw);
    if (readEntry(userId, tripId)?.token !== token) {
      throw new Error("Could not verify that this draft was saved locally.");
    }
    return token;
  }

  function forget(userId, tripId, token) {
    const existing = readEntry(userId, tripId);
    if (!existing) return false;
    // A previous queued save must never erase a newer draft.
    if (token && existing.token !== token) return false;
    localStorage.removeItem(storageKey(userId, tripId));
    if (localStorage.getItem(storageKey(userId, tripId)) !== null) {
      throw new Error("Could not clear the recovery draft.");
    }
    return true;
  }

  function covers(userId, ids) {
    try {
      return ids.every((id) => {
        const saved = readEntry(userId, id);
        return !!saved && saved.action === "save" &&
          saved.trip?.id === id;
      });
    } catch {
      return false;
    }
  }

  window.voyafundraDrafts = { record, list, forget, readEntry, covers };
})();
