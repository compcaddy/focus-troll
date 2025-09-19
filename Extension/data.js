/*
  Focus Troll data layer (plain script)
  - Uses chrome.storage.sync (cloud) with separate keys for settings and actions
  - Exposes a global `FocusData` object with Promise-based methods
  - Silently sanitizes inputs; returns boolean success for mutators where practical
  - Seeds defaults on first load, including 7 popular social sites (LinkedIn added)

  Storage keys
  - SETTINGS_KEY: all settings under one object
  - ACTIONS_KEY: actions array at top-level (trimmed to 250 items or 30 days)

  Notes
  - URLs are normalized to hostnames without `www.` and lowercased
  - Dates use ISO 8601 strings (UTC)
*/

(function () {
  const SETTINGS_KEY = 'ft_settings_v1';
  const ACTIONS_KEY = 'ft_actions_v1';

  // Action retention policy (sync quota friendly)
  const MAX_ACTIONS = 250; // keep most recent 250
  const MAX_ACTION_AGE_DAYS = 30; // or those within last 30 days

  // Allowed enums
  const BLOCK_METHODS = new Set(['none', 'logOut', 'hideFeed', 'mindfulTimer', 'grayscale']);
  const AUTO_LOGOUT_DELAYS = new Set(['0s', '15s', '5m', '1h', '24h']);
  const FEED_BYPASS_METHODS = new Set(['none', 'button', 'typing']);
  const MINDFUL_TIMER_DELAYS = new Set(['3s', '15s', '30s']);
  const GRAYSCALE_OPACITY_VALUES = new Set(['100', '75', '50', '25']);

  // Default sites (built-in, not custom)
  const DEFAULT_SITES = [
    { name: 'Facebook', url: 'facebook.com', blockMethod: 'none', lastMethod: 'logOut', isCustom: false },
    { name: 'Instagram', url: 'instagram.com', blockMethod: 'none', lastMethod: 'logOut', isCustom: false },
    { name: 'YouTube', url: 'youtube.com', blockMethod: 'none', lastMethod: 'hideFeed', isCustom: false },
    { name: 'TikTok', url: 'tiktok.com', blockMethod: 'none', lastMethod: 'hideFeed', isCustom: false },
    { name: 'Reddit', url: 'reddit.com', blockMethod: 'none', lastMethod: 'hideFeed', isCustom: false },
    { name: 'X (Twitter)', url: 'x.com', blockMethod: 'none', lastMethod: 'hideFeed', isCustom: false },
    { name: 'LinkedIn', url: 'linkedin.com', blockMethod: 'none', lastMethod: 'logOut', isCustom: false },
  ];

  // Default settings object
  const DEFAULT_SETTINGS = {
    settings: {
      sites: DEFAULT_SITES.slice(),
      onDuty: {
        enabled: true,
        AlwaysOn: true,
        startTime: '08:00',
        endTime: '17:00',
        days: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },        
        autoLogoutDelay: '15s',
        feedBypassMethod: 'button',
        mindfulTimerDelay: '15s',
        grayscaleOpacity: '100',
      },
      ui: {
        panels: {
          advancedOpen: false,
          addSiteOpen: false,
        },
      },
      user: {
        name: '',
        email: '',
      },
      actions: [], // present in example; we keep actions separately at top-level for quotas/readability
    },
  };

  // In-memory cache of current state
  const state = {
    settings: null,
    actions: null,
    initialized: false,
  };

  // Single-flight initialization lock to prevent races
  let initPromise = null;

  // ---- Utilities ----

  /** Normalize an input URL/host to a bare hostname without leading www. */
  function normalizeHost(input) {
    if (!input || typeof input !== 'string') return '';
    const trimmed = input.trim();
    try {
      const hasScheme = /^(https?:)?\/\//i.test(trimmed);
      const url = new URL(hasScheme ? trimmed : 'https://' + trimmed);
      let host = (url.hostname || '').toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);
      return host;
    } catch (e) {
      let host = trimmed.toLowerCase();
      if (host.startsWith('www.')) host = host.slice(4);
      return host;
    }
  }

  /** Safe time string sanitizer: returns HH:MM (24h) or null if invalid. */
  function sanitizeTimeStr(value) {
    if (typeof value !== 'string') return null;
    const m = value.trim().match(/^([0-2]?\d):([0-5]\d)$/);
    if (!m) return null;
    let hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    let mm = parseInt(m[2], 10);
    return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);
  }

  /** Coerce to boolean. */
  function toBool(v) {
    return !!v;
  }

  /** Coerce to non-negative integer seconds; clamps to [0, 86400]. */
  function sanitizeSeconds(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(86400, Math.round(n));
  }

  /** Parse a date-like input to Date or null. Accepts Date | number(ms) | ISO string. */
  function toDateOrNull(d) {
    if (d == null) return null;
    if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
    if (typeof d === 'number') {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? null : dt;
    }
    if (typeof d === 'string') {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? null : dt;
    }
    return null;
  }

  /** ISO timestamp now (UTC). */
  function nowISO() {
    return new Date().toISOString();
  }

  /** chrome.storage.sync.get as Promise with error handling. */
  function syncGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, (result) => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) return reject(err);
        resolve(result || {});
      });
    });
  }

  /** chrome.storage.sync.set as Promise with error handling. */
  function syncSet(obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(obj, () => {
        const err = chrome.runtime && chrome.runtime.lastError;
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  /** Detect if an error is likely a quota issue. */
  function isQuotaError(err) {
    if (!err) return false;
    const msg = (err.message || String(err) || '').toLowerCase();
    return msg.includes('quota') || msg.includes('bytes') || msg.includes('quota_bytes');
  }

  /** Deep clone via JSON (sufficient for our plain data). */
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** Ensure defaults exist on first run and populate in-memory cache. */
  async function ensureInitialized() {
    if (state.initialized) return;
    if (initPromise) {
      await initPromise; // wait for ongoing init
      return;
    }
    initPromise = (async () => {
      let res = {};
      try {
        res = await syncGet([SETTINGS_KEY, ACTIONS_KEY]);
      } catch (_) {
        // On get error, proceed with defaults and attempt to set
        res = {};
      }
      // Initialize settings if missing or malformed
      let settings = res[SETTINGS_KEY];
      if (!settings || typeof settings !== 'object' || !settings.settings) {
        settings = deepClone(DEFAULT_SETTINGS);
        try { await syncSet({ [SETTINGS_KEY]: settings }); } catch (_) { /* ignore set error at init */ }
      } else {
        // Ensure critical fields exist (forward-compat add)
        if (!Array.isArray(settings.settings.sites)) settings.settings.sites = DEFAULT_SITES.slice();
        if (!settings.settings.onDuty) settings.settings.onDuty = deepClone(DEFAULT_SETTINGS.settings.onDuty);
        if (settings.settings.onDuty.AlwaysOn == null) settings.settings.onDuty.AlwaysOn = true;
        if (!settings.settings.onDuty.mindfulTimerDelay) settings.settings.onDuty.mindfulTimerDelay = DEFAULT_SETTINGS.settings.onDuty.mindfulTimerDelay;
        if (!settings.settings.onDuty.grayscaleOpacity) settings.settings.onDuty.grayscaleOpacity = DEFAULT_SETTINGS.settings.onDuty.grayscaleOpacity;
        if (Array.isArray(settings.settings.sites)) {
          settings.settings.sites = settings.settings.sites.map((site) => {
            if (!site) return site;
            const copy = { ...site };
            if (!copy.lastMethod) {
              copy.lastMethod = copy.blockMethod && copy.blockMethod !== 'none' ? copy.blockMethod : 'logOut';
            }
            return copy;
          });
        }
        if (!settings.settings.user) settings.settings.user = { name: '', email: '' };
        if (!settings.settings.actions) settings.settings.actions = [];
        if (!settings.settings.ui) settings.settings.ui = deepClone(DEFAULT_SETTINGS.settings.ui);
        if (!settings.settings.ui.panels) settings.settings.ui.panels = deepClone(DEFAULT_SETTINGS.settings.ui.panels);
      }

      // Initialize actions if missing
      let actions = res[ACTIONS_KEY];
      if (!Array.isArray(actions)) {
        actions = [];
        try { await syncSet({ [ACTIONS_KEY]: actions }); } catch (_) { /* ignore set error at init */ }
      }

      state.settings = settings;
      state.actions = actions;
      state.initialized = true;
    })();

    try { await initPromise; } finally { initPromise = null; }
  }

  /** Save settings cache to sync. On failure, reload from storage to avoid stale local mutations. */
  async function saveSettings() {
    const candidate = deepClone(state.settings);
    try {
      await syncSet({ [SETTINGS_KEY]: candidate });
      state.settings = candidate;
      return true;
    } catch (err) {
      // Reload persisted settings to maintain consistency
      try {
        const res = await syncGet([SETTINGS_KEY]);
        if (res && res[SETTINGS_KEY]) state.settings = res[SETTINGS_KEY];
      } catch (_) { /* ignore */ }
      return false;
    }
  }

  /** Save actions cache to sync with quota-aware trimming. */
  async function saveActions() {
    // Work on a copy to allow destructive trimming without losing original until it sticks
    let candidate = state.actions.slice();
    // Attempt set; on quota error, trim further and retry
    while (true) {
      try {
        await syncSet({ [ACTIONS_KEY]: candidate });
        state.actions = candidate;
        return true;
      } catch (err) {
        if (!isQuotaError(err)) {
          // Non-quota failure; reload from storage to keep consistency
          try {
            const res = await syncGet([ACTIONS_KEY]);
            if (res && Array.isArray(res[ACTIONS_KEY])) state.actions = res[ACTIONS_KEY];
          } catch (_) { /* ignore */ }
          return false;
        }
        // Quota hit: trim more aggressively
        const drop = Math.max(1, Math.ceil(candidate.length * 0.1));
        candidate = candidate.slice(0, Math.max(0, candidate.length - drop));
        if (candidate.length === 0) {
          // Even empty fails? give up
          return false;
        }
        // loop and retry
      }
    }
  }

  /** Trim actions by age and length; newest first is maintained. */
  function trimActionsInPlace() {
    const cutoff = Date.now() - MAX_ACTION_AGE_DAYS * 24 * 60 * 60 * 1000;
    // Keep only those newer than cutoff
    let filtered = state.actions.filter((a) => {
      const t = toDateOrNull(a && a.actionDate);
      return t && t.getTime() >= cutoff;
    });
    // Sort newest first
    filtered.sort((a, b) => {
      const ta = toDateOrNull(a.actionDate)?.getTime() || 0;
      const tb = toDateOrNull(b.actionDate)?.getTime() || 0;
      return tb - ta;
    });
    // Enforce max length
    if (filtered.length > MAX_ACTIONS) filtered = filtered.slice(0, MAX_ACTIONS);
    state.actions = filtered;
  }

  // Cross-context synchronization: reflect external changes into in-memory cache
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      if (changes[SETTINGS_KEY] && 'newValue' in changes[SETTINGS_KEY]) {
        state.settings = changes[SETTINGS_KEY].newValue;
      }
      if (changes[ACTIONS_KEY] && 'newValue' in changes[ACTIONS_KEY]) {
        state.actions = changes[ACTIONS_KEY].newValue || [];
      }
    });
  } catch (_) {
    // Listener may not be available in some contexts; ignore
  }

  /** Find site index by normalized hostname; returns index or -1. */
  function findSiteIndex(host) {
    if (!state.settings || !state.settings.settings || !Array.isArray(state.settings.settings.sites)) return -1;
    return state.settings.settings.sites.findIndex((s) => normalizeHost(s.url) === host);
  }

  // ---- Public API ----
  const FocusData = {
    /** Get complete settings object. */
    async GetSettings() {
      await ensureInitialized();
      return JSON.parse(JSON.stringify(state.settings));
    },

    /** Restore defaults for settings (does not touch actions). */
    async RestoreDefaults() {
      await ensureInitialized();
      state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      await saveSettings();
      return true;
    },

    /** Add a new site; duplicates (by normalized host) are rejected. */
    async AddSite(name, url, blockMethod) {
      await ensureInitialized();
      const host = normalizeHost(url);
      if (!host) return false;
      const method = BLOCK_METHODS.has(blockMethod) ? blockMethod : 'none';
      if (findSiteIndex(host) !== -1) return false; // duplicate
      const site = {
        name: (name || host).trim(),
        url: host,
        blockMethod: method,
        lastMethod: method === 'none' ? 'logOut' : method,
        isCustom: true,
      };
      state.settings.settings.sites.push(site);
      const ok = await saveSettings();
      if (!ok) {
        // On failure, reload current view to maintain consistency
        await ensureInitialized();
      }
      return !!ok;
    },

    /** Update a site's block method by siteUrl (host). */
    async UpdateSiteBlockMethod(siteUrl, blockMethod) {
      await ensureInitialized();
      const host = normalizeHost(siteUrl);
      if (!host) return false;
      const method = BLOCK_METHODS.has(blockMethod) ? blockMethod : 'none';
      const idx = findSiteIndex(host);
      if (idx === -1) return false;
      const site = state.settings.settings.sites[idx];
      if (method !== 'none') {
        site.lastMethod = method;
      }
      site.blockMethod = method;
      const ok = await saveSettings();
      return !!ok;
    },

    /** Remove site by siteUrl (host). */
    async RemoveSite(siteUrl) {
      await ensureInitialized();
      const host = normalizeHost(siteUrl);
      if (!host) return false;
      const before = state.settings.settings.sites.length;
      state.settings.settings.sites = state.settings.settings.sites.filter((s) => normalizeHost(s.url) !== host);
      const changed = state.settings.settings.sites.length !== before;
      if (changed) {
        const ok = await saveSettings();
        return !!ok;
      }
      return false;
    },

    /** Get all sites, with custom first, then alphabetical within each group. */
    async GetAllSites() {
      await ensureInitialized();
      const arr = state.settings.settings.sites.slice();
      arr.sort((a, b) => {
        if (!!b.isCustom !== !!a.isCustom) return a.isCustom ? -1 : 1; // custom first
        const an = (a.name || '').toLowerCase();
        const bn = (b.name || '').toLowerCase();
        return an.localeCompare(bn);
      });
      return arr;
    },

    /** Toggle on-duty mode. */
    async ToggleOnDuty(isOnDuty) {
      await ensureInitialized();
      state.settings.settings.onDuty.enabled = toBool(isOnDuty);
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update on-duty start time (HH:MM 24h). */
    async UpdateStartTime(time) {
      await ensureInitialized();
      const t = sanitizeTimeStr(time);
      if (!t) return false;
      state.settings.settings.onDuty.startTime = t;
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update on-duty end time (HH:MM 24h). */
    async UpdateEndTime(time) {
      await ensureInitialized();
      const t = sanitizeTimeStr(time);
      if (!t) return false;
      state.settings.settings.onDuty.endTime = t;
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update a specific day flag; day must be monday..sunday. */
    async UpdateDay(day, value) {
      await ensureInitialized();
      const d = String(day || '').toLowerCase();
      if (!['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].includes(d)) return false;
      state.settings.settings.onDuty.days[d] = toBool(value);
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update auto-logout delay (enum string). */
    async UpdateAutoLogoutDelay(delay) {
      await ensureInitialized();
      const d = (delay || '').toString();
      const val = AUTO_LOGOUT_DELAYS.has(d) ? d : '15s';
      state.settings.settings.onDuty.autoLogoutDelay = val;
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update feed bypass method (button|typing). */
    async UpdateFeedBypassMethod(method) {
      await ensureInitialized();
      const m = (method || '').toString();
      const val = FEED_BYPASS_METHODS.has(m) ? m : 'button';
      state.settings.settings.onDuty.feedBypassMethod = val;
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update mindful timer delay (enum string). */
    async UpdateMindfulTimerDelay(delay) {
      await ensureInitialized();
      const d = (delay || '').toString();
      const fallback = DEFAULT_SETTINGS.settings.onDuty.mindfulTimerDelay;
      const val = MINDFUL_TIMER_DELAYS.has(d) ? d : fallback;
      state.settings.settings.onDuty.mindfulTimerDelay = val;
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update grayscale opacity percentage. */
    async UpdateGrayscaleOpacity(opacity) {
      await ensureInitialized();
      const raw = (opacity || '').toString().replace('%', '');
      const fallback = DEFAULT_SETTINGS.settings.onDuty.grayscaleOpacity;
      const val = GRAYSCALE_OPACITY_VALUES.has(raw) ? raw : fallback;
      state.settings.settings.onDuty.grayscaleOpacity = val;
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update AlwaysOn (All Day) flag for on-duty schedule. */
    async UpdateAlwaysOn(value) {
      await ensureInitialized();
      state.settings.settings.onDuty.AlwaysOn = toBool(value);
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update user name/email (stored as-is after trim). */
    async UpdateUser(name, email) {
      await ensureInitialized();
      state.settings.settings.user = {
        name: (name || '').toString().trim(),
        email: (email || '').toString().trim(),
      };
      const ok = await saveSettings();
      return !!ok;
    },

    /** Update collapsible panel open state. panel: 'advanced' | 'addSite' */
    async UpdatePanelOpen(panel, isOpen) {
      await ensureInitialized();
      if (!state.settings.settings.ui) state.settings.settings.ui = deepClone(DEFAULT_SETTINGS.settings.ui);
      if (!state.settings.settings.ui.panels) state.settings.settings.ui.panels = deepClone(DEFAULT_SETTINGS.settings.ui.panels);
      const key = panel === 'advanced' ? 'advancedOpen' : panel === 'addSite' ? 'addSiteOpen' : null;
      if (!key) return false;
      state.settings.settings.ui.panels[key] = toBool(isOpen);
      const ok = await saveSettings();
      return !!ok;
    },

    /** Add an action; auto-trims by age and max length. */
    async AddAction(siteUrl, actionType) {
      await ensureInitialized();
      const host = normalizeHost(siteUrl);
      const type = (actionType || '').toString().trim() || 'unknown';
      if (!host) return false;
      const entry = { siteUrl: host, actionType: type, actionDate: nowISO() };
      // Prepend newest
      state.actions.unshift(entry);
      trimActionsInPlace();
      const ok = await saveActions();
      return !!ok;
    },

    /** Get actions optionally filtered by inclusive date range. */
    async GetAllActions(startDate, endDate) {
      await ensureInitialized();
      const start = toDateOrNull(startDate);
      const end = toDateOrNull(endDate);
      let items = state.actions.slice();
      if (start || end) {
        const s = start ? start.getTime() : -Infinity;
        const e = end ? end.getTime() : Infinity;
        items = items.filter((a) => {
          const t = toDateOrNull(a.actionDate)?.getTime();
          if (t == null) return false;
          return t >= s && t <= e; // inclusive
        });
      }
      // Always return newest first
      items.sort((a, b) => (toDateOrNull(b.actionDate)?.getTime() || 0) - (toDateOrNull(a.actionDate)?.getTime() || 0));
      return items;
    },

    /** Purge actions strictly older than beforeDate; returns number removed. */
    async PurgeActions(beforeDate) {
      await ensureInitialized();
      const d = toDateOrNull(beforeDate);
      if (!d) return 0;
      const cutoff = d.getTime();
      const before = state.actions.length;
      state.actions = state.actions.filter((a) => {
        const t = toDateOrNull(a.actionDate)?.getTime();
        return t != null && t >= cutoff; // keep newer-or-equal not older
      });
      const removed = before - state.actions.length;
      if (removed > 0) await saveActions();
      return removed;
    },
  };

  // Expose global
  self.FocusData = FocusData;
  // Alias for autocomplete-friendly prefix
  // Allows calling: FTData.GetAllSites(), etc.
  self.FTData = FocusData;
})();
