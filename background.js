// FocusGuard - Background Service Worker
// Handles: time tracking, alarm-based increments, webhook sending, block state management
// Server communication: polls state, sends events

const DEFAULT_CONFIG = {
  tracked_sites: {
    'youtube.com': { limit: 120, cutoff: 22 },
    'discord.com': { limit: 60, cutoff: null },
    'instagram.com': { limit: 30, cutoff: null },
    'reddit.com': { limit: 30, cutoff: null },
    'x.com': { limit: 30, cutoff: null }
  },
  webhook_url: '',
  enabled: true,
  pause_until: null,
  achievement_mode: false
};

// Server connection state
let serverConnected = false;
let lastServerMessage = null;

const QUOTES = [
  "Watching someone else's content is borrowing their momentum. Build your own.",
  "Every minute here is a minute not building your empire.",
  "You're not bored. You're avoiding."
];

// ---- Server Communication ----

async function getServerSettings() {
  const data = await chrome.storage.sync.get(['serverUrl', 'apiKey']);
  return { serverUrl: data.serverUrl || '', apiKey: data.apiKey || '' };
}

async function serverFetch(endpoint, options = {}) {
  const { serverUrl, apiKey } = await getServerSettings();
  if (!serverUrl) return null;

  const url = serverUrl.replace(/\/$/, '') + endpoint;
  try {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...(options.headers || {})
      }
    });
    if (!resp.ok) {
      serverConnected = false;
      return null;
    }
    serverConnected = true;
    return await resp.json();
  } catch (e) {
    serverConnected = false;
    console.warn('FocusGuard server fetch failed:', e.message);
    return null;
  }
}

async function pollServerState() {
  const state = await serverFetch('/api/state');
  if (!state) return;

  // Update schedule_blocks from server
  if (state.schedule_blocks && Array.isArray(state.schedule_blocks)) {
    await chrome.storage.local.set({ schedule_blocks: state.schedule_blocks });
  }

  // Update achievements from server
  if (state.achievements && typeof state.achievements === 'object' && Object.keys(state.achievements).length > 0) {
    await chrome.storage.local.set({ achievements: state.achievements });
  }

  // Update site limits from server
  if (state.limits && typeof state.limits === 'object') {
    const config = await getConfig();
    let changed = false;
    for (const [site, minutes] of Object.entries(state.limits)) {
      if (config.tracked_sites[site]) {
        if (config.tracked_sites[site].limit !== minutes) {
          config.tracked_sites[site].limit = minutes;
          changed = true;
        }
      }
    }
    if (changed) {
      await chrome.storage.local.set({ config });
    }
  }

  // Update blocked_sites in storage for popup to read
  if (state.blocked_sites && Array.isArray(state.blocked_sites)) {
    await chrome.storage.local.set({ server_blocked_sites: state.blocked_sites });
  }

  // Show messages via notifications
  if (state.messages && Array.isArray(state.messages) && state.messages.length > 0) {
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg !== lastServerMessage) {
      lastServerMessage = lastMsg;
      await chrome.storage.local.set({ server_last_message: lastMsg });
      try {
        chrome.notifications.create('focusguard-server-msg', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'FocusGuard',
          message: lastMsg
        });
      } catch (e) {
        console.warn('Notification failed:', e);
      }
    }
  }
}

async function sendServerEvent(eventData) {
  return serverFetch('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      ...eventData,
      timestamp: new Date().toISOString()
    })
  });
}

// ---- Init ----
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['config']);
  if (!data.config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  }
  chrome.alarms.create('focusguard-tick', { periodInMinutes: 1 });
  chrome.alarms.create('focusguard-daily-summary', { periodInMinutes: 60 });
  chrome.alarms.create('focusguard-server-poll', { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('focusguard-tick', { periodInMinutes: 1 });
  chrome.alarms.create('focusguard-daily-summary', { periodInMinutes: 60 });
  chrome.alarms.create('focusguard-server-poll', { periodInMinutes: 1 });
});

