// content.js — hides Promoted and/or Viewed job cards in LinkedIn Jobs results.
// Settings live in chrome.storage.local; the popup flips them and this script reacts.

(() => {
  const HIDDEN_ATTR = "data-job-sniper-hidden";
  const SCAN_DELAY_MS = 150;

  // Outermost element of one result card, across LinkedIn's layouts.
  const CARD_SELECTOR = [
    "li[data-occludable-job-id]",
    "li.jobs-search-results__list-item",
    "li.scaffold-layout__list-item",
    "li.discovery-templates-entity-item",
    "div.job-card-container",
  ].join(",");

  // Short labels in a card's footer. The card's title/company are never this short.
  const LABEL_SELECTOR = "li, span, p, strong";
  const PROMOTED = /^promoted$/i;
  const VIEWED = /^viewed$/i;

  const settings = { hidePromoted: false, hideViewed: false };
  let scanTimer = null;

  // Jobs seen un-viewed on this search. Opening one marks it "Viewed", but it
  // shouldn't vanish from under the user — it gets hidden on the next load.
  let seenUnviewed = new Set();
  let searchKey = "";

  const style = document.createElement("style");
  style.textContent = `[${HIDDEN_ATTR}] { display: none !important; }`;
  (document.head || document.documentElement).appendChild(style);

  function onJobsPage() {
    return location.pathname === "/jobs" || location.pathname.startsWith("/jobs/");
  }

  function cardLabels(card) {
    const labels = { promoted: false, viewed: false };
    for (const node of card.querySelectorAll(LABEL_SELECTOR)) {
      if (node.childElementCount > 2) continue;
      const text = node.textContent.trim();
      if (text.length > 12) continue;
      if (PROMOTED.test(text)) labels.promoted = true;
      else if (VIEWED.test(text)) labels.viewed = true;
    }
    return labels;
  }

  function jobId(card) {
    return card.getAttribute("data-occludable-job-id")
      || card.querySelector("[data-job-id]")?.getAttribute("data-job-id")
      || card.getAttribute("data-job-id");
  }

  // Occludable list items exist before their content renders.
  function isRendered(card) {
    return Boolean(card.querySelector('a[href*="/jobs/"]'));
  }

  function currentSearchKey() {
    const params = new URLSearchParams(location.search);
    params.delete("currentJobId");
    return `${location.pathname}?${params}`;
  }

  function cards() {
    // A div.job-card-container inside an already-matched li is the same card.
    return [...document.querySelectorAll(CARD_SELECTOR)].filter(
      (card) => !card.parentElement?.closest(CARD_SELECTOR)
    );
  }

  function scan() {
    scanTimer = null;
    const onJobs = onJobsPage();
    const hidden = { promoted: 0, viewed: 0 };

    const key = currentSearchKey();
    if (key !== searchKey) {
      searchKey = key;
      seenUnviewed = new Set();
    }

    for (const card of cards()) {
      let reason = null;
      if (onJobs && isRendered(card)) {
        const labels = cardLabels(card);
        const id = jobId(card);
        if (id && !labels.viewed) seenUnviewed.add(id);
        const viewedEarlier = labels.viewed && !(id && seenUnviewed.has(id));
        if (settings.hidePromoted && labels.promoted) reason = "promoted";
        else if (settings.hideViewed && viewedEarlier) reason = "viewed";
      }
      if (reason) {
        hidden[reason]++;
        if (!card.hasAttribute(HIDDEN_ATTR)) card.setAttribute(HIDDEN_ATTR, "");
      } else if (card.hasAttribute(HIDDEN_ATTR)) {
        card.removeAttribute(HIDDEN_ATTR);
      }
    }
    return hidden;
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(scan, SCAN_DELAY_MS);
  }

  // LinkedIn renders results lazily and navigates without full page loads.
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let changed = false;
    for (const key of Object.keys(settings)) {
      if (key in changes) {
        settings[key] = Boolean(changes[key].newValue);
        changed = true;
      }
    }
    if (changed) scan();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== "getHiddenCount") return false;
    clearTimeout(scanTimer);
    sendResponse({ hidden: scan() });
    return false;
  });

  chrome.storage.local.get(Object.keys(settings)).then((stored) => {
    for (const key of Object.keys(settings)) settings[key] = Boolean(stored[key]);
    scan();
  });
})();
