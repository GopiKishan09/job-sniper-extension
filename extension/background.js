// background.js

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autoRefresh") {
    chrome.storage.local.get(["autoRefresh"], (result) => {
      if (result.autoRefresh) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].url && tabs[0].url.includes("linkedin.com/jobs")) {
            chrome.tabs.reload(tabs[0].id);

            chrome.notifications.create({
              type: "basic",
              iconUrl: "icons/icon128.png",
              title: "Job Sniper",
              message: "Page auto-refreshed! New jobs may be available.",
              silent: false
            });
          }
        });
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startAutoRefresh") {
    chrome.alarms.create("autoRefresh", { periodInMinutes: 1 }); // ✅ FIXED
    sendResponse({ status: "started" });
  }

  if (message.action === "stopAutoRefresh") {
    chrome.alarms.clear("autoRefresh");
    sendResponse({ status: "stopped" });
  }

  return true;
});
