importScripts('data.js');

console.log('🎯 FOCUS TROLL BACKGROUND SCRIPT LOADING 🎯');

const SETTINGS_KEY = 'ft_settings_v1';

const DEFAULT_SITE_PERMISSIONS = {
  'x.com': ['*://x.com/*'],
  'facebook.com': ['*://facebook.com/*', '*://www.facebook.com/*'],
  'instagram.com': ['*://instagram.com/*', '*://www.instagram.com/*'],
  'linkedin.com': ['*://linkedin.com/*', '*://www.linkedin.com/*'],
  'tiktok.com': ['*://tiktok.com/*', '*://www.tiktok.com/*'],
  'reddit.com': ['*://reddit.com/*', '*://www.reddit.com/*'],
  'youtube.com': ['*://youtube.com/*', '*://www.youtube.com/*']
};

const LOGOUT_DELAY = 10000; // 10 seconds
const logoutTimers = new Map();
const grayscaleTabs = new Map();
const mindfulTabs = new Map();
const mindfulCompletedTabs = new Map();

const MINDFUL_PROMPTS = [
  'Take a breath. Is this visit aligned with what you planned to do right now?',
  'Would future-you thank you for the way you spend the next few minutes?',
  'Is there a smaller task you meant to finish before opening this tab?',
  'If you close this tab, what will you focus on instead?',
  'Use this pause to reset - what outcome are you hoping for from this visit?',
  'Is this tab helping you move toward today\'s top priority?',
  'Could a short stretch or glass of water serve you better than this scroll?',
  'Are you opening this out of habit or with a clear intention?',
  'Imagine it\'s the end of the day - will this detour feel worth it?',
  'What progress will you be proud of after this timer ends?'
];

let settingsCache = null;
let settingsPromise = null;

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await ensureSettings();
  } catch (error) {
    console.error('Focus Troll: Failed to initialize settings on install', error);
  }

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?setup=true') });
  }
});

// Handle extension icon clicks - open settings in new tab
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});

console.log('Focus Troll: Background script loaded');

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'FT_MINDFUL_CLOSE_TAB') {
    const tabId = sender?.tab?.id;
    if (tabId != null) {
      chrome.tabs.remove(tabId).catch((error) => {
        console.warn(`Focus Troll: Failed to close tab ${tabId} from mindful prompt`, error);
      });
      mindfulTabs.delete(tabId);
      mindfulCompletedTabs.delete(tabId);
    }
    return;
  }

  if (message.type === 'FT_OPEN_SETTINGS') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }).catch((error) => {
      console.warn('Focus Troll: Failed to open settings tab from mindful overlay', error);
    });
    return;
  }

  if (message.type === 'FT_MINDFUL_OVERLAY_DONE') {
    const tabId = sender?.tab?.id;
    if (tabId != null) {
      const state = mindfulTabs.get(tabId);
      if (!state) {
        if (message.reason !== 'complete') mindfulCompletedTabs.delete(tabId);
        return;
      }

      if (message.instanceId && state.instanceId && state.instanceId !== message.instanceId) {
        return;
      }

      mindfulTabs.delete(tabId);

      if (message.reason === 'complete') {
        mindfulCompletedTabs.set(tabId, {
          host: state.host,
          url: state.url,
          completedAt: Date.now(),
        });
      } else {
        mindfulCompletedTabs.delete(tabId);
      }
    }
  }
});

