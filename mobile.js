"use strict";

/* iPhone bottom navigation calls the existing application controls.
   No authentication, database, or trip logic is duplicated here. */
(function initMobileNavigation() {
  const nav = document.getElementById("mobileNav");
  const trips = document.getElementById("allTripsNav");
  const history = document.getElementById("historyNav");
  const content = document.getElementById("appContent");
  if (!nav || !trips || !history || !content) return;

  function syncNavigation() {
    const active = history.classList.contains("active") ? "history" : "trips";
    nav.querySelectorAll("[data-mobile-action]").forEach((button) => {
      const selected = button.dataset.mobileAction === active;
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  nav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mobile-action]");
    if (!button) return;
    switch (button.dataset.mobileAction) {
      case "trips": trips.click(); break;
      case "history": history.click(); break;
      default: return;
    }
    syncNavigation();
    document.querySelector(".main")?.scrollTo({ top: 0, behavior: "instant" });
    window.scrollTo(0, 0);
  });

  trips.addEventListener("click", syncNavigation);
  history.addEventListener("click", syncNavigation);
  new MutationObserver(syncNavigation).observe(content, { childList: true });
  new MutationObserver(() => {
    nav.hidden = !document.body.classList.contains("authenticated");
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  nav.hidden = !document.body.classList.contains("authenticated");
  syncNavigation();
})();


/* Move the existing controls (not clones) beside the brand on phones.
   Preserves all theme and logout listeners when switching screen sizes. */
(function placeAccountActions() {
  const sidebar = document.getElementById("appSidebar");
  const actions = document.getElementById("accountActions");
  const originalParent = document.querySelector(".topbar-actions");
  const firstChild = originalParent?.firstElementChild;
  if (!sidebar || !actions || !originalParent || firstChild !== actions) return;
  const mobile = window.matchMedia("(max-width: 700px)");

  function arrange() {
    if (mobile.matches) {
      sidebar.appendChild(actions);
    } else if (actions.parentNode !== originalParent) {
      originalParent.insertBefore(actions, originalParent.firstChild);
    }
  }
  if (typeof mobile.addEventListener === "function") {
    mobile.addEventListener("change", arrange);
  } else if (typeof mobile.addListener === "function") {
    mobile.addListener(arrange);
  }
  arrange();
})();
