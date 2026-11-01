"use strict";

/* Cross-device conflict review. Never merge or overwrite without an
   explicit choice. This module uses the existing per-trip updated_at
   compare-and-swap; the server-side revision migration is still pending. */
(() => {
  const clone = (value) => value == null ? null : JSON.parse(JSON.stringify(value));

  function assertReady(id) {
    if (!cloudReady || !cloudUserId || !id ||
        !cloudUnsavedTripIds.has(id)) {
      throw new Error("This trip no longer has an unresolved save.");
    }
    if (!navigator.onLine) throw new Error("Reconnect before reviewing cloud changes.");
    if (cloudWritesPending > 0) {
      throw new Error("Wait for current trip saves to finish.");
    }
  }

  function assertReviewFresh(review, expectedGeneration) {
    if (!review || cloudUserId !== review.userId ||
        cloudEpoch !== review.epoch || !cloudReady ||
        cloudWriteGeneration !== expectedGeneration ||
        !cloudUnsavedTripIds.has(review.id)) {
      throw new Error("The trip or account changed. Review the latest versions again.");
    }
    const local = trips.find((item) => item.id === review.id) || null;
    if (JSON.stringify(local) !== JSON.stringify(review.local)) {
      throw new Error("Local trip changed. Review it again before resolving.");
    }
  }

  async function readCloudRow(id, userId) {
    const { data, error } = await supabaseClient
      .from("trips")
      .select("id, trip_data, updated_at")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("Could not compare with the cloud: " + error.message);
    return data;
  }

  async function review(id) {
    assertReady(id);
    const userId = cloudUserId;
    const epoch = cloudEpoch;
    const generation = cloudWriteGeneration;
    const local = clone(trips.find((item) => item.id === id) || null);
    const row = await readCloudRow(id, userId);
    const result = {
      id, userId, epoch, generation, local,
      remote: row?.trip_data && typeof row.trip_data === "object"
        ? clone({ ...row.trip_data, id: row.id }) : null,
      updatedAt: row?.updated_at ?? null,
    };
    assertReviewFresh(result, generation);
    return result;
  }

  function finishResolution(id, message) {
    cloudUnsavedTripIds.delete(id);
    cloudTripSaveSequence.delete(id);
    if (cloudUnsavedTripIds.size === 0) {
      cloudSaveError = null;
      // The old rejected queue has settled; allow logout/update checks again.
      if (cloudWritesPending === 0) cloudWriteQueue = Promise.resolve();
      window.voyafundraUX?.setStatus("saved", message);
    } else {
      window.voyafundraUX?.setStatus("error",
        "Other trip edits are still unconfirmed — review them too");
    }
  }

  async function useCloud(reviewed) {
    if (!reviewed) throw new Error("Review the latest versions first.");
    assertReady(reviewed.id);
    assertReviewFresh(reviewed, reviewed.generation);
    const row = await readCloudRow(reviewed.id, reviewed.userId);
    assertReviewFresh(reviewed, reviewed.generation);
    if ((row?.updated_at ?? null) !== reviewed.updatedAt) {
      throw new Error("Cloud version changed again. Compare both versions again.");
    }

    const idx = trips.findIndex((item) => item.id === reviewed.id);
    if (row && row.trip_data && typeof row.trip_data === "object") {
      const remote = clone({ ...row.trip_data, id: row.id });
      if (idx >= 0) trips[idx] = remote;
      else trips.unshift(remote);
      cloudTripVersions.set(reviewed.id, row.updated_at);
    } else {
      // A deletion on the other device is also an explicit choice to accept.
      if (idx >= 0) trips.splice(idx, 1);
      cloudTripVersions.delete(reviewed.id);
      if (selectedTripId === reviewed.id) selectedTripId = null;
    }
    finishResolution(reviewed.id, "Cloud version accepted for this trip");
    render();
    return true;
  }

  async function useLocal(reviewed) {
    if (!reviewed) throw new Error("Review the latest versions first.");
    assertReady(reviewed.id);
    assertReviewFresh(reviewed, reviewed.generation);
    if (!reviewed.local || !reviewed.remote || !reviewed.updatedAt) {
      throw new Error("A cloud trip was deleted or is missing; export your draft instead.");
    }

    const userId = cloudUserId;
    const epoch = cloudEpoch;
    const snapshot = clone(reviewed.local);
    const generation = ++cloudWriteGeneration;
    cloudWritesPending += 1;
    const sequence = (cloudTripSaveSequence.get(reviewed.id) || 0) + 1;
    cloudTripSaveSequence.set(reviewed.id, sequence);
    window.voyafundraUX?.setStatus("saving", "Saving your chosen trip version...");

    const task = cloudWriteQueue.catch(() => {}).then(async () => {
      assertReviewFresh(reviewed, generation);
      const updatedAt = new Date(Math.max(
        Date.now(), Date.parse(reviewed.updatedAt) + 1
      )).toISOString();

      // Atomic conditional write: if the other device changed anything after
      // the review, zero rows match and the local copy remains unsaved.
      const { data, error } = await supabaseClient
        .from("trips")
        .update({ trip_data: snapshot, updated_at: updatedAt })
        .eq("user_id", userId)
        .eq("id", reviewed.id)
        .eq("updated_at", reviewed.updatedAt)
        .select("updated_at");
      if (error) throw error;
      if (!data || data.length !== 1) {
        throw new Error("Cloud changed again; your version was not saved. Review again.");
      }
      if (cloudEpoch !== epoch || cloudUserId !== userId) return false;
      cloudTripVersions.set(reviewed.id, data[0].updated_at);
      // If another edit was queued in the meantime, it still needs saving.
      if (cloudTripSaveSequence.get(reviewed.id) === sequence) {
        finishResolution(reviewed.id, "Your chosen trip version saved");
      }
      return true;
    });

    cloudWriteQueue = task;
    try {
      return await task;
    } catch (error) {
      if (cloudEpoch === epoch && cloudUserId === userId) {
        cloudSaveError = error;
        window.voyafundraUX?.setStatus("error",
          "Conflict remains — your local changes were not overwritten");
      }
      throw error;
    } finally {
      if (cloudEpoch === epoch && cloudUserId === userId) {
        cloudWritesPending = Math.max(0, cloudWritesPending - 1);
        if (cloudWritesPending === 0 && cloudUnsavedTripIds.size === 0 &&
            !cloudSaveError) {
          cloudWriteQueue = Promise.resolve();
          window.voyafundraUX?.setStatus("saved", "All changes saved");
        }
      }
    }
  }

  window.voyafundraConflicts = { review, useCloud, useLocal };
})();
