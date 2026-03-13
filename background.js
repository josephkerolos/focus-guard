// FocusGuard - Background Service Worker
// Handles: time tracking, alarm-based increments, webhook sending, block state management

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
  pause_until: null
};

const QUOTES = [
  "Watching someone else's content is borrowing their momentum. Build your own.",
  "Every minute here is a minute not building your empire.",
  "You're not bored. You're avoiding."
];

// ---- Init ----
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['config']);
  if (!data.config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  }
  chrome.alarms.create('focusguard-tick', { periodInMinutes: 1 });
  chrome.alarms.create('focusguard-daily-summary', { periodInMinutes: 60 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('focusguard-tick', { periodInMinutes: 1 });
  chrome.alarms.create('focusguard-daily-summary', { periodInMinutes: 60 });
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

// ---- Webhook ----
async function sendWebhook(payload) {
  const config = await getConfig();
  if (!config.webhook_url) return;
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

  // Check time limit
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

  // Check if limit just reached
  if (stats[site].timeSpent === siteConfig.limit && !stats[site].blocked) {
    stats[site].blocked = true;
    sendWebhook({ event: 'limit_reached', site, timeSpent: stats[site].timeSpent, limit: siteConfig.limit });
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

  return {
    ...blockState,
    tracked: true,
    site,
    overridesUsed: siteStats.overrides || 0,
    timeSpent: siteStats.timeSpent || 0,
    limit: config.tracked_sites[site].limit
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
  return { config, stats, scheduleBlocks, date: todayKey() };
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
