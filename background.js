const TAB_LOCK_KEY = "tabLockerLocked";
const WINDOW_LOCKS_KEY = "tabLockerWindowLockedUrls";
const GLOBAL_LOCKS_KEY = "tabLockerGlobalLockedUrls";

const supportsTabSessionValues =
  !!chrome.sessions &&
  typeof chrome.sessions.getTabValue === "function" &&
  typeof chrome.sessions.setTabValue === "function";

const supportsWindowSessionValues =
  !!chrome.sessions &&
  typeof chrome.sessions.getWindowValue === "function" &&
  typeof chrome.sessions.setWindowValue === "function";

let lockedTabs = {}; // { [tabId]: { initialUrl, lastUrl, windowId } }
let windowLockedUrlCounts = {}; // { [windowId]: { [url]: count } }
let globalLockedUrlCounts = {}; // { [url]: count }

console.log("[TabLocker] Background script loaded");

function normalizeUrl(url) {
  if (!url || typeof url !== "string") {
    return "";
  }
  return url.trim();
}

function updateTabIcon(tabId) {
  const isLocked = !!lockedTabs[tabId];
  const iconPath = isLocked ? { 128: "locked.png" } : { 128: "unlocked.png" };
  chrome.action.setIcon({ tabId, path: iconPath });
}

function saveRuntimeLocks() {
  chrome.storage.local.set({ lockedTabs, [GLOBAL_LOCKS_KEY]: globalLockedUrlCounts });
}

function getWindowCounts(windowId) {
  if (!windowLockedUrlCounts[windowId]) {
    windowLockedUrlCounts[windowId] = {};
  }
  return windowLockedUrlCounts[windowId];
}

function persistWindowCounts(windowId) {
  if (!supportsWindowSessionValues) {
    return;
  }

  const counts = getWindowCounts(windowId);
  chrome.sessions.setWindowValue(windowId, WINDOW_LOCKS_KEY, counts, () => {
    if (chrome.runtime.lastError) {
      console.warn("[TabLocker] Could not persist window lock map:", chrome.runtime.lastError.message);
    }
  });
}

function incrementGlobalUrlLock(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return;
  }

  globalLockedUrlCounts[normalized] = (globalLockedUrlCounts[normalized] || 0) + 1;
}

function decrementGlobalUrlLock(url) {
  const normalized = normalizeUrl(url);
  if (!normalized || !globalLockedUrlCounts[normalized]) {
    return;
  }

  globalLockedUrlCounts[normalized] -= 1;
  if (globalLockedUrlCounts[normalized] <= 0) {
    delete globalLockedUrlCounts[normalized];
  }
}

function incrementWindowUrlLock(windowId, url) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return;
  }

  const counts = getWindowCounts(windowId);
  counts[normalized] = (counts[normalized] || 0) + 1;
  persistWindowCounts(windowId);
}

function decrementWindowUrlLock(windowId, url) {
  const normalized = normalizeUrl(url);
  if (!normalized || !windowLockedUrlCounts[windowId]) {
    return;
  }

  const counts = getWindowCounts(windowId);
  if (!counts[normalized]) {
    return;
  }

  counts[normalized] -= 1;
  if (counts[normalized] <= 0) {
    delete counts[normalized];
  }
  persistWindowCounts(windowId);
}

function lockTab(tab, source) {
  if (!tab || !tab.id || !tab.url) {
    return;
  }

  const tabId = tab.id;
  const windowId = tab.windowId;
  const normalized = normalizeUrl(tab.url);

  if (lockedTabs[tabId]) {
    updateTabIcon(tabId);
    return;
  }

  console.log(`[TabLocker] (${source}) Locking tab ${tabId} with URL:`, normalized);
  lockedTabs[tabId] = {
    initialUrl: normalized,
    lastUrl: normalized,
    windowId
  };

  if (supportsTabSessionValues) {
    chrome.sessions.setTabValue(tabId, TAB_LOCK_KEY, true, () => {
      if (chrome.runtime.lastError) {
        console.warn("[TabLocker] Could not persist tab lock flag:", chrome.runtime.lastError.message);
      }
    });
  }

  incrementWindowUrlLock(windowId, normalized);
  incrementGlobalUrlLock(normalized);
  saveRuntimeLocks();
  updateTabIcon(tabId);
}

function unlockTab(tab, source) {
  if (!tab || !tab.id) {
    return;
  }

  const tabId = tab.id;
  const lock = lockedTabs[tabId];
  if (!lock) {
    updateTabIcon(tabId);
    return;
  }

  const lockUrl = lock.lastUrl || lock.initialUrl || tab.url;
  console.log(`[TabLocker] (${source}) Unlocking tab ${tabId}`);

  delete lockedTabs[tabId];

  if (supportsTabSessionValues) {
    chrome.sessions.setTabValue(tabId, TAB_LOCK_KEY, false, () => {
      if (chrome.runtime.lastError) {
        console.warn("[TabLocker] Could not clear tab lock flag:", chrome.runtime.lastError.message);
      }
    });
  }

  decrementWindowUrlLock(tab.windowId, lockUrl);
  decrementGlobalUrlLock(lockUrl);
  saveRuntimeLocks();
  updateTabIcon(tabId);
}

function shouldLockFromWindowMap(tab) {
  const normalized = normalizeUrl(tab.url);
  if (!normalized) {
    return false;
  }

  if (supportsWindowSessionValues) {
    const counts = windowLockedUrlCounts[tab.windowId];
    return !!(counts && counts[normalized] > 0);
  }

  return !!globalLockedUrlCounts[normalized];
}

