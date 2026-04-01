console.log('[TabLocker] Popup loaded');
const btn = document.getElementById('lockBtn');
const icon = document.getElementById('lockIcon');

function renderState(isLocked) {
  btn.innerText = isLocked ? 'Unlock Tab' : 'Lock Tab';
  icon.src = isLocked ? 'locked.png' : 'unlocked.png';
  btn.classList.toggle('locked', isLocked);
}

chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
  const tab = tabs[0];
  if (!tab || !tab.id) {
    return;
  }

  console.log('[TabLocker] Active tab:', tab);
  chrome.runtime.sendMessage({ action: 'getLockState', tabId: tab.id }, (res) => {
    const isLocked = !!(res && res.isLocked);
    console.log(`[TabLocker] Tab ${tab.id} isLocked:`, isLocked);
    renderState(isLocked);
  });

  btn.onclick = () => {
    console.log(`[TabLocker] Button clicked for tab ${tab.id}`);
    chrome.runtime.sendMessage({action: "toggleLock", tabId: tab.id, url: tab.url}, (res) => {
      console.log('[TabLocker] toggleLock response:', res);
      renderState(!!(res && res.isLocked));
    });
  };
});
