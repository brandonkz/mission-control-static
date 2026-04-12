#!/usr/bin/env node
// Generates mission control data.json from live project state
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE = '/Users/brandonkatz/.openclaw/workspace';
const OUT = path.join(__dirname, 'data.json');

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim(); } catch { return ''; }
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// ── FitSorted Stats ──
let fitsortedStats = {};
let fitsortedUsers = [];
let fitsortedTopFoods = [];
let fitsortedErrors = [];
try {
  const usersFile = path.join(WORKSPACE, 'fitsorted', 'users.json');
  if (fs.existsSync(usersFile)) {
    const users = readJSON(usersFile) || {};
    const phones = Object.keys(users);
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    let totalLogs = 0, activeLast7 = 0, activeLast24h = 0, premiumCount = 0, todayLogs = 0;
    let foodFreq = {};
    let totalCalories = 0;

    for (const p of phones) {
      const u = users[p];
      if (u.isPro || u.premium) premiumCount++;
      const logDates = Object.keys(u.log || {});
      let userLogs = 0;
      for (const d of logDates) {
        const entries = u.log[d] || [];
        totalLogs += entries.length;
        userLogs += entries.length;
        if (d === today) todayLogs += entries.length;
        for (const e of entries) {
          totalCalories += e.calories || 0;
          const food = (e.food || '').toLowerCase();
          if (food) foodFreq[food] = (foodFreq[food] || 0) + 1;
        }
      }
      const lastDate = logDates.sort().pop();
      const lastActive = lastDate ? new Date(lastDate).getTime() : 0;
      if (lastDate && (now - lastActive) < 7 * 86400000) activeLast7++;
      if (lastDate && (now - lastActive) < 86400000) activeLast24h++;

      // Build user list for dashboard
      const masked = p.slice(0, 4) + '****' + p.slice(-3);
      fitsortedUsers.push({
        name: u.name || 'Unknown',
        phone: masked,
        logs: userLogs,
        joined: u.joinedAt ? new Date(u.joinedAt).toLocaleDateString('en-ZA') : '?',
        lastActive: lastDate || 'never',
        goal: u.goal || u.dailyCalories || u.adjustedGoal || '?',
        age: u.profile?.age || u.setup?.age || '',
        gender: u.profile?.gender || u.setup?.gender || '',
        email: u.email || '',
        premium: !!(u.isPro || u.premium),
        active7d: lastDate && (now - lastActive) < 7 * 86400000,
        joinedRaw: u.joinedAt || '',
      });
    }

    fitsortedUsers.sort((a, b) => new Date(b.joinedRaw || 0) - new Date(a.joinedRaw || 0));
    fitsortedTopFoods = Object.entries(foodFreq).sort((a, b) => b[1] - a[1]).slice(0, 15);

    // Bot status
    let botStatus = 'unknown';
    let restarts = '?';
    let uptime = '?';
    try {
      const pm2Data = JSON.parse(run('pm2 jlist 2>/dev/null') || '[]');
      const proc = pm2Data.find(p => p.name === 'fitsorted');
      if (proc) {
        botStatus = proc.pm2_env.status;
        restarts = proc.pm2_env.restart_time;
        const uptimeMs = now - proc.pm2_env.pm_uptime;
        const uptimeH = Math.floor(uptimeMs / 3600000);
        const uptimeM = Math.floor((uptimeMs % 3600000) / 60000);
        uptime = uptimeH > 24 ? Math.floor(uptimeH / 24) + 'd ' + (uptimeH % 24) + 'h' : uptimeH + 'h ' + uptimeM + 'm';
      }
    } catch {}

    // Recent errors
    try {
      const errorLog = run('pm2 logs fitsorted --lines 100 --nostream 2>&1 | grep -i "error\\|Error" | sort | uniq -c | sort -rn | head -5');
      if (errorLog) {
        fitsortedErrors = errorLog.split('\n').map(line => {
          const match = line.trim().match(/^(\d+)\s+(.+)/);
          if (match) return { count: parseInt(match[1]), error: match[2].replace(/^0\|fitsorte \| /, '') };
          return null;
        }).filter(Boolean);
      }
    } catch {}

    fitsortedStats = {
      'Total Users': { val: phones.length.toString(), color: 'green' },
      'Active (24h)': { val: activeLast24h.toString(), color: activeLast24h > 3 ? 'green' : 'orange' },
      'Active (7d)': { val: activeLast7.toString(), color: activeLast7 > 5 ? 'green' : 'orange' },
      'Premium Users': { val: premiumCount.toString(), color: premiumCount > 0 ? 'green' : 'red' },
      'Total Logs': { val: totalLogs.toLocaleString(), color: 'blue' },
      'Today\'s Logs': { val: todayLogs.toString(), color: todayLogs > 10 ? 'green' : 'orange' },
      'Total Calories Tracked': { val: totalCalories.toLocaleString(), color: 'blue' },
      'Bot Status': { val: botStatus, color: botStatus === 'online' ? 'green' : 'red' },
      'Uptime': { val: uptime, color: 'blue' },
      'Restarts': { val: restarts.toString(), color: 'orange' },
    };
  }
} catch (e) { console.error('FitSorted error:', e.message); }