// Store tab info before tabs are closed
const tabInfo = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const candidateUrl = changeInfo.url || tab.url;
  if (candidateUrl) {
    recordTabInfo(tabId, candidateUrl, !!tab.incognito);
  }

  if (changeInfo.status === 'loading' && tab.url) {
    handleTabCompleted(tabId, tab).catch((error) => {
      console.error('Focus Troll: Failed to handle tab loading update', error);
    });
  }

  if (changeInfo.url && isWebUrl(changeInfo.url)) {
    handleTabCompleted(tabId, { ...tab, url: changeInfo.url }).catch((error) => {
      console.error('Focus Troll: Failed to handle tab URL change', error);
    });
  }

  if (changeInfo.status === 'complete' && tab.url) {
    recordTabInfo(tabId, tab.url, !!tab.incognito);
    handleTabCompleted(tabId, tab).catch((error) => {
      console.error('Focus Troll: Failed to handle tab update', error);
    });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab) {
      await applyActionsForTab(tabId, tab);
    }
  } catch (error) {
    console.error('Focus Troll: Failed to handle tab activation', error);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  console.log(`Focus Troll: Tab ${tabId} removed, isWindowClosing: ${removeInfo.isWindowClosing}`);

  grayscaleTabs.delete(tabId);
  mindfulTabs.delete(tabId);
  mindfulCompletedTabs.delete(tabId);

  if (removeInfo.isWindowClosing) return;

  const info = tabInfo.get(tabId);
  tabInfo.delete(tabId);

  if (!info || !info.url) {
    console.log(`Focus Troll: No stored info for tab ${tabId}`);
    return;
  }

  if (info.incognito) {
    console.log('Focus Troll: Skipping incognito tab');
    return;
  }

  const normalizedHost = info.normalizedHost;
  if (!normalizedHost) return;

  console.log(`Focus Troll: Processing tab close for ${normalizedHost}`);

  try {
    const settings = await ensureSettings();
    const onDuty = settings?.settings?.onDuty;
    if (!isOnDutyActive(onDuty)) {
      console.log('Focus Troll: On duty inactive, skipping logout flow');
      return;
    }

    const site = findSiteByHost(settings, normalizedHost);
    if (!site || site.blockMethod !== 'logOut') {
      console.log(`Focus Troll: ${normalizedHost} is not configured for Auto Logout`);
      return;
    }

    const permissions = getPermissionsForHost(normalizedHost, !!site.isCustom);
    let hasPermission = false;
    try {
      hasPermission = await chrome.permissions.contains({ origins: permissions });
    } catch (permError) {
      console.error(`Focus Troll: Permission check failed for ${normalizedHost}`, permError);
      return;
    }

    if (!hasPermission) {
      console.log(`Focus Troll: No permission for ${normalizedHost}`);
      return;
    }

    if (logoutTimers.has(normalizedHost)) {
      clearTimeout(logoutTimers.get(normalizedHost));
      console.log(`Focus Troll: Cleared existing timer for ${normalizedHost}`);
    }

    console.log(`Focus Troll: Starting ${LOGOUT_DELAY}ms timer for ${normalizedHost}`);

    const timer = setTimeout(async () => {
      try {
        const remainingTabs = await chrome.tabs.query({});
        const sameDomainTabs = remainingTabs.filter((tab) => {
          if (tab.incognito) return false;
          const host = extractNormalizedHost(tab.url);
          return host === normalizedHost;
        });

        console.log(`Focus Troll: Found ${sameDomainTabs.length} remaining tabs for ${normalizedHost}`);

        if (sameDomainTabs.length === 0) {
          console.log(`Focus Troll: No remaining tabs, logging out from ${normalizedHost}`);
          await performLogout(normalizedHost);
        } else {
          console.log(`Focus Troll: Still have tabs open for ${normalizedHost}, skipping logout`);
        }
      } catch (timerError) {
        console.error('Focus Troll: Error during logout timer flow', timerError);
      } finally {
        logoutTimers.delete(normalizedHost);
      }
    }, LOGOUT_DELAY);

    logoutTimers.set(normalizedHost, timer);
  } catch (error) {
    console.error('Focus Troll error:', error);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.url || tab.incognito) return;
  
  try {
    const normalizedHost = extractNormalizedHost(tab.url);
    if (normalizedHost && logoutTimers.has(normalizedHost)) {
      clearTimeout(logoutTimers.get(normalizedHost));
      logoutTimers.delete(normalizedHost);
      console.log(`Focus Troll: Cancelled logout for ${normalizedHost} (new tab opened)`);
    }
  } catch (error) {
    // Ignore invalid URLs
  }
});


chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes[SETTINGS_KEY]) return;
  settingsCache = changes[SETTINGS_KEY].newValue || null;
  settingsPromise = null;
  refreshAllTabs().catch((error) => {
    console.error('Focus Troll: Failed to refresh tabs after settings change', error);
  });
});


async function performLogout(hostname) {
  console.log(`Focus Troll: Clearing cookies for ${hostname}`);
  await clearCookiesForDomain(hostname);
}

