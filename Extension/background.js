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

    if (!onDutyActive || !site) {
      await clearGrayscale(tabId);
      return;
    }

    if (site.blockMethod === 'grayscale') {
      const opacity = parseOpacity(onDuty?.grayscaleOpacity);
      console.log(`Focus Troll: Applying grayscale to tab ${tabId} (${normalizedHost}) with opacity ${opacity}`);
      const hasPermission = await ensureSitePermissions(normalizedHost, !!site.isCustom);
      if (!hasPermission) {
        console.warn(`Focus Troll: Missing permissions for ${normalizedHost}, skipping grayscale`);
        await clearGrayscale(tabId);
        return;
      }
      await applyGrayscale(tabId, opacity);
    } else {
      console.log(`Focus Troll: ${normalizedHost} block method ${site.blockMethod} does not require grayscale`);
      await clearGrayscale(tabId);
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
