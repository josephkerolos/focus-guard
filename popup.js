// FocusGuard - Popup Dashboard

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();

  document.getElementById('enabled-toggle').addEventListener('change', (e) => {
    chrome.runtime.sendMessage({ type: 'toggle-enabled', enabled: e.target.checked }, () => {
      loadDashboard();
    });
  });

  document.getElementById('pause-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'pause-tracking', minutes: 15 }, (response) => {
      if (response && response.success) {
        loadDashboard();
      }
    });
  });

  document.getElementById('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});

function loadDashboard() {
  chrome.runtime.sendMessage({ type: 'get-stats' }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    const { config, stats, date } = response;

    // Update date label
    document.getElementById('date-label').textContent = formatDate(date);

    // Update toggle
    document.getElementById('enabled-toggle').checked = config.enabled;

    // Update pause notice
    const pauseNotice = document.getElementById('pause-notice');
    if (config.pause_until && Date.now() < config.pause_until) {
      pauseNotice.style.display = 'block';
      const pauseTime = new Date(config.pause_until);
      document.getElementById('pause-time').textContent =
        pauseTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      pauseNotice.style.display = 'none';
    }

    // Render sites
    const sitesList = document.getElementById('sites-list');
    const sites = config.tracked_sites;

    if (!sites || Object.keys(sites).length === 0) {
      sitesList.innerHTML = '<div class="empty-state">No sites tracked. Add some in Settings.</div>';
      return;
    }

    sitesList.innerHTML = '';

    for (const [site, siteConfig] of Object.entries(sites)) {
      const siteStats = stats[site] || { timeSpent: 0, overrides: 0, blocked: false };
      const timeSpent = siteStats.timeSpent || 0;
      const limit = siteConfig.limit || 60;
      const pct = Math.min(100, (timeSpent / limit) * 100);
      const overridesUsed = siteStats.overrides || 0;
      const overridesRemaining = Math.max(0, 3 - overridesUsed);
      const isBlocked = siteStats.blocked || false;

      let barClass = 'green';
      if (pct >= 80) barClass = 'red';
      else if (pct >= 50) barClass = 'yellow';
      if (isBlocked) barClass = 'blocked';

      const card = document.createElement('div');
      card.className = 'site-card';
      card.innerHTML = `
        <div class="site-header">
          <span class="site-name ${isBlocked ? 'site-blocked-label' : ''}">${site}</span>
          <span class="site-time">${timeSpent}m / ${limit}m</span>
        </div>
        <div class="site-bar-bg">
          <div class="site-bar-fill ${barClass}" style="width: ${pct}%"></div>
        </div>
        <div class="site-footer">
          ${isBlocked ? '<span style="color:#e94560">Blocked</span>' : '<span></span>'}
          <span class="overrides-badge">${overridesRemaining} overrides left</span>
        </div>
      `;
      sitesList.appendChild(card);
    }
  });
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}
