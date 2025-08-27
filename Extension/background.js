console.log('🎯 FOCUS TROLL BACKGROUND SCRIPT LOADING 🎯');

const DEFAULT_SITES = {
  'x.com': { enabled: false, name: 'X (Twitter)', permissions: ['*://x.com/*'] },
  'facebook.com': { enabled: false, name: 'Facebook', permissions: ['*://facebook.com/*', '*://www.facebook.com/*'] },
  'instagram.com': { enabled: false, name: 'Instagram', permissions: ['*://instagram.com/*', '*://www.instagram.com/*'] },
  'linkedin.com': { enabled: false, name: 'LinkedIn', permissions: ['*://linkedin.com/*', '*://www.linkedin.com/*'] },
  'tiktok.com': { enabled: false, name: 'TikTok', permissions: ['*://tiktok.com/*', '*://www.tiktok.com/*'] },
  'reddit.com': { enabled: false, name: 'Reddit', permissions: ['*://reddit.com/*', '*://www.reddit.com/*'] },
  'youtube.com': { enabled: false, name: 'YouTube', permissions: ['*://youtube.com/*', '*://www.youtube.com/*'] }
};

const LOGOUT_DELAY = 10000; // 10 seconds
const logoutTimers = new Map();

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get(['focusTrollSites'], (result) => {
    if (!result.focusTrollSites) {
      chrome.storage.sync.set({ focusTrollSites: DEFAULT_SITES });
    }
  });
  
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?setup=true') });
  }
});

console.log('Focus Troll: Background script loaded');

// Store tab info before tabs are closed
const tabInfo = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    tabInfo.set(tabId, { url: tab.url, incognito: tab.incognito });
    console.log(`Focus Troll: Stored tab info for ${tabId}: ${tab.url}`);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  console.log(`Focus Troll: Tab ${tabId} removed, isWindowClosing: ${removeInfo.isWindowClosing}`);
  
  if (removeInfo.isWindowClosing) return;
  
  try {
    const tab = tabInfo.get(tabId);
    if (!tab || !tab.url) {
      console.log(`Focus Troll: No stored info for tab ${tabId}`);
      return;
    }
    
    if (tab.incognito) {
      console.log(`Focus Troll: Skipping incognito tab`);
      return;
    }
    
    const hostname = new URL(tab.url).hostname;
    console.log(`Focus Troll: Processing tab close for ${hostname}`);
    
    const settings = await chrome.storage.sync.get(['focusTrollSites']);
    const sites = settings.focusTrollSites || DEFAULT_SITES;
    
    if (!sites[hostname] || !sites[hostname].enabled) {
      console.log(`Focus Troll: ${hostname} not enabled or not in sites list`);
      return;
    }
    
    const hasPermission = await chrome.permissions.contains({
      origins: sites[hostname].permissions
    });
    
    if (!hasPermission) {
      console.log(`Focus Troll: No permission for ${hostname}`);
      return;
    }
    
    if (logoutTimers.has(hostname)) {
      clearTimeout(logoutTimers.get(hostname));
      console.log(`Focus Troll: Cleared existing timer for ${hostname}`);
    }
    
    console.log(`Focus Troll: Starting ${LOGOUT_DELAY}ms timer for ${hostname}`);
    
    const timer = setTimeout(async () => {
      console.log(`Focus Troll: Timer fired for ${hostname}, checking remaining tabs`);
      
      const remainingTabs = await chrome.tabs.query({});
      const sameDomainTabs = remainingTabs.filter(tab => {
        if (tab.incognito) return false;
        try {
          const tabHostname = new URL(tab.url).hostname;
          return tabHostname === hostname;
        } catch (e) {
          return false;
        }
      });
      
      console.log(`Focus Troll: Found ${sameDomainTabs.length} remaining tabs for ${hostname}`);
      
      if (sameDomainTabs.length === 0) {
        console.log(`Focus Troll: No remaining tabs, logging out from ${hostname}`);
        await performLogout(hostname);
      } else {
        console.log(`Focus Troll: Still have tabs open for ${hostname}, skipping logout`);
      }
      
      logoutTimers.delete(hostname);
    }, LOGOUT_DELAY);
    
    logoutTimers.set(hostname, timer);
    
    // Clean up stored tab info
    tabInfo.delete(tabId);
    
  } catch (error) {
    console.error('Focus Troll error:', error);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.url || tab.incognito) return;
  
  try {
    const hostname = new URL(tab.url).hostname;
    if (logoutTimers.has(hostname)) {
      clearTimeout(logoutTimers.get(hostname));
      logoutTimers.delete(hostname);
      console.log(`Focus Troll: Cancelled logout for ${hostname} (new tab opened)`);
    }
  } catch (error) {
    // Ignore invalid URLs
  }
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

function triggerLogout() {
  window.postMessage({ type: 'FOCUS_TROLL_LOGOUT' }, '*');
}