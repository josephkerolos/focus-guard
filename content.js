// FocusGuard - Content Script
// Injected on all pages; shows block overlay when site is blocked

let overlayActive = false;
let currentChallenge = '';

// On load, check if this site should be blocked
chrome.runtime.sendMessage({ type: 'check-block', url: window.location.href }, (response) => {
  if (chrome.runtime.lastError) return;
  if (response && response.blocked) {
    showBlockOverlay(response);
  }
  if (response && response.tracked && !response.blocked) {
    chrome.runtime.sendMessage({ type: 'site-visit', url: window.location.href });
  }
});

// Listen for block messages from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'focusguard-block') {
    showBlockOverlay(msg);
  }
  if (msg.type === 'focusguard-unblock') {
    removeOverlay();
  }
});

function generateChallenge() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function showBlockOverlay(data) {
  if (overlayActive) return;
  overlayActive = true;

  const overlay = document.createElement('div');
  overlay.id = 'focusguard-overlay';

  const isAchievementLocked = data.reason === 'achievement_locked';

  const reasonText = {
    'limit': 'Daily time limit reached',
    'cutoff': 'Past cutoff hours',
    'scheduled': 'Blocked by schedule',
    'achievement_locked': 'Locked — achievements required'
  }[data.reason] || 'Site blocked';

  const overridesUsed = data.overridesUsed || 0;
  const overridesRemaining = isAchievementLocked ? 0 : Math.max(0, 3 - overridesUsed);
  currentChallenge = generateChallenge();

  // Build achievement unlock hints for achievement_locked blocks
  let achievementHintsHtml = '';
  if (isAchievementLocked) {
    const achievementLabels = {
      'weigh_in': '⚖️ Weigh In',
      'workout': '💪 Workout',
      'dev_hours': '💻 Dev Hours',
      'steps': '🚶 Steps',
      'meditation': '🧘 Meditation',
      'reading': '📖 Reading',
      'journal': '📝 Journal',
      'clean_eating': '🥗 Clean Eating'
    };
    const needed = data.neededAchievements || [];
    if (needed.length > 0) {
      const hints = needed.map(k => achievementLabels[k] || k).join(' or ');
      achievementHintsHtml = `
        <div class="fg-achievement-hints">
          <p class="fg-achievement-hint-label">Complete to unlock:</p>
          <p class="fg-achievement-hint-items">${hints}</p>
        </div>
      `;
    } else {
      achievementHintsHtml = `
        <div class="fg-achievement-hints">
          <p class="fg-achievement-hint-label">No achievements configured to unlock this site today.</p>
        </div>
      `;
    }
  }

  overlay.innerHTML = `
    <style>
      #focusguard-overlay {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: #1a1a2e !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: system-ui, -apple-system, sans-serif !important;
      }
      #focusguard-overlay * {
        box-sizing: border-box !important;
      }
      .fg-container {
        text-align: center !important;
        max-width: 560px !important;
        padding: 48px !important;
        background: #16213e !important;
        border-radius: 16px !important;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
      }
      .fg-shield {
        font-size: 64px !important;
        margin-bottom: 16px !important;
      }
      .fg-title {
        font-size: 28px !important;
        font-weight: 700 !important;
        color: #e94560 !important;
        margin: 0 0 8px 0 !important;
      }
      .fg-reason {
        font-size: 16px !important;
        color: #8892b0 !important;
        margin: 0 0 24px 0 !important;
      }
      .fg-site {
        display: inline-block !important;
        padding: 4px 12px !important;
        background: #0f3460 !important;
        border-radius: 6px !important;
        color: #ccd6f6 !important;
        font-size: 14px !important;
        margin-bottom: 24px !important;
      }
      .fg-quote {
        font-size: 18px !important;
        font-style: italic !important;
        color: #ccd6f6 !important;
        line-height: 1.6 !important;
        margin: 0 0 32px 0 !important;
        padding: 16px !important;
        border-left: 3px solid #e94560 !important;
        text-align: left !important;
      }
      .fg-override-section {
        border-top: 1px solid #0f3460 !important;
        padding-top: 24px !important;
      }
      .fg-override-label {
        font-size: 14px !important;
        color: #8892b0 !important;
        margin: 0 0 8px 0 !important;
      }
      .fg-challenge-display {
        font-family: 'Courier New', monospace !important;
        font-size: 18px !important;
        color: #e94560 !important;
        background: #0d1b30 !important;
        padding: 12px 16px !important;
        border-radius: 8px !important;
        letter-spacing: 2px !important;
        margin: 12px 0 !important;
        user-select: none !important;
        -webkit-user-select: none !important;
      }
      .fg-challenge-input {
        width: 100% !important;
        padding: 12px 16px !important;
        background: #0d1b30 !important;
        border: 2px solid #0f3460 !important;
        border-radius: 8px !important;
        color: #ccd6f6 !important;
        font-family: 'Courier New', monospace !important;
        font-size: 16px !important;
        letter-spacing: 1px !important;
        outline: none !important;
        margin: 8px 0 !important;
      }
      .fg-challenge-input:focus {
        border-color: #e94560 !important;
      }
      .fg-submit-btn {
        padding: 10px 24px !important;
        background: #e94560 !important;
        color: #fff !important;
        border: none !important;
        border-radius: 8px !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        margin-top: 8px !important;
        transition: background 0.2s !important;
      }
      .fg-submit-btn:hover {
        background: #c73a52 !important;
      }
      .fg-submit-btn:disabled {
        background: #333 !important;
        cursor: not-allowed !important;
      }
      .fg-overrides-info {
        font-size: 13px !important;
        color: #8892b0 !important;
        margin-top: 8px !important;
      }
      .fg-error {
        color: #e94560 !important;
        font-size: 14px !important;
        margin-top: 8px !important;
      }
      .fg-no-overrides {
        color: #8892b0 !important;
        font-size: 15px !important;
      }
      .fg-achievement-hints {
        margin: 24px 0 0 0 !important;
        padding: 16px !important;
        background: #0d1b30 !important;
        border-radius: 10px !important;
        border: 1px solid #0f3460 !important;
      }
      .fg-achievement-hint-label {
        font-size: 13px !important;
        color: #8892b0 !important;
        margin: 0 0 8px 0 !important;
      }
      .fg-achievement-hint-items {
        font-size: 16px !important;
        color: #ccd6f6 !important;
        margin: 0 !important;
        line-height: 1.6 !important;
      }
    </style>
    <div class="fg-container">
      <div class="fg-shield">${isAchievementLocked ? '🔒' : '🛡️'}</div>
      <h1 class="fg-title">${isAchievementLocked ? 'Site Locked' : 'FocusGuard Active'}</h1>
      <p class="fg-reason">${reasonText}</p>
      <div class="fg-site">${data.site || ''}</div>
      ${isAchievementLocked ? achievementHintsHtml : `<p class="fg-quote">"${data.quote || ''}"</p>`}
      ${isAchievementLocked ? `
        <div class="fg-override-section">
          <p class="fg-no-overrides">Complete achievements to earn time on this site.</p>
        </div>
      ` : overridesRemaining > 0 ? `
        <div class="fg-override-section">
          <p class="fg-override-label">Need 5 more minutes? Type the code below exactly:</p>
          <div class="fg-challenge-display" id="fg-challenge">${currentChallenge}</div>
          <input type="text" class="fg-challenge-input" id="fg-challenge-input" placeholder="Type the code above..." autocomplete="off" spellcheck="false">
          <div id="fg-error" class="fg-error" style="display:none"></div>
          <button class="fg-submit-btn" id="fg-submit-btn">Override (5 min)</button>
          <p class="fg-overrides-info">${overridesRemaining} override${overridesRemaining !== 1 ? 's' : ''} remaining today</p>
        </div>
      ` : `
        <div class="fg-override-section">
          <p class="fg-no-overrides">No overrides remaining today. Go build something.</p>
        </div>
      `}
    </div>
  `;

  document.documentElement.appendChild(overlay);

  // Prevent paste on challenge input
  const input = document.getElementById('fg-challenge-input');
  if (input) {
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const errEl = document.getElementById('fg-error');
      if (errEl) {
        errEl.textContent = 'No pasting allowed. Type it out.';
        errEl.style.display = 'block';
      }
    });

    // Prevent drag-and-drop
    input.addEventListener('drop', (e) => {
      e.preventDefault();
    });

    const submitBtn = document.getElementById('fg-submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', () => handleOverrideSubmit(data.site));
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleOverrideSubmit(data.site);
    });
  }

  // Block keyboard shortcuts and scrolling
  document.addEventListener('keydown', blockKeyHandler, true);
}

function blockKeyHandler(e) {
  // Allow typing in the challenge input
  if (e.target && e.target.id === 'fg-challenge-input') return;
  // Block most key combos to prevent navigation
  if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.metaKey && e.key === 'r')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function handleOverrideSubmit(site) {
  const input = document.getElementById('fg-challenge-input');
  const errEl = document.getElementById('fg-error');
  if (!input) return;

  const value = input.value.trim();
  if (value !== currentChallenge) {
    if (errEl) {
      errEl.textContent = 'Code does not match. Try again carefully.';
      errEl.style.display = 'block';
    }
    input.value = '';
    input.focus();
    return;
  }

  // Send override request
  chrome.runtime.sendMessage({
    type: 'override-request',
    site: site,
    challengeResponse: value,
    expectedChallenge: currentChallenge
  }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response && response.success) {
      removeOverlay();
    } else {
      if (errEl) {
        errEl.textContent = response ? response.error : 'Override failed';
        errEl.style.display = 'block';
      }
    }
  });
}

function removeOverlay() {
  const overlay = document.getElementById('focusguard-overlay');
  if (overlay) {
    overlay.remove();
  }
  overlayActive = false;
  document.removeEventListener('keydown', blockKeyHandler, true);
}