function ensureTabLockState(tab) {
  if (!tab || !tab.id || !tab.url) {
    return;
  }

  const tabId = tab.id;
  if (lockedTabs[tabId]) {
    updateTabIcon(tabId);
    return;
  }

  if (!supportsTabSessionValues) {
    if (shouldLockFromWindowMap(tab)) {
      lockTab(tab, "Rehydrate");
    } else {
      updateTabIcon(tabId);
    }
    return;
  }

  chrome.sessions.getTabValue(tabId, TAB_LOCK_KEY, (tabLockValue) => {
    if (chrome.runtime.lastError) {
      console.warn("[TabLocker] Could not read tab lock flag:", chrome.runtime.lastError.message);
    }

    const shouldLock = !!tabLockValue || shouldLockFromWindowMap(tab);
    if (shouldLock) {
      lockTab(tab, "Rehydrate");
    } else {
      updateTabIcon(tabId);
    }
  });
}

function getIsLocked(tab, callback) {
  if (!tab || !tab.id) {
    callback(false);
    return;
  }

  if (lockedTabs[tab.id]) {
    callback(true);
    return;
  }

  if (!supportsTabSessionValues) {
    callback(shouldLockFromWindowMap(tab));
    return;
  }

  chrome.sessions.getTabValue(tab.id, TAB_LOCK_KEY, (tabLockValue) => {
    if (chrome.runtime.lastError) {
      callback(shouldLockFromWindowMap(tab));
      return;
    }
    callback(!!tabLockValue || shouldLockFromWindowMap(tab));
  });
}

function initializeLocks() {
  chrome.storage.local.get(["lockedTabs", GLOBAL_LOCKS_KEY], (result) => {
    const persisted = result.lockedTabs || {};
    globalLockedUrlCounts = result[GLOBAL_LOCKS_KEY] || {};
    lockedTabs = {};

    chrome.windows.getAll({}, (windows) => {
      if (!windows || windows.length === 0) {
        saveRuntimeLocks();
        return;
      }

      if (!supportsWindowSessionValues) {
        tabsFromAllWindows(persisted);
        return;
      }

      let pendingWindows = windows.length;
      windows.forEach((windowObj) => {
        chrome.sessions.getWindowValue(windowObj.id, WINDOW_LOCKS_KEY, (value) => {
          if (!chrome.runtime.lastError && value && typeof value === "object") {
            windowLockedUrlCounts[windowObj.id] = value;
          } else {
            windowLockedUrlCounts[windowObj.id] = windowLockedUrlCounts[windowObj.id] || {};
          }

          pendingWindows -= 1;
          if (pendingWindows === 0) {
            tabsFromAllWindows(persisted);
          }
        });
      });
    });
  });
}

function tabsFromAllWindows(persisted) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (!tab.id || !tab.url) {
        return;
      }
      if (persisted[tab.id]) {
        lockedTabs[tab.id] = {
          initialUrl: persisted[tab.id].initialUrl || tab.url,
          lastUrl: persisted[tab.id].lastUrl || tab.url,
          windowId: tab.windowId
        };
      }
    });

    tabs.forEach((tab) => ensureTabLockState(tab));
    saveRuntimeLocks();
    console.log("[TabLocker] Lock initialization complete");
  });
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-lock-tab") {
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id || !tab.url) {
      return;
    }

    if (lockedTabs[tab.id]) {
      unlockTab(tab, "Shortcut");
    } else {
      lockTab(tab, "Shortcut");
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.id || !tab.url) {
    return;
  }

  if (lockedTabs[tabId] && changeInfo.url) {
    lockedTabs[tabId].lastUrl = normalizeUrl(changeInfo.url);
    saveRuntimeLocks();
  }

  if (changeInfo.status === "complete" || changeInfo.url) {
    ensureTabLockState(tab);
  } else {
    updateTabIcon(tabId);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  ensureTabLockState(tab);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      return;
    }
    ensureTabLockState(tab);
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const lock = lockedTabs[tabId];
  if (!lock) {
    return;
  }

  if (!removeInfo.isWindowClosing) {
    const initialUrl = lock.initialUrl;
    const windowId = lock.windowId;

    console.log(`[TabLocker] Locked tab ${tabId} closed, restoring with URL:`, initialUrl);
    delete lockedTabs[tabId];
    saveRuntimeLocks();

    chrome.tabs.create({ url: initialUrl, windowId }, (newTab) => {
      if (!newTab || !newTab.id || !newTab.url) {
        return;
      }
      lockTab(newTab, "RestoreClosedLockedTab");
    });
    return;
  }

  // Preserve window/session lock intent on window close so lock survives workspace reopen.
  delete lockedTabs[tabId];
  saveRuntimeLocks();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) {
    return false;
  }

  if (request.action === "toggleLock") {
    chrome.tabs.get(request.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id || !tab.url) {
        sendResponse({ isLocked: false, error: "Tab not found" });
        return;
      }

      if (lockedTabs[tab.id]) {
        unlockTab(tab, "Popup");
      } else {
        lockTab(tab, "Popup");
      }

      sendResponse({ isLocked: !!lockedTabs[tab.id] });
    });
    return true;
  }

  if (request.action === "getLockState") {
    chrome.tabs.get(request.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id) {
        sendResponse({ isLocked: false });
        return;
      }

      getIsLocked(tab, (isLocked) => {
        if (isLocked && !lockedTabs[tab.id]) {
          ensureTabLockState(tab);
        }
        sendResponse({ isLocked });
      });
    });
    return true;
  }

  return false;
});

initializeLocks();