// ---- Helpers ----
function todayKey() {
  const d = new Date();
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function extractSite(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname;
  } catch {
    return null;
  }
}

function matchesSite(hostname, trackedSite) {
  return hostname === trackedSite || hostname.endsWith('.' + trackedSite);
}

function findTrackedSite(url, trackedSites) {
  const hostname = extractSite(url);
  if (!hostname) return null;
  for (const site of Object.keys(trackedSites)) {
    if (matchesSite(hostname, site)) return site;
  }
  return null;
}

function getRandomQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

function isInCutoff(cutoffHour) {
  if (cutoffHour === null || cutoffHour === undefined || cutoffHour === '') return false;
  const now = new Date();
  return now.getHours() >= cutoffHour;
}

function isInScheduleBlock(site, scheduleBlocks) {
  if (!scheduleBlocks || !Array.isArray(scheduleBlocks)) return false;
  const now = new Date();
  const currentDay = now.getDay(); // 0=Sun, 6=Sat
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const block of scheduleBlocks) {
    if (block.site !== site) continue;
    if (block.days && !block.days.includes(currentDay)) continue;
    const [startH, startM] = block.start.split(':').map(Number);
    const [endH, endM] = block.end.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;
    if (currentMinutes >= startMin && currentMinutes < endMin) return true;
  }
  return false;
}

async function getConfig() {
  const data = await chrome.storage.local.get(['config']);
  return data.config || DEFAULT_CONFIG;
}

async function getDayStats(dateKey) {
  const key = 'stats_' + dateKey;
  const data = await chrome.storage.local.get([key]);
  return data[key] || {};
}

async function setDayStats(dateKey, stats) {
  const key = 'stats_' + dateKey;
  await chrome.storage.local.set({ [key]: stats });
}

async function getScheduleBlocks() {
  const data = await chrome.storage.local.get(['schedule_blocks']);
  return data.schedule_blocks || [];
}

// ---- Achievement Helpers ----
async function getAchievements() {
  const data = await chrome.storage.local.get(['achievements']);
  const achievements = data.achievements;
  if (!achievements || achievements.date !== todayKey()) return null;
  return achievements;
}

function getAchievementUnlocksForSite(achievements, site) {
  if (!achievements || !achievements.completed) return { unlocked: false, earnedMinutes: 0, unlockedBy: [] };
  let earnedMinutes = 0;
  const unlockedBy = [];
  for (const [key, ach] of Object.entries(achievements.completed)) {
    if (ach.done && ach.unlocks && ach.unlocks.includes(site)) {
      earnedMinutes += ach.minutes || 0;
      unlockedBy.push(key);
    }
  }
  return { unlocked: earnedMinutes > 0, earnedMinutes, unlockedBy };
}

function getAchievementsNeededForSite(achievements, site) {
  if (!achievements || !achievements.completed) return [];
  const needed = [];
  for (const [key, ach] of Object.entries(achievements.completed)) {
    if (!ach.done && ach.unlocks && ach.unlocks.includes(site)) {
      needed.push(key);
    }
  }
  return needed;
}

// ---- Webhook ----
async function sendWebhook(payload) {
  const config = await getConfig();
  // Send to webhook
  if (config.webhook_url) {
    try {
      await fetch(config.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() })
      });
    } catch (e) {
      console.warn('FocusGuard webhook failed:', e);
    }
  }
  // Also send to server
  sendServerEvent(payload);
}