// Count foods
let foodCount = 445;
try {
  const extraFoods = readJSON(path.join(WORKSPACE, 'fitsorted', 'extra-foods.json'));
  if (extraFoods) foodCount += Object.keys(extraFoods).filter(k => !k.startsWith('_meta')).length;
} catch {}
fitsortedStats['Food Database'] = { val: foodCount.toString() + ' foods', color: 'blue' };

// ── Crypto Casino Stats ──
let cryptoCasinos = {};
try {
  const dataDir = path.join(WORKSPACE, 'crypto-casinos', 'site', 'data');
  const today = new Date().toISOString().split('T')[0];
  let latestFile;
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    const f = path.join(dataDir, `deposits-${d}.csv`);
    if (fs.existsSync(f)) { latestFile = f; break; }
  }
  if (latestFile) {
    const lines = fs.readFileSync(latestFile, 'utf8').trim().split('\n').slice(1);
    const totalUSD = lines.reduce((s, l) => s + (parseFloat(l.split(',')[8]) || 0), 0);
    const whales = lines.filter(l => (parseFloat(l.split(',')[8]) || 0) > 10000).length;
    cryptoCasinos = {
      'Deposits Today': { val: lines.length.toLocaleString(), color: 'purple' },
      'Total Volume': { val: '$' + (totalUSD / 1000000).toFixed(1) + 'M', color: 'green' },
      'Whale Deposits': { val: whales.toString() + ' (>$10K)', color: 'orange' },
      'Casinos Tracked': { val: [...new Set(lines.map(l => l.split(',')[3]?.replace(/ \d+$/, '')))].length.toString(), color: 'blue' },
    };
  }
} catch (e) { console.error('Casino error:', e.message); }

// ── Projects ──
const projects = [
  { name: 'FitSorted', url: 'https://fitsorted.co.za', status: 'live', traffic: (fitsortedStats['Active (7d)']?.val || '?') + ' active', trafficColor: 'green' },
  { name: 'BetSorted', url: 'https://betsorted.co.za', status: 'live', traffic: '', trafficColor: 'blue' },
  { name: 'CryptoCasinoSorted', url: 'https://cryptocasinosorted.com', status: 'live', traffic: '', trafficColor: 'purple' },
  { name: 'RetirementSorted', url: 'https://retirementsorted.co.za', status: 'live', traffic: '', trafficColor: '' },
  { name: 'PaidProperly', url: 'https://paidproperly.co.za', status: 'live', traffic: '', trafficColor: '' },
  { name: 'DeFi Yield DEX', url: 'https://dex.defiyield.live', status: 'live', traffic: '', trafficColor: '' },
  { name: 'TradeSorted', url: 'https://tradesorted.co.za', status: 'idea', traffic: '', trafficColor: '' },
  { name: 'CVSorted', url: '#', status: 'idea', traffic: 'Scoped', trafficColor: 'orange' },
];

// ── Revenue ──
const revenue = {
  'FitSorted MRR': { val: 'R0', color: 'red' },
  'FitSorted Target': { val: 'R1,800/mo (100 users)', color: 'orange' },
  'Affiliate Revenue': { val: 'R0 (pending signups)', color: 'red' },
  'Orderly DEX Fees': { val: 'Active', color: 'green' },
  'Gold LP Yield': { val: '~15% APY ($20K)', color: 'green' },
};

// ── API Credits ──
const apiCredits = {
  'The Odds API': { val: '350/500 remaining', color: 'orange' },
  'OpenAI': { val: 'Active', color: 'green' },
  'Gemini': { val: 'Active (free tier)', color: 'green' },
  'Resend (email)': { val: '100/day free', color: 'green' },
  'Etherscan': { val: '100K/day', color: 'green' },
};

