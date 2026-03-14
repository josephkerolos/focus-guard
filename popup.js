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

const ACHIEVEMENT_LABELS = {
  'weigh_in': { icon: '⚖️', label: 'Weigh In' },
  'workout': { icon: '💪', label: 'Workout' },
  'dev_hours': { icon: '💻', label: 'Dev Hours' },
  'steps': { icon: '🚶', label: 'Steps' },
  'meditation': { icon: '🧘', label: 'Meditation' },
  'reading': { icon: '📖', label: 'Reading' },
  'journal': { icon: '📝', label: 'Journal' },
  'clean_eating': { icon: '🥗', label: 'Clean Eating' }
};

function formatMinutes(m) {
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h${rem}m` : `${h}h`;
  }
  return `${m}m`;
}

function shortSiteName(site) {
  return site.replace('.com', '').replace('.org', '').replace('.net', '');
}

function loadDashboard() {
  // Load server connection status
  chrome.runtime.sendMessage({ type: 'get-server-status' }, (response) => {
    if (chrome.runtime.lastError) return;
    const indicator = document.getElementById('server-indicator');
    if (response && response.connected) {
      indicator.className = 'server-indicator online';
      indicator.title = 'Server: connected';
    } else {
      indicator.className = 'server-indicator offline';
      indicator.title = 'Server: offline';
    }
  });

  // Load latest server message
  chrome.storage.local.get(['server_last_message'], (data) => {
    const msgDiv = document.getElementById('server-message');
    if (data.server_last_message) {
      msgDiv.textContent = data.server_last_message;
      msgDiv.style.display = 'block';
    } else {
      msgDiv.style.display = 'none';
    }
  });

  chrome.runtime.sendMessage({ type: 'get-stats' }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    const { config, stats, achievements, date } = response;
    const achievementMode = config.achievement_mode || false;

    // Update date label (preserve the server indicator span)
    const dateLabel = document.getElementById('date-label');
    const indicator = document.getElementById('server-indicator');
    dateLabel.textContent = formatDate(date) + ' ';
    dateLabel.appendChild(indicator);

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

    // Render achievements section
    const achievementsSection = document.getElementById('achievements-section');
    const achievementsList = document.getElementById('achievements-list');
    if (achievementMode && achievements && achievements.completed) {
      achievementsSection.style.display = 'block';
      achievementsList.innerHTML = '';

      for (const [key, ach] of Object.entries(achievements.completed)) {
        const meta = ACHIEVEMENT_LABELS[key] || { icon: '🏆', label: key };
        const status = ach.done ? '✅' : '⬜';
        const unlockSites = (ach.unlocks || []).map(s => shortSiteName(s)).join('/');
        const timeLabel = formatMinutes(ach.minutes || 0);

        let progressText = '';
        if (!ach.done && ach.target && ach.current !== undefined) {
          progressText = ` (${ach.current}/${ach.target})`;
        }

        const row = document.createElement('div');
        row.className = 'achievement-row' + (ach.done ? ' done' : '');
        row.innerHTML = `
          <span class="ach-icon">${meta.icon}</span>
          <span class="ach-label">${meta.label}</span>
          <span class="ach-arrow">→</span>
          <span class="ach-unlock">${timeLabel} ${unlockSites}${progressText}</span>
          <span class="ach-status">${status}</span>
        `;
        achievementsList.appendChild(row);
      }
    } else {
      achievementsSection.style.display = 'none';
    }

    // Build per-site earned minutes map from achievements
    const earnedMinutesMap = {};
    const siteLockedMap = {};
    if (achievementMode && achievements && achievements.completed) {
      for (const site of Object.keys(config.tracked_sites)) {
        let earned = 0;
        for (const [, ach] of Object.entries(achievements.completed)) {
          if (ach.done && ach.unlocks && ach.unlocks.includes(site)) {
            earned += ach.minutes || 0;
          }
        }
        earnedMinutesMap[site] = earned;
        siteLockedMap[site] = earned === 0;
      }
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
      const isLocked = achievementMode && siteLockedMap[site];
      const effectiveLimit = achievementMode && earnedMinutesMap[site] !== undefined && earnedMinutesMap[site] > 0
        ? earnedMinutesMap[site]
        : siteConfig.limit || 60;
      const limit = isLocked ? 0 : effectiveLimit;
      const pct = isLocked ? 0 : Math.min(100, (timeSpent / limit) * 100);
      const overridesUsed = siteStats.overrides || 0;
      const overridesRemaining = Math.max(0, 3 - overridesUsed);
      const isBlocked = isLocked || siteStats.blocked || false;

      let barClass = 'green';
      if (isLocked) barClass = 'locked';
      else if (pct >= 80) barClass = 'red';
      else if (pct >= 50) barClass = 'yellow';
      if (siteStats.blocked) barClass = 'blocked';

      let statusHtml = '';
      if (isLocked) {
        statusHtml = '<span class="locked-label">🔒 Locked</span>';
      } else if (siteStats.blocked) {
        statusHtml = '<span style="color:#e94560">Blocked</span>';
      } else {
        statusHtml = '<span></span>';
      }

      const card = document.createElement('div');
      card.className = 'site-card' + (isLocked ? ' site-card-locked' : '');
      card.innerHTML = `
        <div class="site-header">
          <span class="site-name ${isBlocked ? 'site-blocked-label' : ''}">${site}</span>
          <span class="site-time">${isLocked ? '🔒' : timeSpent + 'm / ' + limit + 'm'}</span>
        </div>
        <div class="site-bar-bg">
          <div class="site-bar-fill ${barClass}" style="width: ${pct}%"></div>
        </div>
        <div class="site-footer">
          ${statusHtml}
          ${isLocked ? '<span></span>' : `<span class="overrides-badge">${overridesRemaining} overrides left</span>`}
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
