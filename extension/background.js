// background.js — owns the auto-refresh alarm and the tab it targets.

const ALARM = "autoRefresh";
const INTERVALS = [0.5, 1, 2, 5]; // minutes (30s needs Chrome 120+)
const DEFAULT_INTERVAL = 0.5;

function isJobsUrl(url) {
  return typeof url === "string" && /^https:\/\/www\.linkedin\.com\/jobs(\/|$|\?)/.test(url);
}

function normalizeInterval(value) {
  const n = Number(value);
  return INTERVALS.includes(n) ? n : DEFAULT_INTERVAL;
}

async function getStatus() {
  const [stored, alarm] = await Promise.all([
    chrome.storage.local.get(["autoRefresh", "refreshInterval", "targetTabId"]),
    chrome.alarms.get(ALARM),
  ]);
  const running = Boolean(stored.autoRefresh && alarm);
  return {
    running,
    interval: normalizeInterval(stored.refreshInterval),
    targetTabId: running ? stored.targetTabId ?? null : null,
  };
}

async function start(tabId, interval) {
  const minutes = normalizeInterval(interval);
  await chrome.alarms.clear(ALARM);
  await chrome.storage.local.set({ autoRefresh: true, refreshInterval: minutes, targetTabId: tabId });
  await chrome.alarms.create(ALARM, { delayInMinutes: minutes, periodInMinutes: minutes });
  return getStatus();
}

async function stop(reason) {
  await chrome.alarms.clear(ALARM);
  await chrome.storage.local.set({ autoRefresh: false });
  await chrome.storage.local.remove("targetTabId");

  if (reason) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Job Sniper",
      message: `Auto-refresh stopped: ${reason}`,
    });
  }
  return getStatus();
}

async function setInterval_(interval) {
  const minutes = normalizeInterval(interval);
  const status = await getStatus();
  if (status.running && status.targetTabId != null) {
    return start(status.targetTabId, minutes);
  }
  await chrome.storage.local.set({ refreshInterval: minutes });
  return getStatus();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;

  const { autoRefresh, targetTabId } = await chrome.storage.local.get(["autoRefresh", "targetTabId"]);
  if (!autoRefresh || targetTabId == null) {
    await stop();
    return;
  }

  let tab;
  try {
    tab = await chrome.tabs.get(targetTabId);
  } catch {
    await stop("the LinkedIn tab was closed.");
    return;
  }

  if (!isJobsUrl(tab.url)) {
    await stop("the tab left LinkedIn Jobs.");
    return;
  }

  chrome.tabs.reload(targetTabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { autoRefresh, targetTabId } = await chrome.storage.local.get(["autoRefresh", "targetTabId"]);
  if (autoRefresh && tabId === targetTabId) {
    await stop("the LinkedIn tab was closed.");
  }
});

// Tab ids don't survive a browser restart, so a leftover alarm would point nowhere.
chrome.runtime.onStartup.addListener(() => {
  stop();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    getStatus: () => getStatus(),
    startAutoRefresh: () => start(message.tabId, message.interval),
    stopAutoRefresh: () => stop(),
    setInterval: () => setInterval_(message.interval),
  };

  const handler = handlers[message?.action];
  if (!handler) return false;

  handler()
    .then((status) => sendResponse({ ok: true, status }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
