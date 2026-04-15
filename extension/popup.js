// ===== DOM Elements =====
const elements = {
  warning: document.getElementById("warning"),
  mainContent: document.getElementById("mainContent"),
  statusBar: document.getElementById("statusBar"),
  statusText: document.getElementById("statusText"),
  autoRefreshToggle: document.getElementById("autoRefreshToggle"),
  easyApplyToggle: document.getElementById("easyApplyToggle"),
  sortLatestToggle: document.getElementById("sortLatestToggle"),
  activeFiltersList: document.getElementById("activeFiltersList"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  filterButtons: document.querySelectorAll(".filter-btn"),
};

// ===== State =====
let state = {
  currentFilter: null,
  autoRefresh: false,
  easyApply: false,
  sortByLatest: false,
  isLinkedInJobs: false,
};

// ===== Initialization =====
document.addEventListener("DOMContentLoaded", async () => {
  await checkCurrentTab();
  await loadSavedPreferences();
  bindEvents();
  syncUIFromURL();
});

// ===== Tab Checking =====
async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes("linkedin.com/jobs")) {
      state.isLinkedInJobs = true;
      elements.warning.classList.add("hidden");
      elements.mainContent.classList.remove("hidden");
    } else {
      state.isLinkedInJobs = false;
      elements.warning.classList.remove("hidden");
      elements.mainContent.classList.add("hidden");
    }
  } catch (err) {
    console.error("Error checking tab:", err);
    elements.warning.classList.remove("hidden");
    elements.mainContent.classList.add("hidden");
  }
}

// ===== Load Saved Preferences =====
async function loadSavedPreferences() {
  try {
    const result = await chrome.storage.local.get([
      "timeFilter",
      "autoRefresh",
      "easyApply",
      "sortByLatest",
    ]);

    if (result.timeFilter) {
      state.currentFilter = result.timeFilter;
    }
    if (result.autoRefresh) {
      state.autoRefresh = true;
      elements.autoRefreshToggle.checked = true;
    }
    if (result.easyApply) {
      state.easyApply = true;
      elements.easyApplyToggle.checked = true;
    }
    if (result.sortByLatest) {
      state.sortByLatest = true;
      elements.sortLatestToggle.checked = true;
    }

    updateFilterButtonStates();
    updateActiveFilters();
  } catch (err) {
    console.error("Error loading preferences:", err);
  }
}

// ===== Sync UI from current URL =====
async function syncUIFromURL() {
  if (!state.isLinkedInJobs) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = new URL(tab.url);

    // Sync time filter
    const tpr = url.searchParams.get("f_TPR");
    if (tpr) {
      state.currentFilter = tpr;
      updateFilterButtonStates();
    }

    // Sync easy apply
    const easyApply = url.searchParams.get("f_AL");
    if (easyApply === "true") {
      state.easyApply = true;
      elements.easyApplyToggle.checked = true;
    }

    // Sync sort
    const sortBy = url.searchParams.get("sortBy");
    if (sortBy === "DD") {
      state.sortByLatest = true;
      elements.sortLatestToggle.checked = true;
    }

    updateActiveFilters();
    updateStatusText();
  } catch (err) {
    console.error("Error syncing from URL:", err);
  }
}

// ===== Event Binding =====
function bindEvents() {
  // Time filter buttons
  elements.filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => handleFilterClick(btn));
  });

  // Toggles
  elements.autoRefreshToggle.addEventListener("change", handleAutoRefreshToggle);
  elements.easyApplyToggle.addEventListener("change", handleEasyApplyToggle);
  elements.sortLatestToggle.addEventListener("change", handleSortLatestToggle);

  // Clear all
  elements.clearAllBtn.addEventListener("click", handleClearAll);
}

// ===== Filter Click Handler =====
async function handleFilterClick(btn) {
  const value = btn.dataset.value;
  const label = btn.dataset.label;

  // Toggle off if already active
  if (state.currentFilter === value) {
    state.currentFilter = null;
    await savePreference("timeFilter", null);
    await updateURL();
    setStatus("Filter removed");
  } else {
    state.currentFilter = value;
    await savePreference("timeFilter", value);
    showLoading();
    await updateURL();
    hideLoading();
    setStatus(`Filter: Last ${label}`);
  }

  updateFilterButtonStates();
  updateActiveFilters();
}

// ===== Auto Refresh Toggle =====
async function handleAutoRefreshToggle(e) {
  state.autoRefresh = e.target.checked;
  await savePreference("autoRefresh", state.autoRefresh);

  if (state.autoRefresh) {
    chrome.runtime.sendMessage({ action: "startAutoRefresh" });
    setStatus("Auto-refresh: ON (30s)");
  } else {
    chrome.runtime.sendMessage({ action: "stopAutoRefresh" });
    setStatus("Auto-refresh: OFF");
  }

  updateActiveFilters();
}

