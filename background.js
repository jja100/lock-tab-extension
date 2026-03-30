// Helper to update the icon for a tab
function updateTabIcon(tabId) {
  const isLocked = lockedTabs[tabId];
  const iconPath = isLocked ? { 128: "locked.png" } : { 128: "unlocked.png" };
  chrome.action.setIcon({
    tabId,
    path: iconPath
  });
}

// Listen for keyboard shortcut command to toggle lock
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-lock-tab') {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id || !tab.url) return;
      if (lockedTabs[tab.id]) {
        console.log(`[TabLocker] (Shortcut) Unlocking tab ${tab.id}`);
        delete lockedTabs[tab.id];
      } else {
        console.log(`[TabLocker] (Shortcut) Locking tab ${tab.id} with URL:`, tab.url);
        lockedTabs[tab.id] = { initialUrl: tab.url, lastUrl: tab.url };
      }
      chrome.storage.local.set({lockedTabs}, () => {
        updateTabIcon(tab.id);
      });
    // Listen for messages from popup to toggle lock and update icon
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "toggleLock" && message.tabId) {
        const tabId = message.tabId;
        if (lockedTabs[tabId]) {
          delete lockedTabs[tabId];
        } else {
          lockedTabs[tabId] = { initialUrl: message.url, lastUrl: message.url };
        }
        chrome.storage.local.set({lockedTabs}, () => {
          updateTabIcon(tabId);
          sendResponse({ isLocked: !!lockedTabs[tabId] });
        });
        return true; // Indicates async response
      }
    });
    });
  }
});
let lockedTabs = {}; // { [tabId]: { initialUrl, lastUrl } }
console.log('[TabLocker] Background script loaded');

// Load locked tabs from storage on startup
chrome.storage.local.get(['lockedTabs'], (result) => {
  if (result.lockedTabs) {
    lockedTabs = result.lockedTabs;
    console.log('[TabLocker] Loaded lockedTabs from storage:', lockedTabs);
  } else {
    console.log('[TabLocker] No lockedTabs found in storage');
  }
});

// Listen for tab updates to keep the latest URL for locked tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  updateTabIcon(tabId);
  if (lockedTabs[tabId] && changeInfo.url) {
    console.log(`[TabLocker] Tab ${tabId} updated URL to`, changeInfo.url);
    lockedTabs[tabId].lastUrl = changeInfo.url;
    chrome.storage.local.set({lockedTabs});
  }
});

// Intercept tab close and restore if locked
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (lockedTabs[tabId] && !removeInfo.isWindowClosing) {
    const initialUrl = lockedTabs[tabId].initialUrl;
    console.log(`[TabLocker] Locked tab ${tabId} closed, restoring with initial URL:`, initialUrl);
    // Remove lock before recreating to avoid infinite loop
    delete lockedTabs[tabId];
    chrome.storage.local.set({lockedTabs});
    chrome.tabs.create({url: initialUrl}, (newTab) => {
      if (newTab && newTab.id) {
        // Re-lock the restored tab with the same initialUrl
        lockedTabs[newTab.id] = { initialUrl, lastUrl: initialUrl };
        chrome.storage.local.set({lockedTabs});
        updateTabIcon(newTab.id);
        console.log(`[TabLocker] Re-locked restored tab ${newTab.id}`);
      }
    });
  } else {
    // Clean up lock if tab is closed normally
    if (lockedTabs[tabId]) {
      console.log(`[TabLocker] Tab ${tabId} closed, removing lock`);
      delete lockedTabs[tabId];
      chrome.storage.local.set({lockedTabs});
    }
  }
});

// Listen for messages from the popup to toggle lock
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[TabLocker] Received message:', request);
  if (request.action === "toggleLock") {
    if (lockedTabs[request.tabId]) {
      console.log(`[TabLocker] Unlocking tab ${request.tabId}`);
      delete lockedTabs[request.tabId];
    } else {
      console.log(`[TabLocker] Locking tab ${request.tabId} with URL:`, request.url);
      lockedTabs[request.tabId] = { initialUrl: request.url, lastUrl: request.url };
    }
    chrome.storage.local.set({lockedTabs});
    updateTabIcon(request.tabId);
    sendResponse({isLocked: !!lockedTabs[request.tabId]});
  // Update icon when switching tabs
  chrome.tabs.onActivated.addListener((activeInfo) => {
    updateTabIcon(activeInfo.tabId);
  });
  }
});