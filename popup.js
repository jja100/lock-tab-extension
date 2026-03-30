console.log('[TabLocker] Popup loaded');
const btn = document.getElementById('lockBtn');
const icon = document.getElementById('lockIcon');
chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  const tab = tabs[0];
  console.log('[TabLocker] Active tab:', tab);
  chrome.storage.local.get(['lockedTabs'], (res) => {
    const isLocked = res.lockedTabs && res.lockedTabs[tab.id];
    console.log(`[TabLocker] Tab ${tab.id} isLocked:`, isLocked);
    btn.innerText = isLocked ? "Unlock Tab" : "Lock Tab";
    icon.src = isLocked ? "locked.png" : "unlocked.png";
    if (isLocked) btn.classList.add('locked');
    else btn.classList.remove('locked');
  });

  btn.onclick = () => {
    console.log(`[TabLocker] Button clicked for tab ${tab.id}`);
    chrome.runtime.sendMessage({action: "toggleLock", tabId: tab.id, url: tab.url}, (res) => {
      console.log('[TabLocker] toggleLock response:', res);
      btn.innerText = res.isLocked ? "Unlock Tab" : "Lock Tab";
      icon.src = res.isLocked ? "locked.png" : "unlocked.png";
      btn.classList.toggle('locked', res.isLocked);
    });
  };
});
