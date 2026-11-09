"use strict";

/*
 * Explicit full-account trip backup / restore.
 *
 * Backups belong to the logged-in Supabase account, are downloaded locally,
 * and include savings, travel comparisons, checklist, and notes.
 * Restores are create-only: existing trip IDs are never overwritten/deleted.
 */
(() => {
  const panel = document.getElementById("tripBackupPanel");
  const exportBtn = document.getElementById("exportTripsBtn");
  const importInput = document.getElementById("importTripsFile");
  const restoreBtn = document.getElementById("restoreTripsBtn");
  const preview = document.getElementById("tripBackupPreview");
  const message = document.getElementById("tripBackupMessage");
  const approval = document.getElementById("approveTripRestore");
  if (!panel || !exportBtn || !importInput || !restoreBtn || !preview ||
      !message || !approval) return;

  const FORMAT = "voyafundra-trip-backup-v1";
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_TRIPS = 120;
  let restoring = false;
  let candidate = null;

  const text = (value, max = 500) => {
    if (typeof value !== "string" || value.length > max) {
      throw new Error("Backup contains an invalid text field.");
    }
    return value;
  };
  const optionalText = (value, max) => text(value ?? "", max);
  const number = (value, max = 1e10) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > max) {
      throw new Error("Backup contains an invalid amount.");
    }
    return n;
  };
  const validId = (value) => typeof value === "string" &&
    /^[A-Za-z0-9_.-]{1,150}$/.test(value);
  const safeDate = (value) => {
    if (value === "" || value == null) return "";
    if (!window.voyafundraInsights?.dateUTC(value)) {
      throw new Error("Backup contains an invalid date.");
    }
    return value;
  };

  function validateTrip(t) {
    if (!t || typeof t !== "object" || Array.isArray(t) ||
        !validId(t.id)) throw new Error("Invalid trip record in backup.");
    const people = (Array.isArray(t.people) ? t.people : []).map((p) => {
      if (!p || !validId(p.id)) throw new Error("Invalid saver ID.");
      return {
        id: p.id,
        name: text(p.name, 120),
        monthlyTarget: number(p.monthlyTarget ?? 0),
      };
    });
    if (people.length > 30) throw new Error("Too many savers.");
    const options = (Array.isArray(t.options) ? t.options : []).map((option) => {
      if (!option || !validId(option.id)) throw new Error("Invalid travel option.");
      return {
        id: option.id, name: text(option.name, 200),
        ticket: number(option.ticket ?? 0), dollars: number(option.dollars ?? 0),
        rate: number(option.rate ?? 0), stay: number(option.stay ?? 0),
        other: number(option.other ?? 0),
      };
    });
    if (options.length > 150) throw new Error("Too many travel options.");
    const savings = (Array.isArray(t.savings) ? t.savings : []).map((row) => {
      if (!row || !validId(row.id)) throw new Error("Invalid savings entry.");
      const contributions = Object.create(null);
      if (row.contributions && typeof row.contributions === "object") {
        for (const [personId, contribution] of Object.entries(row.contributions)) {
          if (!validId(personId) || !contribution || typeof contribution !== "object") {
            throw new Error("Invalid savings contribution.");
          }
          contributions[personId] = {
            planned: number(contribution.planned ?? 0),
            saved: number(contribution.saved ?? 0),
          };
        }
      }
      return {
        id: row.id, month: text(row.month, 35), contributions,
        // Preserve legacy savings in older exports.
        planA: number(row.planA ?? 0), savedA: number(row.savedA ?? 0),
        planB: number(row.planB ?? 0), savedB: number(row.savedB ?? 0),
      };
    });
    if (savings.length > 120) throw new Error("Too many savings entries.");
    const checklist = (Array.isArray(t.checklist) ? t.checklist : []).map((item) => {
      if (!item || !validId(item.id)) throw new Error("Invalid checklist item.");
      return {
        id: item.id, title: text(item.title, 160),
        done: item.done === true, dueDate: safeDate(item.dueDate ?? ""),
      };
    });
    if (checklist.length > 100) throw new Error("Too many checklist tasks.");
    const status = t.status ?? "Planning";
    if (!["Planning", "Upcoming", "Completed"].includes(status)) {
      throw new Error("Invalid trip status.");
    }
    const monthCount = Number(t.monthCount ?? 0);
    if (!Number.isInteger(monthCount) || monthCount < 0 || monthCount > 60) {
      throw new Error("Invalid savings month count.");
    }
    const startMonth = t.startMonth ?? "";
    if (startMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) {
      throw new Error("Invalid starting month.");
    }
    return {
      id: t.id,
      name: text(t.name, 160),
      destination: text(t.destination, 250),
      budget: number(t.budget ?? 0),
      status,
      departure: safeDate(t.departure),
      returnDate: safeDate(t.returnDate),
      startMonth,
      monthCount,
      notes: optionalText(t.notes, 4000),
      createdAt: optionalText(t.createdAt, 60),
      people, options, savings, checklist,
      personA: optionalText(t.personA, 120),
      personB: optionalText(t.personB, 120),
    };
  }

  function parseBackup(raw, userId) {
    if (typeof raw !== "string" || raw.length > MAX_FILE_BYTES) {
      throw new Error("Backup file exceeds the allowed size.");
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("The selected file is not valid JSON."); }
    if (!parsed || parsed.format !== FORMAT ||
        !validId(parsed.account_id) || parsed.account_id !== userId ||
        !Array.isArray(parsed.trips) || parsed.trips.length > MAX_TRIPS) {
      throw new Error("This is not a supported backup for the signed-in account.");
    }
    const tripList = parsed.trips.map(validateTrip);
    const ids = tripList.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Backup contains duplicate trip IDs.");
    }
    return { format: FORMAT, account_id: parsed.account_id, trips: tripList };
  }

  function readyForTransfer() {
    if (!cloudReady || !cloudUserId || cloudWritesPending > 0 ||
        cloudSaveError || cloudUnsavedTripIds.size ||
        cloudRecoveryPendingDrafts.length || cloudRecoveryReadError ||
        window.voyafundraV2?.status?.().unconfirmed || restoring) {
      throw new Error("Resolve all pending, failed, or recovered trip edits first.");
    }
    if (!document.getElementById("modalLayer")?.classList.contains("hidden")) {
      throw new Error("Close the trip editor before backing up or restoring.");
    }
  }

  const download = (payload, filename) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }));
    const a = document.createElement("a");
    a.download = filename;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  };

  async function verifyAccount(expectedUser) {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error || !data?.user || data.user.id !== expectedUser) {
      throw new Error("Account changed while preparing the backup.");
    }
  }

  async function exportAll() {
    readyForTransfer();
    exportBtn.disabled = true;
    message.textContent = "Verifying your account and exporting saved cloud trips...";
    try {
      const userId = cloudUserId;
      const epoch = cloudEpoch;
      await verifyAccount(userId);
      // Always read cloud records rather than exporting possibly stale UI state.
      const { data, error } = await supabaseClient.from("trips")
        .select("id, trip_data").eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (epoch !== cloudEpoch || cloudUserId !== userId) {
        throw new Error("Account changed during export.");
      }
      const saved = (data || []).map((row) => validateTrip({
        ...row.trip_data, id: row.id,
      }));
      if (saved.length > MAX_TRIPS) throw new Error("Too many trips to export.");
      download({
        format: FORMAT,
        created_at: new Date().toISOString(),
        account_id: userId,
        trips: saved,
      }, "voyafundra-all-trips-" + new Date().toISOString().slice(0, 10) + ".json");
      message.textContent = "Backup download requested. Keep the file private.";
    } catch (error) {
      message.textContent = "Export failed: " + (error.message || String(error));
    } finally {
      exportBtn.disabled = false;
    }
  }

  function updatePreview() {
    if (!candidate) {
      preview.textContent = "Choose a Voyafundra full backup to preview its contents.";
      restoreBtn.disabled = true;
      return;
    }
    const existing = new Set(trips.map((item) => item.id));
    const missing = candidate.trips.filter((item) => !existing.has(item.id));
    preview.textContent = candidate.trips.length + " trip(s) in backup; " +
      missing.length + " missing trip(s) eligible to restore. Existing trips " +
      "will be skipped without overwriting.\n" +
      missing.map((item) => "• " + item.name + " — " + item.destination)
        .join("\n");
    restoreBtn.disabled = !missing.length || !approval.checked || restoring;
  }

  async function readFile() {
    candidate = null;
    approval.checked = false;
    restoreBtn.disabled = true;
    const file = importInput.files?.[0];
    if (!file) return updatePreview();
    try {
      readyForTransfer();
      if (file.size > MAX_FILE_BYTES) throw new Error("Backup file is too large.");
      candidate = parseBackup(await file.text(), cloudUserId);
      updatePreview();
      message.textContent = "Preview ready. Nothing has been written.";
    } catch (error) {
      preview.textContent = "";
      message.textContent = "Cannot import: " + (error.message || String(error));
    }
  }

  async function restoreMissing() {
    if (!candidate || !approval.checked || restoring) return;
    readyForTransfer();
    const userId = cloudUserId;
    if (candidate.account_id !== userId) throw new Error("Wrong account backup.");
    const missing = candidate.trips.filter((t) => !trips.some((live) => live.id === t.id));
    if (!missing.length) return updatePreview();
    if (!window.confirm("Restore " + missing.length + " missing trip(s) to this " +
      "account? Existing trips are never replaced. Continue?")) return;

    restoring = true;
    cloudWritesPending++;
    cloudWriteGeneration++;
    restoreBtn.disabled = true;
    let restored = 0;
    try {
      const epoch = cloudEpoch;
      await verifyAccount(userId);
      for (const trip of missing) {
        if (epoch !== cloudEpoch || userId !== cloudUserId) {
          throw new Error("Account changed during restore.");
        }
        const { data, error } = await supabaseClient.from("trips")
          .insert({ id: trip.id, user_id: userId, trip_data: trip })
          .select("id, updated_at, revision");
        if (error) throw error;
        if (!data || data.length !== 1) throw new Error("Restore wasn't confirmed.");
        cloudTripVersions.set(trip.id, data[0].updated_at);
        cloudTripRevisions.set(trip.id, data[0].revision);
        trips.unshift(trip);
        restored++;
        render();
      }
      message.textContent = restored + " missing trip(s) restored. Existing trips unchanged.";
      candidate = null;
      importInput.value = "";
      approval.checked = false;
    } catch (error) {
      message.textContent = restored + " restored before an error: " +
        (error.message || String(error)) + ". Refresh after verifying cloud status.";
    } finally {
      restoring = false;
      cloudWritesPending = Math.max(0, cloudWritesPending - 1);
      updatePreview();
    }
  }

  exportBtn.addEventListener("click", () => void exportAll());
  importInput.addEventListener("change", () => void readFile());
  approval.addEventListener("change", updatePreview);
  restoreBtn.addEventListener("click", () => void restoreMissing().catch((error) => {
    message.textContent = "Restore cancelled: " + (error.message || String(error));
  }));
  window.voyafundraBackup = {
    parseBackup, validateTrip,
    isBusy: () => restoring,
  };
})();
