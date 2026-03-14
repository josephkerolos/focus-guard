// FocusGuard Server - Pure Node.js HTTP server
// Bridge between Chrome extension and LifeOS/Claw AI
// No dependencies - just node:http, node:fs, node:path

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT) || 3000;
const API_KEY = process.env.FOCUSGUARD_API_KEY || 'focusguard-dev-key';

const STATE_FILE = path.join(__dirname, 'state.json');
const EVENTS_FILE = path.join(__dirname, 'events.json');
const MAX_EVENTS = 1000;

// ---- State Management ----

function getDefaultState() {
  return {
    achievements: {},
    schedule_blocks: [],
    limits: {
      'youtube.com': 120,
      'discord.com': 60,
      'instagram.com': 30,
      'reddit.com': 30,
      'x.com': 30
    },
    blocked_sites: [],
    messages: [],
    updated_at: new Date().toISOString()
  };
}

function readJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return fallback;
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getState() {
  return readJSON(STATE_FILE, getDefaultState());
}

function setState(state) {
  state.updated_at = new Date().toISOString();
  writeJSON(STATE_FILE, state);
  return state;
}

function getEvents() {
  return readJSON(EVENTS_FILE, []);
}

function appendEvent(event) {
  const events = getEvents();
  events.push({
    ...event,
    received_at: new Date().toISOString()
  });
  // Rotate: keep only last MAX_EVENTS
  const trimmed = events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events;
  writeJSON(EVENTS_FILE, trimmed);
  return trimmed;
}

// ---- HTTP Helpers ----

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_BODY = 1024 * 1024; // 1MB limit
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function checkAuth(req) {
  const key = req.headers['x-api-key'];
  return key === API_KEY;
}

function parseURL(reqUrl) {
  const parsed = new URL(reqUrl, `http://localhost:${PORT}`);
  return { pathname: parsed.pathname, searchParams: parsed.searchParams };
}

// ---- Today's Summary ----

function getTodaySummary(state, events) {
  const today = new Date().toISOString().split('T')[0];
  const todayEvents = events.filter(e => {
    const eventDate = (e.timestamp || e.received_at || '').split('T')[0];
    return eventDate === today;
  });

  // Aggregate time per site from site_visit events
  const siteTime = {};
  const overridesUsed = {};
  let adherencePoints = 0;
  let adherenceTotal = 0;

  for (const e of todayEvents) {
    if (e.event === 'site_visit' && e.site) {
      siteTime[e.site] = (siteTime[e.site] || 0) + (e.timeSpent || 1);
    }
    if (e.event === 'limit_reached' && e.site) {
      siteTime[e.site] = e.timeSpent || siteTime[e.site] || 0;
    }
    if (e.event === 'override_used' && e.site) {
      overridesUsed[e.site] = (overridesUsed[e.site] || 0) + 1;
    }
  }

  // Calculate adherence
  for (const [site, limit] of Object.entries(state.limits || {})) {
    adherenceTotal++;
    const time = siteTime[site] || 0;
    if (time <= limit) {
      adherencePoints++;
    }
  }

  const adherenceScore = adherenceTotal > 0
    ? Math.round((adherencePoints / adherenceTotal) * 100)
    : 100;

  return {
    date: today,
    site_time: siteTime,
    achievements: state.achievements || {},
    overrides_used: overridesUsed,
    adherence_score: adherenceScore,
    total_events_today: todayEvents.length
  };
}

// ---- Command Handlers ----