async function clearCookiesForDomain(hostname) {
  try {
    console.log(`Focus Troll: Starting auth cookie clearing for ${hostname}`);
    
    // Authentication cookie patterns to remove
    const authCookiePatterns = [
      // Session IDs
      /^JSESSIONID$/i,
      /^sessionid$/i,
      /^session$/i,
      /^sid$/i,
      
      // Authentication tokens
      /^li_at$/i,           // LinkedIn auth token
      /^auth_token$/i,
      /^access_token$/i,
      /^token$/i,
      /^csrf/i,
      
      // User/Account IDs
      /^aam_uuid$/i,
      /^user_id$/i,
      /^uid$/i,
      /^account_id$/i,
      
      // Login state
      /^logged_in$/i,
      /^is_authenticated$/i,
      /^login$/i,
      
      // Remember me / persistent login
      /^li_rm$/i,           // LinkedIn remember me
      /^remember_token$/i,
      /^remember_me$/i,
      /^persistent$/i,
      
      // LinkedIn specific
      /^liap$/i,            // LinkedIn authentication
      /^UserMatchHistory$/i,
      
      // Facebook/Meta specific
      /^c_user$/i,          // Facebook user ID
      /^xs$/i,              // Facebook session
      /^sb$/i,              // Facebook secure browsing
      /^datr$/i,            // Facebook device auth
      
      // Twitter/X specific
      /^auth_token$/i,
      /^secure_session$/i,
      /^twid$/i,
      
      // Reddit specific
      /^reddit_session$/i,
      /^session_tracker$/i,
      
      // YouTube/Google specific
      /^SAPISID$/i,
      /^SSID$/i,
      /^HSID$/i,
      /^APISID$/i,
      /^LOGIN_INFO$/i,
      
      // Generic patterns
      /session/i,
      /auth/i,
      /login/i,
      /token/i,
      /user/i
    ];
    
    // Clear cookies for both domain and www.domain
    const domains = [hostname];
    if (!hostname.startsWith('www.')) {
      domains.push(`www.${hostname}`);
    }
    if (hostname.startsWith('www.')) {
      domains.push(hostname.substring(4));
    }
    
    let totalCleared = 0;
    
    for (const domain of domains) {
      const cookies = await chrome.cookies.getAll({ domain: domain });
      console.log(`Focus Troll: Found ${cookies.length} cookies for ${domain}`);
      
      for (const cookie of cookies) {
        // Check if this cookie matches any auth pattern
        const isAuthCookie = authCookiePatterns.some(pattern => pattern.test(cookie.name));
        
        if (isAuthCookie) {
          try {
            // Fix domain format - remove leading dots
            const cleanDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            const url = `https://${cleanDomain}${cookie.path}`;
            
            await chrome.cookies.remove({
              url: url,
              name: cookie.name,
              storeId: cookie.storeId
            });
            totalCleared++;
            console.log(`Focus Troll: Successfully removed auth cookie ${cookie.name} from ${url}`);
          } catch (cookieError) {
            console.log(`Focus Troll: Failed to remove auth cookie ${cookie.name}:`, cookieError);
          }
        } else {
          console.log(`Focus Troll: Skipping non-auth cookie: ${cookie.name}`);
        }
      }
    }
    
    // Also clear auth-related localStorage and sessionStorage items
    const tabs = await chrome.tabs.query({ url: `*://*.${hostname}/*` });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try {
              // Auth-related storage keys to remove
              const authKeys = [
                // Generic patterns
                'token', 'auth', 'session', 'login', 'user',
                'access_token', 'refresh_token', 'auth_token',
                'sessionId', 'userId', 'accountId',
                
                // LinkedIn specific
                'li_at', 'li_rm', 'linkedin_oauth_',
                
                // Facebook specific
                'fb_', 'facebook_', '_fb',
                
                // Twitter specific
                'twitter_', 'tw_', '_twitter',
                
                // Reddit specific
                'reddit_', '_reddit',
                
                // YouTube/Google specific
                'youtube_', 'google_', 'gapi_'
              ];
              
              let clearedLocal = 0, clearedSession = 0;
              
              // Clear matching localStorage items
              for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && authKeys.some(pattern => key.toLowerCase().includes(pattern.toLowerCase()))) {
                  localStorage.removeItem(key);
                  clearedLocal++;
                  console.log(`Focus Troll: Removed localStorage key: ${key}`);
                }
              }
              
              // Clear matching sessionStorage items  
              for (let i = sessionStorage.length - 1; i >= 0; i--) {
                const key = sessionStorage.key(i);
                if (key && authKeys.some(pattern => key.toLowerCase().includes(pattern.toLowerCase()))) {
                  sessionStorage.removeItem(key);
                  clearedSession++;
                  console.log(`Focus Troll: Removed sessionStorage key: ${key}`);
                }
              }
              
              console.log(`Focus Troll: Cleared ${clearedLocal} localStorage and ${clearedSession} sessionStorage auth items`);
            } catch (e) {
              console.log('Focus Troll: Could not clear auth storage:', e);
            }
          }
        });
      } catch (e) {
        console.log(`Focus Troll: Could not clear storage for tab ${tab.id}`);
      }
    }
    
    console.log(`Focus Troll: Cleared ${totalCleared} cookies for ${hostname}`);
  } catch (error) {
    console.error(`Failed to clear cookies for ${hostname}:`, error);
  }
}