// ── Ideas ──
const ideas = [
  { emoji: '📖', name: 'VerseSorted', status: 'idea', buildTime: '2 days', revenue: 'R49/mo freemium' },
  { emoji: '🍺', name: 'DrunkSorted', status: 'idea', buildTime: '1-2 weeks', revenue: 'Ads + Uber affiliate' },
  { emoji: '📄', name: 'CVSorted', status: 'idea', buildTime: '1-2 weeks', revenue: 'R99/CV' },
  { emoji: '💰', name: 'BudgetSorted', status: 'idea', buildTime: '1 week', revenue: 'R29/mo' },
  { emoji: '🏋️', name: 'FitSorted App', status: 'wip', buildTime: 'Awaiting Apple account', revenue: 'Companion to WhatsApp' },
  { emoji: '📈', name: 'TradeSorted', status: 'idea', buildTime: '4-6 hours', revenue: 'R2K-20K/mo affiliates' },
  { emoji: '🩺', name: 'Dietician Suite', status: 'idea', buildTime: '4-6 weeks', revenue: 'R50/client/mo B2B' },
  { emoji: '🎰', name: 'Betting Tipster Bot', status: 'idea', buildTime: '1 week', revenue: 'R99/mo' },
  { emoji: '🏠', name: 'Rental Auto-Responder', status: 'idea', buildTime: '3 days', revenue: 'R199/mo per landlord' },
  { emoji: '💸', name: 'Crypto Price Alerts', status: 'idea', buildTime: '2 days', revenue: 'R49/mo' },
];

// ── Automations ──
const automations = [
  { time: '01:00', name: 'FitSorted Food DB Expansion', enabled: true },
  { time: '06:00', name: 'BetSorted Morning Odds', enabled: true },
  { time: '08:30', name: 'Crypto Casino Tweet Drafts', enabled: true },
  { time: '09:00', name: 'Arkham Deposit Addresses Reminder', enabled: true },
  { time: '18:00', name: 'BetSorted Evening Odds', enabled: true },
  { time: '20:00', name: 'FitSorted Evening Summary', enabled: true },
  { time: '20:05', name: 'FitSorted Dashboard Update', enabled: true },
  { time: 'Every 5m', name: 'FitSorted Stats Regen', enabled: true },
];

// ── TODOs ──
const todos = [
  'Test full FitSorted onboarding flow on WhatsApp',
  'Test email export (email, export, export week)',
  'Complete Apple Developer Account enrollment ($99/yr)',
  'Sign up for Google Play Console ($25)',
  'Run FitSorted stable for 1 week, then pitch influencers',
  'Post Reddit/Twitter content drafts',
  'Get more deposit addresses from Arkham',
  'Build React Native companion app (scope ready)',
  'Lock in Bloomberg terminal tweet card style in daily cron',
];

// ── Google Analytics ──
let analytics = {};
try {
  // Run the analytics report script and capture output
  const gaOutput = run('cd /Users/brandonkatz/.openclaw/workspace/scripts && node -e "\
    const fs = require(\'fs\');\
    const { google } = require(\'googleapis\');\
    const keyFile = JSON.parse(fs.readFileSync(\'../analytics-service-account.json\'));\
    const auth = new google.auth.GoogleAuth({ credentials: keyFile, scopes: [\'https://www.googleapis.com/auth/analytics.readonly\'] });\
    const PROPERTIES = {\
      \'FitSorted\': \'527761095\',\
      \'PaidProperly\': \'523629608\',\
      \'BetSorted\': \'523748260\',\
      \'RetirementSorted\': \'524131705\',\
      \'CryptoCasinoSorted\': \'524493667\'\
    };\
    (async () => {\
      const client = await auth.getClient();\
      const ad = google.analyticsdata(\'v1beta\');\
      const results = {};\
      for (const [name, id] of Object.entries(PROPERTIES)) {\
        try {\
          const r = await ad.properties.runReport({\
            auth: client,\
            property: \'properties/\' + id,\
            requestBody: {\
              dateRanges: [\
                { startDate: \'yesterday\', endDate: \'yesterday\', name: \'daily\' },\
                { startDate: \'7daysAgo\', endDate: \'yesterday\', name: \'weekly\' }\
              ],\
              metrics: [{ name: \'sessions\' }, { name: \'totalUsers\' }, { name: \'screenPageViews\' }]\
            }\
          });\
          const rows = r.data.rows || [];\
          const daily = rows.find(r => r.dimensionValues?.[0]?.value === \'daily\') || rows[0];\
          const weekly = rows.find(r => r.dimensionValues?.[0]?.value === \'weekly\') || rows[1];\
          const dv = daily?.metricValues || [];\
          const wv = weekly?.metricValues || [];\
          results[name] = {\
            daily: { sessions: dv[0]?.value || \'0\', users: dv[1]?.value || \'0\', pageviews: dv[2]?.value || \'0\' },\
            weekly: { sessions: wv[0]?.value || \'0\', users: wv[1]?.value || \'0\', pageviews: wv[2]?.value || \'0\' }\
          };\
        } catch (e) { results[name] = { daily: { sessions: \'?\', users: \'?\', pageviews: \'?\' }, weekly: { sessions: \'?\', users: \'?\', pageviews: \'?\' } }; }\
      }\
      console.log(JSON.stringify(results));\
    })();\
  " 2>/dev/null');
  
  if (gaOutput) {
    const gaData = JSON.parse(gaOutput);
    analytics = {};
    for (const [site, d] of Object.entries(gaData)) {
      analytics[site] = {
        daily: d.daily || { sessions: '0', users: '0', pageviews: '0' },
        weekly: d.weekly || { sessions: '0', users: '0', pageviews: '0' },
      };
    }
  }
} catch (e) { console.error('GA error:', e.message); }

