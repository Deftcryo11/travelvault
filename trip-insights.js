"use strict";

/* Pure financial, countdown, and checklist helpers shared by desktop/iPhone.
 * All date math uses calendar dates in UTC; no timezone-shifted deadlines.
 * No network, authentication, or database calls. */
(() => {
  const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  const amount = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };
  const dateUTC = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split("-").map(Number);
    if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 ||
        date.getUTCDate() !== d) return null;
    return date;
  };
  const dateISO = (date = new Date()) => {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    // A UTC ISO slice can show *yesterday* for travellers east of UTC,
    // including the Maldives. Countdown refers to the user's LOCAL day.
    const pad = (n) => String(n).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) +
      "-" + pad(date.getDate());
  };
  const monthStamp = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();

  function countdown(departure, currentDate = dateISO()) {
    const target = dateUTC(departure);
    const current = dateUTC(currentDate);
    if (!target || !current) {
      return { days: null, label: "Set a departure date to see the countdown", phase: "unset" };
    }
    const days = Math.round((target.getTime() - current.getTime()) / 86400000);
    return {
      days,
      phase: days > 0 ? "upcoming" : days === 0 ? "today" : "past",
      label: days > 0 ? days + " day" + (days !== 1 ? "s" : "") + " until departure" :
        days === 0 ? "Departure day is today" :
          "Departure was " + -days + " day" + (days !== -1 ? "s" : "") + " ago",
    };
  }

  function contributions(trip, type = "saved") {
    const people = Array.isArray(trip?.people) && trip.people.length
      ? trip.people : [{ id: "legacy-a" }, { id: "legacy-b" }];
    return (Array.isArray(trip?.savings) ? trip.savings : []).reduce((total, row) => {
      return total + people.reduce((sum, person) => {
        const newValue = row?.contributions?.[person.id];
        const oldField = person.id === "legacy-a" ?
          (type === "saved" ? "savedA" : "planA") :
          (type === "saved" ? "savedB" : "planB");
        return sum + amount(newValue ? newValue[type] :
          (person.id === "legacy-a" || person.id === "legacy-b" ? row?.[oldField] : 0));
      }, 0);
    }, 0);
  }

  const savedPerMonth = (row, people, kind) => {
    return people.reduce((total, person) => {
      const item = row?.contributions?.[person.id];
      const old = person.id === "legacy-a" ? (kind === "saved" ? "savedA" : "planA") :
        person.id === "legacy-b" ? (kind === "saved" ? "savedB" : "planB") : null;
      return total + amount(item ? item[kind] : old ? row?.[old] : 0);
    }, 0);
  };

  function savingsHistory(trip) {
    const people = Array.isArray(trip?.people) && trip.people.length
      ? trip.people : [{ id: "legacy-a" }, { id: "legacy-b" }];
    const rows = Array.isArray(trip?.savings) ? trip.savings : [];
    return rows.map((row) => ({
      month: typeof row.month === "string" ? row.month : "Unknown",
      planned: round2(savedPerMonth(row, people, "planned")),
      saved: round2(savedPerMonth(row, people, "saved")),
    }));
  }

  function savingsForecast(trip, currentDate = dateISO()) {
    const budget = amount(trip?.budget);
    const saved = round2(contributions(trip));
    const remaining = round2(Math.max(0, budget - saved));
    const monthlyTarget = round2((Array.isArray(trip?.people) ? trip.people : [])
      .reduce((sum, person) => sum + amount(person.monthlyTarget), 0));
    const departure = dateUTC(trip?.departure);
    const now = dateUTC(currentDate);
    const days = countdown(trip?.departure, currentDate).days;
    const remainingMonths = !departure || !now || days === null || days <= 0
      ? 0 : Math.max(1, monthStamp(departure) - monthStamp(now) + 1);
    const monthlyNeeded = remainingMonths > 0 ? round2(remaining / remainingMonths) : null;
    const onTrack = monthlyNeeded === null ? null : monthlyTarget >= monthlyNeeded;
    const history = savingsHistory(trip);
    return {
      budget, saved, remaining, monthlyTarget, remainingMonths,
      monthlyNeeded, onTrack, progress: budget > 0
        ? Math.min(100, round2(saved / budget * 100)) : 0,
      history,
    };
  }

  function cheapestTravelOption(trip) {
    const rows = Array.isArray(trip?.options) ? trip.options : [];
    const breakdowns = rows.map((option) => {
      const ticket = amount(option.ticket);
      const exchange = amount(option.dollars) * amount(option.rate);
      const stay = amount(option.stay);
      const extras = amount(option.other);
      return {
        id: option.id,
        name: String(option.name || "Unnamed option"),
        ticket: round2(ticket),
        exchange: round2(exchange),
        stay: round2(stay),
        extras: round2(extras),
        total: round2(ticket + exchange + stay + extras),
      };
    });
    if (!breakdowns.length) return null;
    const cheapest = breakdowns.reduce((low, item) => item.total < low.total ? item : low);
    return {
      ...cheapest,
      budgetLeft: round2(amount(trip?.budget) - cheapest.total),
      overBudget: cheapest.total > amount(trip?.budget),
      count: breakdowns.length,
    };
  }

  const STARTER_CHECKLIST = Object.freeze([
    "Check passport validity",
    "Review visa or entry requirements",
    "Book or confirm flights",
    "Confirm accommodation",
    "Arrange travel insurance",
    "Plan airport transfers",
    "Prepare packing list",
  ]);

  function checklistSummary(trip) {
    const items = Array.isArray(trip?.checklist) ? trip.checklist : [];
    const done = items.filter((item) => item?.done === true).length;
    return {
      total: items.length,
      done,
      remaining: items.length - done,
      percent: items.length ? Math.round(done * 100 / items.length) : 0,
    };
  }

  window.voyafundraInsights = {
    dateUTC, dateISO, countdown, savingsForecast, savingsHistory,
    cheapestTravelOption, checklistSummary, STARTER_CHECKLIST,
  };
})();
