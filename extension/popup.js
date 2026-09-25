// popup.js — the current tab's URL is the single source of truth for search filters;
// auto-refresh state lives in background.js.

const PARAMS = {
  time: "f_TPR",
  workType: "f_WT",
  experience: "f_E",
  easyApply: "f_AL",
  sort: "sortBy",
};

const INTERVAL_LABELS = { 0.5: "30s", 1: "1m", 2: "2m", 5: "5m" };
const WORK_TYPE_LABELS = { 1: "On-site", 2: "Remote", 3: "Hybrid" };
const EXPERIENCE_LABELS = { 1: "Internship", 2: "Entry", 3: "Associate", 4: "Mid-Senior", 5: "Director", 6: "Executive" };
const MAX_CUSTOM_MINUTES = 43200; // 30 days
const APPLY_DELAY_MS = 350;

const $ = (id) => document.getElementById(id);

const el = {
  version: $("version"),
  livePill: $("livePill"),
  livePillText: $("livePillText"),
  emptyState: $("emptyState"),
  openJobsBtn: $("openJobsBtn"),
  stopElsewhereBtn: $("stopElsewhereBtn"),
  mainContent: $("mainContent"),
  autoRefreshToggle: $("autoRefreshToggle"),
  refreshSub: $("refreshSub"),
  intervalGroup: $("intervalGroup"),
  intervalButtons: [...document.querySelectorAll("#intervalGroup [data-interval]")],
  timeHint: $("timeHint"),
  timeChips: [...document.querySelectorAll("#timeGroup [data-seconds]")],
  customForm: $("customForm"),
  customField: $("customField"),
  customMinutes: $("customMinutes"),
  customError: $("customError"),
  workTypeChips: [...document.querySelectorAll("#workTypeGroup [data-value]")],
  experienceChips: [...document.querySelectorAll("#experienceGroup [data-value]")],
  easyApplyToggle: $("easyApplyToggle"),
  sortLatestToggle: $("sortLatestToggle"),
  hidePromotedToggle: $("hidePromotedToggle"),
  hideViewedToggle: $("hideViewedToggle"),
  activeFiltersList: $("activeFiltersList"),
  clearAllBtn: $("clearAllBtn"),
  toast: $("toast"),
};

const state = {
  tab: null,
  filters: {
    seconds: null, // f_TPR as seconds, or null
    workType: new Set(),
    experience: new Set(),
    easyApply: false,
    sortLatest: false,
  },
  // Not URL filters: content.js hides these cards on every LinkedIn Jobs tab.
  hide: { hidePromoted: false, hideViewed: false },
  hiddenCount: 0, // cards content.js is currently hiding in this tab
  refresh: { running: false, interval: 0.5, targetTabId: null },
};

let applyTimer = null;
let toastTimer = null;

// ===== Helpers =====
function isJobsUrl(url) {
  return typeof url === "string" && /^https:\/\/www\.linkedin\.com\/jobs(\/|$|\?)/.test(url);
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        console.error("Job Sniper:", chrome.runtime.lastError?.message || response?.error);
        resolve(null);
        return;
      }
      resolve(response.status);
    });
  });
}

function parseList(value) {
  return new Set((value || "").split(",").map((v) => v.trim()).filter(Boolean));
}