function recordTabInfo(tabId, url, incognito) {
  const normalizedHost = extractNormalizedHost(url);
  tabInfo.set(tabId, { url, incognito, normalizedHost });
  if (normalizedHost) {
    console.log(`Focus Troll: Stored tab info for ${tabId}: ${normalizedHost}`);
  }
}

function extractNormalizedHost(url) {
  if (!url || !isWebUrl(url)) return null;
  try {
    const { hostname } = new URL(url);
    return normalizeHostValue(hostname);
  } catch (_) {
    return null;
  }
}

function normalizeHostValue(hostname) {
  if (!hostname || typeof hostname !== 'string') return null;
  let host = hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.substring(4);
  return host;
}

function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

async function handleTabCompleted(tabId, tab) {
  await applyActionsForTab(tabId, tab);
}

async function applyActionsForTab(tabId, tab) {
  if (!tab || !tab.url || tab.incognito || !isWebUrl(tab.url)) {
    await clearGrayscale(tabId);
    await clearMindfulTimer(tabId);
    return;
  }

  recordTabInfo(tabId, tab.url, !!tab.incognito);

  try {
    const settings = await ensureSettings();
    if (!settings) {
      console.warn('Focus Troll: No settings available');
      return;
    }

    const normalizedHost = extractNormalizedHost(tab.url);
    const site = normalizedHost ? findSiteByHost(settings, normalizedHost) : null;
    const completedState = mindfulCompletedTabs.get(tabId);
    if (completedState && normalizedHost && completedState.host !== normalizedHost) {
      mindfulCompletedTabs.delete(tabId);
    }
    const onDuty = settings?.settings?.onDuty;
    const onDutyActive = isOnDutyActive(onDuty);

    console.log('Focus Troll: Tab analysis', {
      tabId,
      url: tab.url,
      normalizedHost,
      hasSite: !!site,
      blockMethod: site?.blockMethod,
      onDutyActive,
    });

    if (!onDutyActive || !site || site.blockMethod === 'none') {
      await clearGrayscale(tabId);
      await clearMindfulTimer(tabId);
      mindfulCompletedTabs.delete(tabId);
      return;
    }

    if (site.blockMethod === 'mindfulTimer') {
      const alreadyCompleted = mindfulCompletedTabs.get(tabId);
      if (alreadyCompleted && alreadyCompleted.host === normalizedHost) {
        console.log(`Focus Troll: Mindful timer already completed for tab ${tabId}`);
        return;
      }
      await clearGrayscale(tabId);
      await startMindfulTimer(tabId, tab, site, onDuty);
      return;
    }

    if (site.blockMethod === 'grayscale') {
      const opacity = parseOpacity(onDuty?.grayscaleOpacity);
      console.log(`Focus Troll: Applying grayscale to tab ${tabId} (${normalizedHost}) with opacity ${opacity}`);
      const hasPermission = await ensureSitePermissions(normalizedHost, !!site.isCustom);
      if (!hasPermission) {
        console.warn(`Focus Troll: Missing permissions for ${normalizedHost}, skipping grayscale`);
        await clearGrayscale(tabId);
        await clearMindfulTimer(tabId);
        return;
      }
      await applyGrayscale(tabId, opacity);
      await clearMindfulTimer(tabId);
    } else {
      console.log(`Focus Troll: ${normalizedHost} block method ${site.blockMethod} does not require grayscale`);
      await clearGrayscale(tabId);
      await clearMindfulTimer(tabId);
      mindfulCompletedTabs.delete(tabId);
    }
  } catch (error) {
    console.error('Focus Troll: Failed to apply actions to tab', error);
  }
}