// ===== Easy Apply Toggle =====
async function handleEasyApplyToggle(e) {
  state.easyApply = e.target.checked;
  await savePreference("easyApply", state.easyApply);

  showLoading();
  await updateURL();
  hideLoading();

  setStatus(state.easyApply ? "Easy Apply: ON" : "Easy Apply: OFF");
  updateActiveFilters();
}

// ===== Sort by Latest Toggle =====
async function handleSortLatestToggle(e) {
  state.sortByLatest = e.target.checked;
  await savePreference("sortByLatest", state.sortByLatest);

  showLoading();
  await updateURL();
  hideLoading();

  setStatus(state.sortByLatest ? "Sort: Most Recent" : "Sort: Default");
  updateActiveFilters();
}

// ===== Clear All =====
async function handleClearAll() {
  // Reset state
  state.currentFilter = null;
  state.easyApply = false;
  state.sortByLatest = false;
  state.autoRefresh = false;

  // Update UI
  elements.autoRefreshToggle.checked = false;
  elements.easyApplyToggle.checked = false;
  elements.sortLatestToggle.checked = false;

  // Stop auto-refresh
  chrome.runtime.sendMessage({ action: "stopAutoRefresh" });

  // Clear storage
  await chrome.storage.local.clear();

  // Update URL - remove our params
  showLoading();
  await clearURLParams();
  hideLoading();

  updateFilterButtonStates();
  updateActiveFilters();
  setStatus("All filters cleared");
}

// ===== URL Management =====
async function updateURL() {
  if (!state.isLinkedInJobs) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = new URL(tab.url);

    // Time filter
    if (state.currentFilter) {
      url.searchParams.set("f_TPR", state.currentFilter);
    } else {
      url.searchParams.delete("f_TPR");
    }

    // Easy Apply
    if (state.easyApply) {
      url.searchParams.set("f_AL", "true");
    } else {
      url.searchParams.delete("f_AL");
    }

    // Sort by latest
    if (state.sortByLatest) {
      url.searchParams.set("sortBy", "DD");
    } else {
      url.searchParams.delete("sortBy");
    }

    await chrome.tabs.update(tab.id, { url: url.toString() });
  } catch (err) {
    console.error("Error updating URL:", err);
    setStatus("Error updating page");
  }
}

async function clearURLParams() {
  if (!state.isLinkedInJobs) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = new URL(tab.url);
    url.searchParams.delete("f_TPR");
    url.searchParams.delete("f_AL");
    url.searchParams.delete("sortBy");

    await chrome.tabs.update(tab.id, { url: url.toString() });
  } catch (err) {
    console.error("Error clearing URL:", err);
  }
}

// ===== UI Updates =====
function updateFilterButtonStates() {
  elements.filterButtons.forEach((btn) => {
    if (btn.dataset.value === state.currentFilter) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function updateActiveFilters() {
  const filters = [];

  if (state.currentFilter) {
    const btn = document.querySelector(`[data-value="${state.currentFilter}"]`);
    if (btn) {
      filters.push(`Last ${btn.dataset.label}`);
    }
  }

  if (state.easyApply) {
    filters.push("Easy Apply");
  }

  if (state.sortByLatest) {
    filters.push("Sort: Latest");
  }

  if (state.autoRefresh) {
    filters.push("Auto-refresh: 30s");
  }

  if (filters.length === 0) {
    elements.activeFiltersList.innerHTML = '<span class="no-filters">No filters applied</span>';
  } else {
    elements.activeFiltersList.innerHTML = filters
      .map((f) => `<span class="filter-tag">${f}</span>`)
      .join("");
  }
}

function setStatus(text) {
  elements.statusText.textContent = text;
  elements.statusText.style.animation = "none";
  // Trigger reflow
  void elements.statusText.offsetHeight;
  elements.statusText.style.animation = "fadeIn 0.3s ease";
}

function updateStatusText() {
  const parts = [];

  if (state.currentFilter) {
    const btn = document.querySelector(`[data-value="${state.currentFilter}"]`);
    if (btn) parts.push(`Last ${btn.dataset.label}`);
  }
  if (state.easyApply) parts.push("Easy Apply");
  if (state.sortByLatest) parts.push("Latest");
  if (state.autoRefresh) parts.push("Auto-refresh");

  if (parts.length > 0) {
    setStatus(parts.join(" · "));
  } else {
    setStatus("Ready to snipe");
  }
}

// ===== Storage =====
async function savePreference(key, value) {
  try {
    if (value === null || value === false) {
      await chrome.storage.local.remove(key);
    } else {
      await chrome.storage.local.set({ [key]: value });
    }
  } catch (err) {
    console.error("Error saving preference:", err);
  }
}

// ===== Loading =====
function showLoading() {
  elements.loadingOverlay.classList.remove("hidden");
}

function hideLoading() {
  setTimeout(() => {
    elements.loadingOverlay.classList.add("hidden");
  }, 400);
}