// ---- Block State Check ----
async function checkBlockState(site) {
  const config = await getConfig();
  const siteConfig = config.tracked_sites[site];
  if (!siteConfig) return { blocked: false };

  // Check if paused
  if (config.pause_until && Date.now() < config.pause_until) {
    return { blocked: false };
  }

  if (!config.enabled) return { blocked: false };

  // Check schedule blocks
  const scheduleBlocks = await getScheduleBlocks();
  if (isInScheduleBlock(site, scheduleBlocks)) {
    return { blocked: true, reason: 'scheduled', quote: getRandomQuote() };
  }

  // Check cutoff
  if (isInCutoff(siteConfig.cutoff)) {
    return { blocked: true, reason: 'cutoff', quote: getRandomQuote() };
  }

  // Achievement mode check
  if (config.achievement_mode) {
    const achievements = await getAchievements();
    if (achievements) {
      const unlockInfo = getAchievementUnlocksForSite(achievements, site);
      if (!unlockInfo.unlocked) {
        // Site is locked — no achievements completed for it
        const needed = getAchievementsNeededForSite(achievements, site);
        return {
          blocked: true,
          reason: 'achievement_locked',
          quote: getRandomQuote(),
          neededAchievements: needed,
          achievements: achievements.completed
        };
      }
      // Site unlocked by achievements — use earned minutes as the effective limit
      const stats = await getDayStats(todayKey());
      const siteStats = stats[site] || { timeSpent: 0, overrides: 0, blocked: false };
      const effectiveLimit = unlockInfo.earnedMinutes;
      if (siteStats.timeSpent >= effectiveLimit) {
        if (siteStats.overrideUntil && Date.now() < siteStats.overrideUntil) {
          return { blocked: false };
        }
        return {
          blocked: true,
          reason: 'limit',
          quote: getRandomQuote(),
          timeSpent: siteStats.timeSpent,
          limit: effectiveLimit,
          overridesUsed: siteStats.overrides || 0
        };
      }
      return { blocked: false };
    }
    // No achievements data for today — all tracked sites locked
    return {
      blocked: true,
      reason: 'achievement_locked',
      quote: getRandomQuote(),
      neededAchievements: [],
      achievements: {}
    };
  }

  // Check time limit (normal mode)
  const stats = await getDayStats(todayKey());
  const siteStats = stats[site] || { timeSpent: 0, overrides: 0, blocked: false };
  if (siteStats.timeSpent >= siteConfig.limit) {
    // Check if override active
    if (siteStats.overrideUntil && Date.now() < siteStats.overrideUntil) {
      return { blocked: false };
    }
    return {
      blocked: true,
      reason: 'limit',
      quote: getRandomQuote(),
      timeSpent: siteStats.timeSpent,
      limit: siteConfig.limit,
      overridesUsed: siteStats.overrides || 0
    };
  }

  return { blocked: false };
}

// ---- Alarm Handler: tick every minute ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'focusguard-tick') {
    await handleTick();
  }
  if (alarm.name === 'focusguard-daily-summary') {
    await handleDailySummary();
  }
  if (alarm.name === 'focusguard-server-poll') {
    await pollServerState();
  }
});

async function handleTick() {
  const config = await getConfig();
  if (!config.enabled) return;
  if (config.pause_until && Date.now() < config.pause_until) return;

  // Get the active tab
  let tabs;
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  if (!tabs || tabs.length === 0 || !tabs[0].url) return;

  const tab = tabs[0];
  const site = findTrackedSite(tab.url, config.tracked_sites);
  if (!site) return;

  const dateKey = todayKey();
  const stats = await getDayStats(dateKey);
  if (!stats[site]) {
    stats[site] = { timeSpent: 0, overrides: 0, blocked: false };
    // Send site_visit webhook
    sendWebhook({ event: 'site_visit', site });
  }

  stats[site].timeSpent += 1; // +1 minute
  const siteConfig = config.tracked_sites[site];

  // Determine effective limit (achievement mode may override)
  let effectiveLimit = siteConfig.limit;
  if (config.achievement_mode) {
    const achievements = await getAchievements();
    if (achievements) {
      const unlockInfo = getAchievementUnlocksForSite(achievements, site);
      if (unlockInfo.unlocked) {
        effectiveLimit = unlockInfo.earnedMinutes;
      }
    }
  }

  // Check if limit just reached
  if (stats[site].timeSpent === effectiveLimit && !stats[site].blocked) {
    stats[site].blocked = true;
    sendWebhook({ event: 'limit_reached', site, timeSpent: stats[site].timeSpent, limit: effectiveLimit });
  }

  await setDayStats(dateKey, stats);

  // Check if should block and notify content script
  const blockState = await checkBlockState(site);
  if (blockState.blocked) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'focusguard-block',
        ...blockState,
        site,
        overridesUsed: stats[site].overrides || 0
      });
    } catch {
      // content script not ready
    }

    sendWebhook({ event: 'schedule_block', site, reason: blockState.reason });
  }
}