// ── Quick Links ──
const quickLinks = [
  { section: "Content Calendars", links: [
    { name: "FitSorted Content Calendar", url: "https://fitsorted.co.za/content-calendar.html", icon: "🏋️" },
    { name: "Orderly Content Hub", url: "https://brandonkz.github.io/orderly-dashboard/hub.html", icon: "📋" },
    { name: "Orderly Dashboard", url: "https://brandonkz.github.io/orderly-dashboard/dashboard.html", icon: "📊" },
    { name: "Orderly War Room", url: "https://brandonkz.github.io/orderly-dashboard/warroom.html", icon: "⚔️" },
    { name: "Orderly Tasks", url: "https://brandonkz.github.io/orderly-dashboard/tasks.html", icon: "✅" },
    { name: "BetSorted Content", url: "https://brandonkz.github.io/orderly-dashboard/betsorted.html", icon: "⚽" },
  ]},
  { section: "Content & Social", links: [
    { name: "Postiz Dashboard", url: "https://app.postiz.com", icon: "📱" },
    { name: "X — @alphaxasset", url: "https://x.com/alphaxasset", icon: "🎰" },
    { name: "X — @brandonkz", url: "https://x.com/brandonkz", icon: "🐦" },
    { name: "LinkedIn — Brandon", url: "https://linkedin.com/in/katzbrandon", icon: "💼" },
    { name: "Instagram — FitSorted", url: "https://instagram.com/fitsorted", icon: "📸" },
  ]},
  { section: "Analytics & Data", links: [
    { name: "Google Analytics", url: "https://analytics.google.com", icon: "📊" },
    { name: "Google Search Console", url: "https://search.google.com/search-console", icon: "🔍" },
    { name: "Arkham Intelligence", url: "https://platform.arkhamintelligence.com", icon: "🕵️" },
    { name: "Etherscan", url: "https://etherscan.io", icon: "⛓️" },
    { name: "DeBank", url: "https://debank.com", icon: "💰" },
  ]},
  { section: "Sites", links: [
    { name: "BetSorted", url: "https://betsorted.co.za", icon: "⚽" },
    { name: "CryptoCasinoSorted", url: "https://cryptocasinosorted.com", icon: "🎰" },
    { name: "FitSorted", url: "https://fitsorted.co.za", icon: "🏋️" },
    { name: "RetirementSorted", url: "https://retirementsorted.co.za", icon: "🏖️" },
    { name: "PaidProperly", url: "https://paidproperly.co.za", icon: "💸" },
    { name: "DeFi Yield DEX", url: "https://dex.defiyield.live", icon: "📈" },
  ]},
  { section: "GitHub Repos", links: [
    { name: "BetSorted", url: "https://github.com/brandonkz/betsorted", icon: "⚽" },
    { name: "CryptoCasinoSorted", url: "https://github.com/brandonkz/crypto-casinos", icon: "🎰" },
    { name: "FitSorted", url: "https://github.com/brandonkz/fitsorted", icon: "🏋️" },
    { name: "RetirementSorted", url: "https://github.com/brandonkz/retirementsorted", icon: "🏖️" },
    { name: "PaidProperly", url: "https://github.com/brandonkz/paidproperly", icon: "💸" },
  ]},
  { section: "Admin & Tools", links: [
    { name: "Cloudflare", url: "https://dash.cloudflare.com", icon: "☁️" },
    { name: "Supabase", url: "https://supabase.com/dashboard", icon: "🗄️" },
    { name: "PayFast", url: "https://merchant.payfast.co.za", icon: "💳" },
    { name: "XTP Dashboard", url: "https://brandonkz.github.io/xtp/", icon: "🎮" },
    { name: "The Odds API", url: "https://the-odds-api.com", icon: "🎲" },
  ]},
];

// ── Output ──
const data = {
  updated: new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }),
  projects,
  fitsorted: fitsortedStats,
  fitsortedUsers,
  fitsortedTopFoods,
  fitsortedErrors,
  analytics,
  revenue,
  cryptoCasinos,
  automations,
  apiCredits,
  ideas,
  todos,
  quickLinks,
};

fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
console.log('✅ Mission Control data.json generated');
