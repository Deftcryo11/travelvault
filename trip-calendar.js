"use strict";

/* Voyafundra trip-form calendar.
   Theme-aware in-page date/month selection, without a third-party CDN.
   The original ISO form field names and values remain unchanged. */
(() => {
  const pad = (value) => String(value).padStart(2, "0");
  const datePattern = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let opened = null;

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function parseDate(value) {
    const match = datePattern.exec(value || "");
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (year < 100 || year > 9999 || day > daysInMonth(year, month)) return null;
    return { year, month, day };
  }

  function parseMonth(value) {
    const match = monthPattern.exec(value || "");
    if (!match) return null;
    const year = Number(match[1]);
    if (year < 100 || year > 9999) return null;
    return { year, month: Number(match[2]) - 1 };
  }

  function shiftMonth(year, month, delta) {
    const total = year * 12 + month + delta;
    return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
  }

  function mondayIndex(year, month, day) {
    return (new Date(year, month, day).getDay() + 6) % 7;
  }

  function dateLabel(value, kind) {
    if (!value) return kind === "month" ? "Choose a month" : "Choose a date";
    const parsed = kind === "month" ? parseMonth(value) : parseDate(value);
    if (!parsed) return kind === "month" ? "Choose a month" : "Choose a date";
    if (kind === "month") return monthNames[parsed.month] + " " + parsed.year;
    return parsed.day + " " + monthNames[parsed.month].slice(0, 3) +
      " " + parsed.year;
  }

  function closeAll() {
    if (!opened) return;
    opened.close(false);
    opened = null;
  }

  function mount(form) {
    if (!form) return;
    closeAll();
    form.querySelectorAll('input[type="date"], input[type="month"]').forEach((input) => {
      const kind = input.type;
      const field = input.closest(".field");
      if (!field || input.dataset.voyafundraCalendar) return;
      const label = field.querySelector("label");
      const accessibleName = label?.textContent?.trim() ||
        (kind === "month" ? "Month" : "Date");
      const key = input.id;
      input.dataset.voyafundraCalendar = kind;
      // The original input remains the source of truth for FormData.
      // Trip dates and savings start month are optional in the existing form.
      input.type = "hidden";
      input.hidden = true;

      const root = document.createElement("div");
      root.className = "vf-calendar";
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.id = key + "-picker";
      trigger.className = "vf-calendar-trigger";
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-expanded", "false");
      trigger.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
        'aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/>' +
        '<path d="M7 3v4M17 3v4M3 10h18"/></svg>' +
        '<span class="vf-calendar-label"></span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
      const panel = document.createElement("div");
      panel.className = "vf-calendar-panel";
      panel.id = key + "-calendar";
      panel.hidden = true;
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", accessibleName + " calendar");
      trigger.setAttribute("aria-controls", panel.id);
      root.append(trigger, panel);
      input.after(root);
      if (label) label.htmlFor = trigger.id;

      const now = new Date();
      const initial = (kind === "month" ? parseMonth(input.value) : parseDate(input.value)) ||
        { year: now.getFullYear(), month: now.getMonth() };
      let year = initial.year;
      let month = initial.month;

      function syncLabel() {
        const text = dateLabel(input.value, kind);
        trigger.querySelector(".vf-calendar-label").textContent = text;
        trigger.setAttribute("aria-label", accessibleName + ": " + text);
      }

      function choose(value) {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        syncLabel();
        close(true);
      }

      function render() {
        if (year < 100 || year > 9999) return;
        const heading = kind === "date" ?
          monthNames[month] + " " + year : String(year);
        let tiles = "";
        const selected = kind === "month" ? parseMonth(input.value) : parseDate(input.value);
        const today = new Date();

        if (kind === "date") {
          const emptyCount = mondayIndex(year, month, 1);
          for (let i = 0; i < emptyCount; i += 1) {
            tiles += '<span class="vf-calendar-empty" aria-hidden="true"></span>';
          }
          for (let day = 1; day <= daysInMonth(year, month); day += 1) {
            const chosen = !!selected && selected.year === year &&
              selected.month === month && selected.day === day;
            const current = today.getFullYear() === year &&
              today.getMonth() === month && today.getDate() === day;
            const value = year + "-" + pad(month + 1) + "-" + pad(day);
            tiles += '<button type="button" class="vf-calendar-day' +
              (chosen ? ' is-selected' : '') + (current ? ' is-today' : '') +
              '" data-vf-date="' + value + '" aria-label="' + day + ' ' +
              monthNames[month] + ' ' + year + '" aria-pressed="' + chosen + '"' +
              (current ? ' aria-current="date"' : '') + '>' + day + '</button>';
          }
        } else {
          for (let index = 0; index < 12; index += 1) {
            const chosen = !!selected && selected.year === year &&
              selected.month === index;
            const current = today.getFullYear() === year &&
              today.getMonth() === index;
            tiles += '<button type="button" class="vf-calendar-month' +
              (chosen ? ' is-selected' : '') + (current ? ' is-today' : '') +
              '" data-vf-month="' + year + '-' + pad(index + 1) +
              '" aria-pressed="' + chosen + '">' + monthNames[index].slice(0, 3) +
              '</button>';
          }
        }

        const weekdayRow = kind === "date" ?
          '<div class="vf-calendar-weekdays" aria-hidden="true">' +
          weekdays.map((day) => '<span>' + day + '</span>').join("") + '</div>' : "";
        panel.innerHTML =
          '<div class="vf-calendar-header">' +
          '<button type="button" class="vf-calendar-arrow" data-vf-step="-1" ' +
          'aria-label="Previous ' + (kind === "date" ? 'month' : 'year') + '">‹</button>' +
          '<strong>' + heading + '</strong>' +
          '<button type="button" class="vf-calendar-arrow" data-vf-step="1" ' +
          'aria-label="Next ' + (kind === "date" ? 'month' : 'year') + '">›</button>' +
          '</div>' + weekdayRow +
          '<div class="' + (kind === "date" ? 'vf-calendar-days' : 'vf-calendar-months') +
          '">' + tiles + '</div>' +
          '<div class="vf-calendar-footer">' +
          '<button type="button" data-vf-today>Today</button>' +
          '<button type="button" data-vf-clear>Clear</button></div>';
      }

      function close(restoreFocus) {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        if (opened?.panel === panel) opened = null;
        if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
      }

      function open() {
        closeAll();
        const selected = kind === "month" ? parseMonth(input.value) : parseDate(input.value);
        if (selected) { year = selected.year; month = selected.month; }
        render();
        panel.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        opened = { root, panel, close };
        // Scrolling stays inside the trip modal on iPhone.
        requestAnimationFrame(() => {
          if (panel.hidden || !panel.isConnected) return;
          const modal = panel.closest(".modal");
          if (!modal) return;
          const bottom = panel.getBoundingClientRect().bottom;
          const available = modal.getBoundingClientRect().bottom - 24;
          if (bottom > available) modal.scrollTop += bottom - available + 12;
        });
      }

      trigger.addEventListener("click", () => {
        if (panel.hidden) open();
        else close(false);
      });

      panel.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button || !panel.contains(button)) return;
        if (button.hasAttribute("data-vf-step")) {
          const step = Number(button.dataset.vfStep);
          if (kind === "date") {
            const next = shiftMonth(year, month, step);
            year = next.year;
            month = next.month;
          } else {
            year += step;
          }
          render();
          // Keep keyboard focus inside the calendar after changing months.
          panel.querySelector('[data-vf-step="' + step + '"]')?.focus();
        } else if (button.hasAttribute("data-vf-date")) {
          choose(button.dataset.vfDate);
        } else if (button.hasAttribute("data-vf-month")) {
          choose(button.dataset.vfMonth);
        } else if (button.hasAttribute("data-vf-today")) {
          const date = new Date();
          choose(date.getFullYear() + "-" + pad(date.getMonth() + 1) +
            (kind === "date" ? "-" + pad(date.getDate()) : ""));
        } else if (button.hasAttribute("data-vf-clear")) {
          choose("");
        }
      });

      panel.addEventListener("keydown", (event) => {
        const keyMoves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        const focused = event.target.closest("button[data-vf-date]");
        if (!focused || !Object.prototype.hasOwnProperty.call(keyMoves, event.key)) return;
        const day = Number(focused.dataset.vfDate.slice(-2));
        const next = Math.max(1, Math.min(daysInMonth(year, month), day + keyMoves[event.key]));
        const nextValue = year + "-" + pad(month + 1) + "-" + pad(next);
        panel.querySelector('[data-vf-date="' + nextValue + '"]')?.focus();
        event.preventDefault();
      });

      syncLabel();
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (opened && !opened.root.contains(event.target)) closeAll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = opened;
      current.close(true);
    }
  }, true);

  window.voyafundraCalendar = {
    mount,
    closeAll,
    // Small pure helpers used by automated tests.
    utils: { daysInMonth, parseDate, parseMonth, shiftMonth, mondayIndex, dateLabel },
  };
})();