function formatDuration(seconds) {
  const units = [
    [604800, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size && seconds % size === 0) return `${seconds / size}${unit}`;
  }
  return seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`;
}

function showToast(text) {
  el.toast.textContent = text;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1600);
}

// ===== Hide Promoted / Viewed =====
async function loadHideSettings() {
  const stored = await chrome.storage.local.get(Object.keys(state.hide));
  for (const key of Object.keys(state.hide)) state.hide[key] = Boolean(stored[key]);
}

function saveHideSettings() {
  return chrome.storage.local.set(state.hide);
}

// Returns false when content.js isn't in the tab (opened before the extension was installed).
async function refreshHiddenCounts() {
  let hidden = { promoted: 0, viewed: 0 };
  let reachable = true;
  if (state.tab && (state.hide.hidePromoted || state.hide.hideViewed)) {
    try {
      const response = await chrome.tabs.sendMessage(state.tab.id, { action: "getHiddenCount" });
      hidden = response?.hidden ?? hidden;
    } catch {
      reachable = false;
    }
  }
  state.hiddenCount = (state.hide.hidePromoted ? hidden.promoted : 0) + (state.hide.hideViewed ? hidden.viewed : 0);
  renderSummary();
  return reachable;
}

// ===== URL <-> state =====
function readFiltersFromUrl(urlString) {
  const url = new URL(urlString);
  const p = url.searchParams;
  const tpr = /^r(\d+)$/.exec(p.get(PARAMS.time) || "");

  state.filters.seconds = tpr ? Number(tpr[1]) : null;
  state.filters.workType = parseList(p.get(PARAMS.workType));
  state.filters.experience = parseList(p.get(PARAMS.experience));
  state.filters.easyApply = p.get(PARAMS.easyApply) === "true";
  state.filters.sortLatest = p.get(PARAMS.sort) === "DD";
}

function buildUrl(urlString, filters) {
  const url = new URL(urlString);
  const p = url.searchParams;
  const setOrDelete = (key, value) => (value ? p.set(key, value) : p.delete(key));
  const joinSorted = (set) => [...set].sort().join(",");

  setOrDelete(PARAMS.time, filters.seconds ? `r${filters.seconds}` : null);
  setOrDelete(PARAMS.workType, joinSorted(filters.workType));
  setOrDelete(PARAMS.experience, joinSorted(filters.experience));
  setOrDelete(PARAMS.easyApply, filters.easyApply ? "true" : null);
  setOrDelete(PARAMS.sort, filters.sortLatest ? "DD" : null);

  // Filters changed, so any pagination / selected job no longer applies.
  p.delete("start");
  p.delete("currentJobId");

  return url.toString();
}

// Batch rapid clicks into a single page load.
function scheduleApply() {
  clearTimeout(applyTimer);
  applyTimer = setTimeout(applyFilters, APPLY_DELAY_MS);
}

async function applyFilters() {
  applyTimer = null;
  if (!state.tab) return;

  try {
    const tab = await chrome.tabs.get(state.tab.id);
    if (!isJobsUrl(tab.url)) {
      showToast("This tab is no longer on LinkedIn Jobs");
      return;
    }

    const next = buildUrl(tab.url, state.filters);
    if (next === tab.url) return;

    await chrome.tabs.update(tab.id, { url: next });
    state.tab = { ...tab, url: next };
    showToast("Updating results…");
  } catch (err) {
    console.error("Job Sniper: failed to update tab", err);
    showToast("Couldn't update the page");
  }
}

// ===== Rendering =====
function renderRefresh() {
  const { running, interval, targetTabId } = state.refresh;
  const onThisTab = running && state.tab && targetTabId === state.tab.id;
  const label = INTERVAL_LABELS[interval] || "30s";

  el.livePill.dataset.live = String(running);
  el.livePillText.textContent = running ? `Live · ${label}` : "Idle";

  el.autoRefreshToggle.checked = Boolean(onThisTab);
  if (onThisTab) {
    el.refreshSub.textContent = `Reloading this search every ${label}`;
  } else if (running) {
    el.refreshSub.textContent = "Running on another tab — switch on to move it here";
  } else {
    el.refreshSub.textContent = "Reload this search on a timer";
  }

  const index = el.intervalButtons.findIndex((b) => Number(b.dataset.interval) === interval);
  el.intervalButtons.forEach((b, i) => {
    const checked = i === index;
    b.setAttribute("aria-checked", String(checked));
    b.tabIndex = checked ? 0 : -1;
  });
  el.intervalGroup.style.setProperty("--i", String(Math.max(index, 0)));

  el.stopElsewhereBtn.classList.toggle("hidden", !running);
}

function renderFilters() {
  const f = state.filters;

  const presetMatch = el.timeChips.some((c) => Number(c.dataset.seconds) === f.seconds);
  el.timeChips.forEach((c) => c.setAttribute("aria-pressed", String(Number(c.dataset.seconds) === f.seconds)));

  const isCustom = f.seconds != null && !presetMatch;
  el.customField.classList.toggle("active", isCustom);
  if (isCustom && document.activeElement !== el.customMinutes) {
    el.customMinutes.value = f.seconds % 60 === 0 ? String(f.seconds / 60) : "";
  }

  el.timeHint.textContent = f.seconds ? `Last ${formatDuration(f.seconds)}` : "Any time";
  el.timeHint.classList.toggle("on", Boolean(f.seconds));

  el.workTypeChips.forEach((c) => c.setAttribute("aria-pressed", String(f.workType.has(c.dataset.value))));
  el.experienceChips.forEach((c) => c.setAttribute("aria-pressed", String(f.experience.has(c.dataset.value))));

  el.easyApplyToggle.checked = f.easyApply;
  el.sortLatestToggle.checked = f.sortLatest;
  el.hidePromotedToggle.checked = state.hide.hidePromoted;
  el.hideViewedToggle.checked = state.hide.hideViewed;

  renderSummary();
}

function renderSummary() {
  const f = state.filters;
  const tags = [];

  if (f.seconds) tags.push(`≤ ${formatDuration(f.seconds)}`);
  [...f.workType].sort().forEach((v) => tags.push(WORK_TYPE_LABELS[v] || `Type ${v}`));
  [...f.experience].sort().forEach((v) => tags.push(EXPERIENCE_LABELS[v] || `Level ${v}`));
  if (f.easyApply) tags.push("Easy Apply");
  if (f.sortLatest) tags.push("Newest");
  if (state.hide.hidePromoted) tags.push("No promoted");
  if (state.hide.hideViewed) tags.push("No viewed");

  if (tags.length) {
    const count = Object.assign(document.createElement("strong"), {
      textContent: `${tags.length} active`,
    });
    const hidden = state.hiddenCount ? ` · ${state.hiddenCount} hidden` : "";
    el.activeFiltersList.replaceChildren(count, `${hidden} · ${tags.join(", ")}`);
    el.activeFiltersList.title = tags.join(", ");
  } else {
    el.activeFiltersList.replaceChildren("No filters applied");
    el.activeFiltersList.removeAttribute("title");
  }

  const hasAnything = tags.length > 0 || el.autoRefreshToggle.checked;
  el.clearAllBtn.disabled = !hasAnything;
  el.clearAllBtn.style.visibility = hasAnything ? "visible" : "hidden";
}

// ===== Event handlers =====
function onTimeChip(chip) {
  const seconds = Number(chip.dataset.seconds);
  state.filters.seconds = state.filters.seconds === seconds ? null : seconds;
  el.customMinutes.value = "";
  hideCustomError();
  renderFilters();
  scheduleApply();
}

function hideCustomError() {
  el.customError.classList.add("hidden");
  el.customField.classList.remove("invalid");
}

function onCustomSubmit(e) {
  e.preventDefault();
  const raw = el.customMinutes.value.trim();
  const minutes = Number(raw);

  if (!raw || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_CUSTOM_MINUTES) {
    el.customError.classList.remove("hidden");
    el.customField.classList.add("invalid");
    return;
  }

  hideCustomError();
  state.filters.seconds = minutes * 60;
  el.customMinutes.blur();
  renderFilters();
  scheduleApply();
}

function onSetChip(chip, set) {
  const value = chip.dataset.value;
  if (set.has(value)) set.delete(value);
  else set.add(value);
  renderFilters();
  scheduleApply();
}

async function onHideToggle(key, input) {
  state.hide[key] = input.checked;
  renderSummary();
  await saveHideSettings();
  // content.js rescans on the storage change; give it a moment before counting.
  setTimeout(async () => {
    const reachable = await refreshHiddenCounts();
    if (!reachable && input.checked) showToast("Reload the LinkedIn tab to apply");
  }, 100);
}

async function onAutoRefreshToggle() {
  const wantOn = el.autoRefreshToggle.checked;
  el.autoRefreshToggle.disabled = true;

  const status = wantOn
    ? await send({ action: "startAutoRefresh", tabId: state.tab.id, interval: state.refresh.interval })
    : await send({ action: "stopAutoRefresh" });

  el.autoRefreshToggle.disabled = false;

  if (status) {
    state.refresh = status;
    showToast(wantOn ? `Auto-refresh on · every ${INTERVAL_LABELS[status.interval]}` : "Auto-refresh off");
  } else {
    showToast("Couldn't change auto-refresh");
  }
  renderRefresh();
  renderSummary();
}

async function onIntervalSelect(button) {
  const interval = Number(button.dataset.interval);
  if (interval === state.refresh.interval) return;

  state.refresh.interval = interval; // optimistic, so the glider moves immediately
  renderRefresh();

  const status = await send({ action: "setInterval", interval });
  if (status) state.refresh = status;
  renderRefresh();
}

function onIntervalKeydown(e) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in keys)) return;
  e.preventDefault();
  const current = el.intervalButtons.findIndex((b) => b.getAttribute("aria-checked") === "true");
  const next = el.intervalButtons[(current + keys[e.key] + el.intervalButtons.length) % el.intervalButtons.length];
  next.focus();
  onIntervalSelect(next);
}

async function onClearAll() {
  state.filters = {
    seconds: null,
    workType: new Set(),
    experience: new Set(),
    easyApply: false,
    sortLatest: false,
  };
  el.customMinutes.value = "";
  hideCustomError();

  if (state.hide.hidePromoted || state.hide.hideViewed) {
    state.hide = { hidePromoted: false, hideViewed: false };
    await saveHideSettings();
    refreshHiddenCounts();
  }

  if (el.autoRefreshToggle.checked) {
    const status = await send({ action: "stopAutoRefresh" });
    if (status) state.refresh = status;
    renderRefresh();
  }

  renderFilters();
  clearTimeout(applyTimer);
  await applyFilters();
  showToast("All filters cleared");
}

async function onOpenJobs() {
  const target = "https://www.linkedin.com/jobs/search/?sortBy=DD";
  if (state.tab && /^https:\/\/www\.linkedin\.com\//.test(state.tab.url || "")) {
    await chrome.tabs.update(state.tab.id, { url: target });
  } else {
    await chrome.tabs.create({ url: target });
  }
  window.close();
}

async function onStopElsewhere() {
  const status = await send({ action: "stopAutoRefresh" });
  if (status) state.refresh = status;
  renderRefresh();
  showToast("Auto-refresh off");
}

function bindEvents() {
  el.timeChips.forEach((c) => c.addEventListener("click", () => onTimeChip(c)));
  el.customForm.addEventListener("submit", onCustomSubmit);
  el.customMinutes.addEventListener("input", hideCustomError);
  el.workTypeChips.forEach((c) => c.addEventListener("click", () => onSetChip(c, state.filters.workType)));
  el.experienceChips.forEach((c) => c.addEventListener("click", () => onSetChip(c, state.filters.experience)));

  el.easyApplyToggle.addEventListener("change", () => {
    state.filters.easyApply = el.easyApplyToggle.checked;
    renderSummary();
    scheduleApply();
  });
  el.sortLatestToggle.addEventListener("change", () => {
    state.filters.sortLatest = el.sortLatestToggle.checked;
    renderSummary();
    scheduleApply();
  });

  el.hidePromotedToggle.addEventListener("change", () => onHideToggle("hidePromoted", el.hidePromotedToggle));
  el.hideViewedToggle.addEventListener("change", () => onHideToggle("hideViewed", el.hideViewedToggle));

  el.autoRefreshToggle.addEventListener("change", onAutoRefreshToggle);
  el.intervalButtons.forEach((b) => b.addEventListener("click", () => onIntervalSelect(b)));
  el.intervalGroup.addEventListener("keydown", onIntervalKeydown);

  el.clearAllBtn.addEventListener("click", onClearAll);
  el.openJobsBtn.addEventListener("click", onOpenJobs);
  el.stopElsewhereBtn.addEventListener("click", onStopElsewhere);

  // If the popup closes while a change is pending, apply it right away.
  window.addEventListener("pagehide", () => {
    if (applyTimer) applyFilters();
  });
}

// ===== Init =====
async function init() {
  bindEvents();
  el.version.textContent = `v${chrome.runtime.getManifest().version.replace(/\.0$/, "")}`;

  const [[tab], status] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    send({ action: "getStatus" }),
    loadHideSettings(),
  ]);

  state.tab = tab || null;
  if (status) state.refresh = status;

  const onJobs = Boolean(tab && isJobsUrl(tab.url));
  el.emptyState.classList.toggle("hidden", onJobs);
  el.mainContent.classList.toggle("hidden", !onJobs);

  if (onJobs) readFiltersFromUrl(tab.url);

  renderRefresh();
  renderFilters();
  if (onJobs) refreshHiddenCounts();
}

document.addEventListener("DOMContentLoaded", init);