async function handleDailySummary() {
  const now = new Date();
  // Send daily summary at around midnight (23:xx)
  if (now.getHours() !== 23) return;

  const config = await getConfig();
  const stats = await getDayStats(todayKey());
  const sites = {};

  for (const [site, siteConfig] of Object.entries(config.tracked_sites)) {
    const siteStats = stats[site] || { timeSpent: 0, overrides: 0, blocked: false };
    sites[site] = {
      timeSpent: siteStats.timeSpent,
      limit: siteConfig.limit,
      blocked: siteStats.blocked || false,
      overrides: siteStats.overrides || 0
    };
  }

  sendWebhook({ event: 'daily_summary', sites });
}

// ---- Messages from content/popup ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'check-block') {
    handleCheckBlock(msg, sender).then(sendResponse);
    return true;
  }
  if (msg.type === 'override-request') {
    handleOverride(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'get-stats') {
    handleGetStats().then(sendResponse);
    return true;
  }
  if (msg.type === 'get-config') {
    getConfig().then(sendResponse);
    return true;
  }
  if (msg.type === 'toggle-enabled') {
    handleToggle(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'pause-tracking') {
    handlePause(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'test-webhook') {
    handleTestWebhook(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'site-visit') {
    handleSiteVisit(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'toggle-achievement-mode') {
    handleToggleAchievementMode(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'test-server') {
    handleTestServer(msg).then(sendResponse);
    return true;
  }
  if (msg.type === 'get-server-status') {
    sendResponse({ connected: serverConnected, lastMessage: lastServerMessage });
    return false;
  }
});

async function handleCheckBlock(msg, sender) {
  const url = sender.tab ? sender.tab.url : msg.url;
  if (!url) return { blocked: false };

  const config = await getConfig();
  const site = findTrackedSite(url, config.tracked_sites);
  if (!site) return { blocked: false, tracked: false };

  const blockState = await checkBlockState(site);
  const stats = await getDayStats(todayKey());
  const siteStats = stats[site] || { timeSpent: 0, overrides: 0 };

  let effectiveLimit = config.tracked_sites[site].limit;
  if (config.achievement_mode) {
    const achievements = await getAchievements();
    if (achievements) {
      const unlockInfo = getAchievementUnlocksForSite(achievements, site);
      if (unlockInfo.unlocked) {
        effectiveLimit = unlockInfo.earnedMinutes;
      }
    }
  }

  return {
    ...blockState,
    tracked: true,
    site,
    overridesUsed: siteStats.overrides || 0,
    timeSpent: siteStats.timeSpent || 0,
    limit: effectiveLimit
  };
}

async function handleSiteVisit(msg) {
  const config = await getConfig();
  const site = findTrackedSite(msg.url, config.tracked_sites);
  if (!site) return {};

  const dateKey = todayKey();
  const stats = await getDayStats(dateKey);
  if (!stats[site]) {
    stats[site] = { timeSpent: 0, overrides: 0, blocked: false };
    await setDayStats(dateKey, stats);
    sendWebhook({ event: 'site_visit', site });
  }
  return {};
}

async function handleOverride(msg) {
  const { site, challengeResponse, expectedChallenge } = msg;

  // Validate the challenge
  if (challengeResponse !== expectedChallenge) {
    return { success: false, error: 'Challenge mismatch' };
  }

  const dateKey = todayKey();
  const stats = await getDayStats(dateKey);
  const siteStats = stats[site] || { timeSpent: 0, overrides: 0, blocked: false };

  if ((siteStats.overrides || 0) >= 3) {
    return { success: false, error: 'No overrides remaining' };
  }

  siteStats.overrides = (siteStats.overrides || 0) + 1;
  siteStats.overrideUntil = Date.now() + 5 * 60 * 1000; // 5 minutes
  stats[site] = siteStats;
  await setDayStats(dateKey, stats);

  sendWebhook({
    event: 'override_used',
    site,
    overridesRemaining: 3 - siteStats.overrides
  });

  return { success: true, overridesRemaining: 3 - siteStats.overrides };
}

async function handleGetStats() {
  const config = await getConfig();
  const stats = await getDayStats(todayKey());
  const scheduleBlocks = await getScheduleBlocks();
  const achievements = await getAchievements();
  return { config, stats, scheduleBlocks, achievements, date: todayKey() };
}

async function handleToggle(msg) {
  const config = await getConfig();
  config.enabled = msg.enabled;
  await chrome.storage.local.set({ config });
  sendWebhook({ event: 'extension_toggled', enabled: msg.enabled });
  return { success: true };
}

async function handlePause(msg) {
  const config = await getConfig();
  config.pause_until = Date.now() + (msg.minutes || 15) * 60 * 1000;
  await chrome.storage.local.set({ config });
  return { success: true, pause_until: config.pause_until };
}

async function handleToggleAchievementMode(msg) {
  const config = await getConfig();
  config.achievement_mode = msg.enabled;
  await chrome.storage.local.set({ config });
  return { success: true };
}

async function handleTestServer(msg) {
  const { serverUrl, apiKey } = msg;
  if (!serverUrl) return { success: false, error: 'No URL provided' };
  try {
    const url = serverUrl.replace(/\/$/, '') + '/api/auth';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey || ''
      }
    });
    if (resp.ok) {
      const data = await resp.json();
      serverConnected = true;
      return { success: true, authenticated: data.authenticated };
    }
    serverConnected = false;
    return { success: false, error: `HTTP ${resp.status}` };
  } catch (e) {
    serverConnected = false;
    return { success: false, error: e.message };
  }
}

async function handleTestWebhook(msg) {
  const url = msg.webhook_url;
  if (!url) return { success: false, error: 'No URL provided' };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'test',
        message: 'FocusGuard webhook test',
        timestamp: new Date().toISOString()
      })
    });
    return { success: resp.ok, status: resp.status };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Track tab changes for site_visit events
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const config = await getConfig();
      const site = findTrackedSite(tab.url, config.tracked_sites);
      if (site) {
        const dateKey = todayKey();
        const stats = await getDayStats(dateKey);
        if (!stats[site]) {
          stats[site] = { timeSpent: 0, overrides: 0, blocked: false };
          await setDayStats(dateKey, stats);
          sendWebhook({ event: 'site_visit', site });
        }
      }
    }
  } catch {
    // Tab might not exist
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const config = await getConfig();
  if (!config.enabled) return;

  const site = findTrackedSite(tab.url, config.tracked_sites);
  if (!site) return;

  // Check block state and notify content script
  const blockState = await checkBlockState(site);
  const stats = await getDayStats(todayKey());
  const siteStats = stats[site] || { timeSpent: 0, overrides: 0 };

  if (blockState.blocked) {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'focusguard-block',
        ...blockState,
        site,
        overridesUsed: siteStats.overrides || 0
      });
    } catch {
      // content script not loaded yet - retry after short delay
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tabId, {
            type: 'focusguard-block',
            ...blockState,
            site,
            overridesUsed: siteStats.overrides || 0
          });
        } catch {
          // still not ready, give up
        }
      }, 1000);
    }
  }
});
