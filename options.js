// FocusGuard - Options Page

let currentConfig = null;

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  bindEvents();
});

function bindEvents() {
  document.getElementById('add-site-btn').addEventListener('click', addSite);
  document.getElementById('new-site-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addSite();
  });
  document.getElementById('test-webhook-btn').addEventListener('click', testWebhook);
  document.getElementById('webhook-url').addEventListener('change', saveWebhookUrl);
  document.getElementById('save-schedule-btn').addEventListener('click', saveSchedule);
  document.getElementById('export-btn').addEventListener('click', exportSettings);
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importSettings);
  document.getElementById('reset-stats-btn').addEventListener('click', resetStats);
}

function loadSettings() {
  chrome.runtime.sendMessage({ type: 'get-stats' }, (response) => {
    if (chrome.runtime.lastError || !response) return;

    currentConfig = response.config;
    renderSites(currentConfig.tracked_sites);
    document.getElementById('webhook-url').value = currentConfig.webhook_url || '';

    // Load schedule blocks
    const scheduleBlocks = response.scheduleBlocks || [];
    if (scheduleBlocks.length > 0) {
      document.getElementById('schedule-json').value = JSON.stringify(scheduleBlocks, null, 2);
    }
  });
}

function renderSites(sites) {
  const list = document.getElementById('sites-list');
  list.innerHTML = '';

  for (const [site, config] of Object.entries(sites)) {
    const row = document.createElement('div');
    row.className = 'site-config-row';
    row.innerHTML = `
      <span class="site-name">${site}</span>
      <span class="field-label">Limit:</span>
      <input type="number" class="input" value="${config.limit}" min="1" data-site="${site}" data-field="limit">
      <span class="field-label">min</span>
      <span class="field-label">Cutoff:</span>
      <input type="number" class="input" value="${config.cutoff !== null && config.cutoff !== undefined ? config.cutoff : ''}" min="0" max="23" placeholder="—" data-site="${site}" data-field="cutoff">
      <span class="field-label">h</span>
      <button class="btn btn-danger btn-sm" data-remove-site="${site}">✕</button>
    `;
    list.appendChild(row);
  }

  // Bind events for limit/cutoff changes
  list.querySelectorAll('input[data-field]').forEach(input => {
    input.addEventListener('change', () => {
      const site = input.dataset.site;
      const field = input.dataset.field;
      if (field === 'limit') {
        currentConfig.tracked_sites[site].limit = parseInt(input.value) || 30;
      } else if (field === 'cutoff') {
        const val = input.value.trim();
        currentConfig.tracked_sites[site].cutoff = val === '' ? null : parseInt(val);
      }
      saveConfig();
    });
  });

  // Bind remove buttons
  list.querySelectorAll('[data-remove-site]').forEach(btn => {
    btn.addEventListener('click', () => {
      const site = btn.dataset.removeSite;
      delete currentConfig.tracked_sites[site];
      saveConfig();
      renderSites(currentConfig.tracked_sites);
      showToast(`Removed ${site}`);
    });
  });
}

function addSite() {
  const siteInput = document.getElementById('new-site-input');
  const limitInput = document.getElementById('new-site-limit');
  const cutoffInput = document.getElementById('new-site-cutoff');

  let site = siteInput.value.trim().toLowerCase();
  if (!site) return;

  // Clean up site name
  site = site.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
  if (!site.includes('.')) {
    showToast('Enter a valid domain (e.g. tiktok.com)', true);
    return;
  }

  if (currentConfig.tracked_sites[site]) {
    showToast('Site already tracked', true);
    return;
  }

  const limit = parseInt(limitInput.value) || 30;
  const cutoffVal = cutoffInput.value.trim();
  const cutoff = cutoffVal === '' ? null : parseInt(cutoffVal);

  currentConfig.tracked_sites[site] = { limit, cutoff };
  saveConfig();
  renderSites(currentConfig.tracked_sites);

  siteInput.value = '';
  limitInput.value = '30';
  cutoffInput.value = '';
  showToast(`Added ${site}`);
}

function saveWebhookUrl() {
  const url = document.getElementById('webhook-url').value.trim();
  currentConfig.webhook_url = url;
  saveConfig();
}

function saveConfig() {
  chrome.storage.local.set({ config: currentConfig });
}

function testWebhook() {
  const url = document.getElementById('webhook-url').value.trim();
  const status = document.getElementById('webhook-status');

  if (!url) {
    status.textContent = 'Enter a URL first';
    status.className = 'status-text error';
    return;
  }

  status.textContent = 'Testing...';
  status.className = 'status-text';

  chrome.runtime.sendMessage({ type: 'test-webhook', webhook_url: url }, (response) => {
    if (chrome.runtime.lastError) {
      status.textContent = 'Error sending test';
      status.className = 'status-text error';
      return;
    }
    if (response && response.success) {
      status.textContent = `Success (${response.status})`;
      status.className = 'status-text success';
    } else {
      status.textContent = `Failed: ${response ? response.error || response.status : 'unknown'}`;
      status.className = 'status-text error';
    }
  });
}

function saveSchedule() {
  const textarea = document.getElementById('schedule-json');
  const status = document.getElementById('schedule-status');
  const raw = textarea.value.trim();

  if (!raw) {
    chrome.storage.local.set({ schedule_blocks: [] });
    status.textContent = 'Schedule cleared';
    status.className = 'status-text success';
    return;
  }

  try {
    const blocks = JSON.parse(raw);
    if (!Array.isArray(blocks)) throw new Error('Must be an array');

    // Validate structure
    for (const block of blocks) {
      if (!block.site || !block.start || !block.end) {
        throw new Error('Each block needs site, start, end');
      }
      if (!/^\d{2}:\d{2}$/.test(block.start) || !/^\d{2}:\d{2}$/.test(block.end)) {
        throw new Error('Times must be HH:MM format');
      }
    }

    chrome.storage.local.set({ schedule_blocks: blocks });
    status.textContent = `Saved ${blocks.length} block(s)`;
    status.className = 'status-text success';
  } catch (e) {
    status.textContent = `Invalid JSON: ${e.message}`;
    status.className = 'status-text error';
  }
}

function exportSettings() {
  chrome.storage.local.get(null, (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focusguard-settings-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Settings exported');
  });
}

function importSettings(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      chrome.storage.local.set(data, () => {
        showToast('Settings imported');
        loadSettings();
      });
    } catch {
      showToast('Invalid JSON file', true);
    }
  };
  reader.readAsText(file);
  // Reset input so same file can be re-imported
  e.target.value = '';
}

function resetStats() {
  if (!confirm('Reset all stats for today? This cannot be undone.')) return;

  const dateKey = new Date().toISOString().split('T')[0];
  const key = 'stats_' + dateKey;
  chrome.storage.local.remove(key, () => {
    showToast('Today\'s stats reset');
  });
}

function showToast(message, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  if (isError) {
    toast.style.background = '#e94560';
  } else {
    toast.style.background = '#0f3460';
  }
  setTimeout(() => {
    toast.style.display = 'none';
  }, 2500);
}