function handleCommand(state, body) {
  const { action } = body;

  switch (action) {
    case 'block': {
      const { site, reason, until } = body;
      if (!site) return { error: 'Missing site' };
      // Add to blocked_sites
      if (!state.blocked_sites.includes(site)) {
        state.blocked_sites.push(site);
      }
      // Add schedule block if "until" is provided
      if (until) {
        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        state.schedule_blocks = state.schedule_blocks || [];
        // Remove existing blocks for this site that haven't expired
        state.schedule_blocks = state.schedule_blocks.filter(b => b.site !== site || b._source !== 'command');
        state.schedule_blocks.push({
          site,
          start: currentTime,
          end: until,
          reason: reason || 'Blocked by command',
          _source: 'command'
        });
      }
      return { success: true, action: 'block', site };
    }

    case 'unblock': {
      const { site } = body;
      if (!site) return { error: 'Missing site' };
      state.blocked_sites = state.blocked_sites.filter(s => s !== site);
      // Remove command-sourced schedule blocks for this site
      state.schedule_blocks = (state.schedule_blocks || []).filter(
        b => !(b.site === site && b._source === 'command')
      );
      return { success: true, action: 'unblock', site };
    }

    case 'set_limit': {
      const { site, minutes } = body;
      if (!site || minutes === undefined) return { error: 'Missing site or minutes' };
      state.limits = state.limits || {};
      state.limits[site] = minutes;
      return { success: true, action: 'set_limit', site, minutes };
    }

    case 'set_achievement': {
      const { key, done, unlocks, minutes, target, current } = body;
      if (!key) return { error: 'Missing key' };
      const today = new Date().toISOString().split('T')[0];
      if (!state.achievements || state.achievements.date !== today) {
        state.achievements = { date: today, completed: {} };
      }
      state.achievements.completed[key] = {
        done: !!done,
        unlocks: unlocks || [],
        minutes: minutes || 0,
        ...(target !== undefined && { target }),
        ...(current !== undefined && { current })
      };
      return { success: true, action: 'set_achievement', key };
    }

    case 'send_message': {
      const { text } = body;
      if (!text) return { error: 'Missing text' };
      state.messages = state.messages || [];
      state.messages.push(text);
      // Keep only last 10 messages
      if (state.messages.length > 10) {
        state.messages = state.messages.slice(-10);
      }
      return { success: true, action: 'send_message' };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

// ---- Router ----

async function handleRequest(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  const { pathname, searchParams } = parseURL(req.url);

  // Health check (no auth required)
  if (pathname === '/health' && req.method === 'GET') {
    sendJSON(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    return;
  }

  // Auth check for all /api routes
  if (pathname.startsWith('/api')) {
    if (!checkAuth(req)) {
      sendJSON(res, 401, { error: 'Unauthorized. Provide X-API-Key header.' });
      return;
    }
  }

  try {
    // GET /api/state
    if (pathname === '/api/state' && req.method === 'GET') {
      const state = getState();
      sendJSON(res, 200, state);
      return;
    }

    // POST /api/events
    if (pathname === '/api/events' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.event) {
        sendJSON(res, 400, { error: 'Missing event field' });
        return;
      }
      appendEvent(body);
      sendJSON(res, 200, { success: true, event: body.event });
      return;
    }

    // GET /api/events
    if (pathname === '/api/events' && req.method === 'GET') {
      const events = getEvents();
      const since = searchParams.get('since');
      const limit = parseInt(searchParams.get('limit')) || 50;

      let filtered = events;
      if (since) {
        const sinceDate = new Date(since);
        filtered = events.filter(e => {
          const eDate = new Date(e.timestamp || e.received_at);
          return eDate > sinceDate;
        });
      }

      // Return last N events
      const result = filtered.slice(-limit);
      sendJSON(res, 200, { events: result, count: result.length });
      return;
    }

    // POST /api/command
    if (pathname === '/api/command' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.action) {
        sendJSON(res, 400, { error: 'Missing action field' });
        return;
      }
      const state = getState();
      const result = handleCommand(state, body);
      if (result.error) {
        sendJSON(res, 400, result);
        return;
      }
      setState(state);
      sendJSON(res, 200, result);
      return;
    }

    // GET /api/summary
    if (pathname === '/api/summary' && req.method === 'GET') {
      const state = getState();
      const events = getEvents();
      const summary = getTodaySummary(state, events);
      sendJSON(res, 200, summary);
      return;
    }

    // POST /api/auth (verify API key)
    if (pathname === '/api/auth' && req.method === 'POST') {
      // If we got here, auth already passed
      sendJSON(res, 200, { authenticated: true });
      return;
    }

    // 404
    sendJSON(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error('Request error:', e);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
}

// ---- Server Start ----

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`FocusGuard server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API base: http://localhost:${PORT}/api`);

  // Initialize state file if it doesn't exist
  if (!fs.existsSync(STATE_FILE)) {
    writeJSON(STATE_FILE, getDefaultState());
    console.log('Created initial state.json');
  }

  // Initialize events file if it doesn't exist
  if (!fs.existsSync(EVENTS_FILE)) {
    writeJSON(EVENTS_FILE, []);
    console.log('Created initial events.json');
  }
});