function findSiteByHost(settings, host) {
  const sites = settings?.settings?.sites;
  if (!Array.isArray(sites)) return null;
  return sites.find((site) => normalizeHostValue(site.url) === host) || null;
}

async function ensureSettings() {
  if (settingsCache) return settingsCache;
  if (settingsPromise) return settingsPromise;

  settingsPromise = FTData.GetSettings()
    .then((settings) => {
      settingsCache = settings;
      return settingsCache;
    })
    .catch((error) => {
      settingsCache = null;
      throw error;
    })
    .finally(() => {
      settingsPromise = null;
    });

  return settingsPromise;
}

function isOnDutyActive(onDuty) {
  if (!onDuty || !onDuty.enabled) return false;
  if (onDuty.AlwaysOn) return true;

  const now = new Date();
  const dayIndex = now.getDay(); // 0 Sunday ... 6 Saturday
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const currentDayKey = dayNames[dayIndex];
  if (!onDuty.days || !onDuty.days[currentDayKey]) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = toMinutes(onDuty.startTime) ?? 0;
  const endMinutes = toMinutes(onDuty.endTime) ?? 24 * 60;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // Overnight schedule (e.g., 22:00 - 06:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function toMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return Math.max(0, Math.min(23, hours)) * 60 + Math.max(0, Math.min(59, minutes));
}

function getPermissionsForHost(host, isCustom) {
  if (DEFAULT_SITE_PERMISSIONS[host]) {
    return DEFAULT_SITE_PERMISSIONS[host];
  }
  const patterns = [`*://${host}/*`];
  if (!host.startsWith('www.')) {
    patterns.push(`*://www.${host}/*`);
  }
  return patterns;
}

async function ensureSitePermissions(host, isCustom) {
  const origins = getPermissionsForHost(host, isCustom);
  let hasPermission = false;
  try {
    hasPermission = await chrome.permissions.contains({ origins });
  } catch (error) {
    console.warn(`Focus Troll: Permission check failed for ${host}`, error);
    return false;
  }
  return hasPermission;
}

function parseOpacity(opacityValue) {
  const normalized = Number(String(opacityValue ?? '100').replace('%', ''));
  if (!Number.isFinite(normalized)) return 1;
  return Math.min(Math.max(normalized, 0), 100) / 100;
}

async function applyGrayscale(tabId, opacity) {
  const rounded = Number(opacity.toFixed(2));
  const previousOpacity = grayscaleTabs.get(tabId);
  if (previousOpacity === rounded) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (opacityValue) => {
        const applyStyles = (el) => {
          if (!el) return;
          el.style.setProperty('filter', 'grayscale(100%)', 'important');
          el.style.setProperty('opacity', String(opacityValue), 'important');
        };
        applyStyles(document.documentElement);
        applyStyles(document.body);
        document.documentElement.dataset.focusTrollGrayscale = String(opacityValue);
      },
      args: [rounded],
      injectImmediately: true,
    });
    console.log(`Focus Troll: Inline grayscale applied to tab ${tabId}`);
    grayscaleTabs.set(tabId, rounded);
  } catch (error) {
    console.error(`Focus Troll: Failed to apply grayscale to tab ${tabId}`, error);
  }
}

async function clearGrayscale(tabId) {
  if (!grayscaleTabs.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const clearStyles = (el) => {
          if (!el) return;
          el.style.removeProperty('filter');
          el.style.removeProperty('opacity');
        };
        clearStyles(document.documentElement);
        clearStyles(document.body);
        delete document.documentElement.dataset.focusTrollGrayscale;
      },
      injectImmediately: true,
    });
    console.log(`Focus Troll: Inline grayscale cleared from tab ${tabId}`);
  } catch (error) {
    console.warn(`Focus Troll: Failed to clear grayscale from tab ${tabId}`, error);
  } finally {
    grayscaleTabs.delete(tabId);
  }
}

