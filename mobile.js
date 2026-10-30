"use strict";

/* iPhone bottom navigation calls the existing application controls.
   No authentication, database, or trip logic is duplicated here. */
(function initMobileNavigation() {
  const nav = document.getElementById("mobileNav");
  const trips = document.getElementById("allTripsNav");
  const history = document.getElementById("historyNav");
  const create = document.getElementById("newTripBtn");
  const content = document.getElementById("appContent");
  if (!nav || !trips || !history || !create || !content) return;

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
      case "new": create.click(); break;
      default: return;
    }
    syncNavigation();
    if (button.dataset.mobileAction !== "new") window.scrollTo(0, 0);
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