async function startMindfulTimer(tabId, tab, site, onDuty) {
  const url = tab?.url;
  if (!url) {
    await clearMindfulTimer(tabId);
    return;
  }

  const normalizedHost = extractNormalizedHost(url);
  if (!normalizedHost) {
    await clearMindfulTimer(tabId);
    return;
  }

  const delayMs = parseMindfulDelay(onDuty?.mindfulTimerDelay);
  if (delayMs <= 0) {
    console.log(`Focus Troll: Mindful timer delay invalid for tab ${tabId}, skipping`);
    await clearMindfulTimer(tabId);
    return;
  }

  const existing = mindfulTabs.get(tabId);
  if (existing && existing.url && existing.url !== url) {
    await clearMindfulTimer(tabId);
  } else if (existing && existing.url === url && existing.active) {
    console.log(`Focus Troll: Mindful timer already active for tab ${tabId}`);
    return;
  }

  const hasPermission = await ensureSitePermissions(normalizedHost, !!site.isCustom);
  if (!hasPermission) {
    console.warn(`Focus Troll: Missing permissions for ${normalizedHost}, skipping mindful timer`);
    await clearMindfulTimer(tabId);
    return;
  }

  const instanceId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  mindfulTabs.set(tabId, {
    instanceId,
    url,
    host: normalizedHost,
    startedAt: Date.now(),
    active: true,
  });

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: mindfulTimerOverlayScript,
      args: [{
        instanceId,
        durationMs: delayMs,
        prompts: MINDFUL_PROMPTS,
        overlayColor: 'rgba(141, 186, 56, 0.8)',
        textColor: '#102617',
        timerColor: '#102617',
        buttonLabel: 'Nevermind, Close Tab',
      }],
      injectImmediately: true,
    });
    console.log(`Focus Troll: Mindful timer overlay started for tab ${tabId} (${normalizedHost})`);
  } catch (error) {
    mindfulTabs.delete(tabId);
    console.error(`Focus Troll: Failed to apply mindful timer overlay to tab ${tabId}`, error);
  }
}

async function clearMindfulTimer(tabId) {
  if (!mindfulTabs.has(tabId)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: mindfulTimerOverlayCleanup,
        injectImmediately: true,
      });
    } catch (error) {
      // Ignore cleanup errors when overlay is not present or tab is gone.
    }
    return;
  }

  mindfulTabs.delete(tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: mindfulTimerOverlayCleanup,
      injectImmediately: true,
    });
    console.log(`Focus Troll: Mindful timer overlay cleared from tab ${tabId}`);
  } catch (error) {
    console.warn(`Focus Troll: Failed to clear mindful timer overlay from tab ${tabId}`, error);
  }
}

function parseMindfulDelay(value) {
  const mapping = {
    '3s': 3000,
    '15s': 15000,
    '30s': 30000,
  };
  const normalized = String(value || '').trim();
  return mapping[normalized] ?? mapping['15s'];
}

function mindfulTimerOverlayScript(options) {
  try {
    const opts = options || {};
    const durationMsRaw = Number(opts.durationMs);
    const durationMs = Number.isFinite(durationMsRaw) ? Math.max(0, durationMsRaw) : 0;
    const prompts = Array.isArray(opts.prompts) && opts.prompts.length > 0
      ? opts.prompts
      : [
          'Take a breath. Is this visit aligned with what you planned to do right now?',
          'Would future-you thank you for the way you spend the next few minutes?',
          'Is there a smaller task you meant to finish before opening this tab?',
          'If you close this tab, what will you focus on instead?',
          'Use this pause to reset - what outcome are you hoping for from this visit?',
          'Is this tab helping you move toward today\'s top priority?',
          'Could a short stretch or glass of water serve you better than this scroll?',
          'Are you opening this out of habit or with a clear intention?',
          'Imagine it\'s the end of the day - will this detour feel worth it?',
          'What progress will you be proud of after this timer ends?'
        ];

    const run = () => {
      const doc = document;
      const body = doc.body;
      if (!body) return;

      const stateKey = '__focusTrollMindfulOverlayState';
      const previousState = window[stateKey];
      if (previousState && typeof previousState.finish === 'function') {
        previousState.finish('replaced');
      }

      const overlayId = 'focus-troll-mindful-overlay';
      const existingOverlay = doc.getElementById(overlayId);
      if (existingOverlay) existingOverlay.remove();

      const overlay = doc.createElement('div');
      overlay.id = overlayId;
      overlay.dataset.instanceId = opts.instanceId || '';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Mindful pause');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '2147483647';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.background = opts.overlayColor || 'rgba(141, 186, 56, 0.8)';
      overlay.style.color = opts.textColor || '#102617';
      overlay.style.fontFamily = opts.fontFamily || 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      overlay.style.padding = '24px';
      overlay.style.textAlign = 'center';
      overlay.style.gap = '16px';
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 200ms ease';
      overlay.tabIndex = -1;

      const settingsButton = doc.createElement('button');
      settingsButton.type = 'button';
      settingsButton.setAttribute('aria-label', 'Open Focus Troll settings');
      settingsButton.title = 'Open Focus Troll settings';
      settingsButton.style.position = 'absolute';
      settingsButton.style.top = '24px';
      settingsButton.style.right = '24px';
      settingsButton.style.width = '48px';
      settingsButton.style.height = '48px';
      settingsButton.style.display = 'flex';
      settingsButton.style.alignItems = 'center';
      settingsButton.style.justifyContent = 'center';
      settingsButton.style.border = 'none';
      settingsButton.style.borderRadius = '50%';
      settingsButton.style.background = 'rgba(255, 255, 255, 0.9)';
      settingsButton.style.cursor = 'pointer';
      settingsButton.style.boxShadow = '0 12px 28px rgba(16, 38, 23, 0.25)';
      settingsButton.style.color = opts.textColor || '#102617';
      settingsButton.style.fontSize = '22px';
      settingsButton.style.padding = '0';

      const settingsIcon = doc.createElement('i');
      settingsIcon.className = 'fa-regular fa-cog';
      settingsIcon.setAttribute('aria-hidden', 'true');
      settingsButton.appendChild(settingsIcon);

      const srText = doc.createElement('span');
      srText.textContent = 'Open Focus Troll settings';
      srText.style.position = 'absolute';
      srText.style.clip = 'rect(0 0 0 0)';
      srText.style.clipPath = 'inset(50%)';
      srText.style.width = '1px';
      srText.style.height = '1px';
      srText.style.margin = '-1px';
      srText.style.border = '0';
      srText.style.padding = '0';
      settingsButton.appendChild(srText);

      settingsButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'FT_OPEN_SETTINGS' });
          }
        } catch (_) {
          /* noop */
        }
      });

      const container = doc.createElement('div');
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';
      container.style.width = '100%';
      container.style.padding = '0 16px';

      const card = doc.createElement('div');
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.alignItems = 'center';
      card.style.gap = '24px';
      card.style.maxWidth = '640px';
      card.style.width = 'min(90vw, 640px)';
      card.style.padding = '40px 48px';
      card.style.background = 'rgba(255, 255, 255, 0.9)';
      card.style.borderRadius = '32px';
      card.style.boxShadow = '0 25px 45px rgba(16, 38, 23, 0.25)';
      card.style.textAlign = 'center';
      card.style.backdropFilter = 'blur(2px)';
      card.style.color = opts.textColor || '#102617';

      const timerEl = doc.createElement('div');
      timerEl.setAttribute('role', 'timer');
      timerEl.setAttribute('aria-live', 'assertive');
      timerEl.style.fontSize = '72px';
      timerEl.style.fontWeight = '800';
      timerEl.style.letterSpacing = '4px';
      timerEl.style.color = opts.timerColor || opts.textColor || '#102617';

      const promptEl = doc.createElement('p');
      promptEl.style.fontSize = '22px';
      promptEl.style.fontWeight = '500';
      promptEl.style.lineHeight = '1.45';
      promptEl.style.margin = '0';
      promptEl.textContent = prompts[Math.floor(Math.random() * prompts.length)] || prompts[0];

      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = opts.buttonLabel || 'Nevermind, Close Tab';
      button.style.marginTop = '12px';
      button.style.padding = '16px 32px';
      button.style.fontSize = '20px';
      button.style.fontWeight = '700';
      button.style.border = 'none';
      button.style.borderRadius = '999px';
      button.style.cursor = 'pointer';
      button.style.background = '#ffffff';
      button.style.color = opts.textColor || '#102617';
      button.style.boxShadow = '0 15px 35px rgba(16, 38, 23, 0.25)';

      const state = {
        instanceId: opts.instanceId || '',
        overlay,
        done: false,
        intervalId: null,
        timeoutId: null,
        restore: null,
        finish: null,
      };

      const html = doc.documentElement;
      const prevHtmlOverflow = html ? html.style.overflow : '';
      const prevBodyOverflow = body.style.overflow;
      if (html) html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      state.restore = () => {
        if (html) html.style.overflow = prevHtmlOverflow;
        body.style.overflow = prevBodyOverflow;
      };

      const formatMs = (ms) => {
        const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      };

      const finish = (reason) => {
        if (state.done) return;
        state.done = true;
        if (state.intervalId != null) window.clearInterval(state.intervalId);
        if (state.timeoutId != null) window.clearTimeout(state.timeoutId);
        if (typeof state.restore === 'function') {
          try { state.restore(); } catch (_) { /* noop */ }
        }
        overlay.style.opacity = '0';

        const finalize = () => {
          try {
            overlay.remove();
          } catch (_) {
            /* noop */
          }
          try {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({
                type: 'FT_MINDFUL_OVERLAY_DONE',
                instanceId: state.instanceId,
                reason,
              });
            }
          } catch (_) {
            /* noop */
          }
          if (window[stateKey] === state) {
            delete window[stateKey];
          }
        };

        overlay.addEventListener('transitionend', (event) => {
          if (event.propertyName === 'opacity') {
            finalize();
          }
        }, { once: true });

        window.setTimeout(finalize, 400);
      };

      state.finish = finish;
      window[stateKey] = state;

      button.addEventListener('click', () => {
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: 'FT_MINDFUL_CLOSE_TAB' });
          }
        } catch (_) {
          /* noop */
        }
        finish('close-tab');
      });

      card.appendChild(timerEl);
      card.appendChild(promptEl);
      card.appendChild(button);
      container.appendChild(card);
      overlay.appendChild(settingsButton);
      overlay.appendChild(container);
      body.appendChild(overlay);

      const endAt = Date.now() + durationMs;

      const updateTimer = () => {
        const remaining = endAt - Date.now();
        timerEl.textContent = formatMs(remaining);
      };

      updateTimer();

      if (durationMs === 0) {
        finish('complete');
      } else {
        state.intervalId = window.setInterval(() => {
          const remaining = endAt - Date.now();
          if (remaining <= 0) {
            timerEl.textContent = formatMs(0);
            finish('complete');
          } else {
            timerEl.textContent = formatMs(remaining);
          }
        }, 200);

        state.timeoutId = window.setTimeout(() => {
          timerEl.textContent = formatMs(0);
          finish('complete');
        }, durationMs);
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          overlay.style.opacity = '1';
          try {
            overlay.focus({ preventScroll: true });
          } catch (_) {
            /* noop */
          }
        });
      });
    };

    if (document.body) run();
    else document.addEventListener('DOMContentLoaded', run, { once: true });
  } catch (error) {
    console.error('Focus Troll: Failed to render mindful timer overlay', error);
  }
}

function mindfulTimerOverlayCleanup() {
  try {
    const stateKey = '__focusTrollMindfulOverlayState';
    const state = window[stateKey];
    if (state && typeof state.finish === 'function') {
      state.finish('external-clear');
      return;
    }
    const overlay = document.getElementById('focus-troll-mindful-overlay');
    if (overlay) {
      try {
        overlay.remove();
      } catch (_) {
        /* noop */
      }
    }
    if (window[stateKey]) delete window[stateKey];
  } catch (_) {
    // ignore cleanup failures
  }
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (tab.url) recordTabInfo(tab.id, tab.url, !!tab.incognito);
    await applyActionsForTab(tab.id, tab);
  }));
}

async function initialize() {
  try {
    await ensureSettings();
    await refreshAllTabs();
  } catch (error) {
    console.error('Focus Troll: Initialization error', error);
  }
}

initialize();

function triggerLogout() {
  window.postMessage({ type: 'FOCUS_TROLL_LOGOUT' }, '*');
}
