// Dynamic Watchlist rendering using FTData
// - Renders all sites from FTData.GetAllSites() (custom first)
// - Uses Google favicon service for all icons
// - Toggle off => blockMethod 'none' and hides dropdown
// - Toggle on => default method: 'hideFeed' for youtube.com/reddit.com/tiktok.com, else 'logOut' (custom too)

(function () {
  const FEED_DEFAULT_HOSTS = new Set(['youtube.com', 'reddit.com', 'tiktok.com']);

  document.addEventListener('DOMContentLoaded', () => {
    // Clear static items if present and render fresh
    renderWatchList();
    setupOnDutyUI();

    // Re-render when sync storage changes
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync') {
          renderWatchList();
          updateOnDutyUI();
        }
      });
    } catch (_) {}

    // Close any open dropdowns when clicking elsewhere on the page
    document.addEventListener('click', (e) => {
      const container = document.getElementById('watchList');
      if (!container) return;
      container.querySelectorAll('details[open]').forEach((d) => {
        if (!d.contains(e.target)) d.open = false;
      });
    });

    // Wire Add Custom Site
    const nameInput = document.getElementById('addSiteName');
    const urlInput = document.getElementById('addSiteUrl');
    const addBtn = document.getElementById('addSiteButton');
    const faviconImg = document.getElementById('addSiteFavicon');
    if (addBtn && urlInput) {
      const updateFavicon = () => {
        const host = normalizeHost(urlInput.value || '');
        if (faviconImg) {
          const h = host || 'example.com';
          faviconImg.src = getFaviconUrl(h);
        }
      };

      const updateAddButtonState = () => {
        const nameOk = !!(nameInput && nameInput.value.trim().length > 0);
        const raw = (urlInput.value || '').trim();
        const host = normalizeHost(raw);
        // Allow empty URL (will default to example.com on add)
        const urlOk = raw.length === 0 || !!host;
        const ok = nameOk && urlOk;
        addBtn.disabled = !ok;
        if (ok) {
          addBtn.classList.remove('opacity-80', 'cursor-not-allowed');
          addBtn.classList.add('hover:bg-p1/90');
        } else {
          addBtn.classList.add('opacity-80', 'cursor-not-allowed');
          addBtn.classList.remove('hover:bg-p1/90');
        }
      };

      const handler = async () => {
        if (addBtn.disabled) return;
        const name = (nameInput?.value || '').trim();
        const urlRaw = (urlInput.value || '').trim();
        let host = normalizeHost(urlRaw);
        if (!host) {
          // Default to example.com when URL is not provided or invalid
          host = 'example.com';
        }
        const label = name || host;
        // Default for custom when enabled is logOut
        const ok = await FTData.AddSite(label, host, 'logOut');
        if (!ok) {
          window.Toast?.show('Site already exists', { type: 'info' });
          return;
        }
        window.Toast?.show('Added to watchlist', { type: 'success' });
        if (nameInput) nameInput.value = '';
        urlInput.value = '';
        updateFavicon();
        updateAddButtonState();
        renderWatchList();
      };
      addBtn.addEventListener('click', handler);
      urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
      nameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
      urlInput.addEventListener('input', () => { updateFavicon(); updateAddButtonState(); });
      nameInput?.addEventListener('input', updateAddButtonState);
      // initialize state
      updateFavicon();
      updateAddButtonState();
    }
  });

  async function renderWatchList() {
    const list = document.getElementById('watchList');
    if (!list || !window.FTData) return;
    // Empty existing content (removes any hardcoded legacy items in UI)
    list.innerHTML = '';

    let sites = [];
    try {
      sites = await FTData.GetAllSites();
    } catch (e) {
      console.error('Failed to load sites:', e);
      return;
    }

    const tpl = document.getElementById('watchItemTemplate');
    if (!tpl) return;

    sites.forEach((site) => {
      const host = normalizeHost(site.url || '');
      const name = site.name || host;
      const enabled = (site.blockMethod || 'none') !== 'none';
      const method = site.blockMethod || 'none';
      const isCustom = !!site.isCustom;
      const li = tpl.content.firstElementChild.cloneNode(true);

      // Icon via Google favicon service
      const icon = li.querySelector('.js-site-icon');
      if (icon) {
        icon.src = `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${host}&size=64`;
        icon.alt = name;
      }

      // Texts
      const nameEl = li.querySelector('.js-site-name');
      const domainEl = li.querySelector('.js-site-domain');
      if (nameEl) nameEl.textContent = name;
      if (domainEl) domainEl.textContent = host; // show domain without www.

      // Dropdown setup
      const details = li.querySelector('.js-dropdown');
      const summary = li.querySelector('.js-dropdown-summary');
      const label = li.querySelector('.js-mode-label');
      const noneLabel = li.querySelector('.js-none-label');
      updateSummary(summary, label, method);
      details.open = false;

      // Hide dropdown if disabled and show "None" label
      if (!enabled && details) {
        details.style.display = 'none';
        if (noneLabel) {
          noneLabel.style.display = 'inline-flex';
          noneLabel.textContent = 'none';
        }
      } else {
        if (details) details.style.display = '';
        if (noneLabel) noneLabel.style.display = 'none';
      }

      // Dropdown actions
      const chooseLogout = li.querySelector('.js-choose-logout');
      const chooseHide = li.querySelector('.js-choose-hidefeed');
      const hideFeedDesc = li.querySelector('.js-hidefeed-desc');
      const chooseBlock = li.querySelector('.js-choose-blocksite');
      if (chooseLogout) {
        chooseLogout.addEventListener('click', async () => {
          await FTData.UpdateSiteBlockMethod(host, 'logOut');
          renderWatchList();
        });
      }
      if (chooseHide) {
        if (isCustom) {
          // Disable hide feed for custom sites
          chooseHide.classList.add('opacity-50', 'cursor-not-allowed');
          if (hideFeedDesc) hideFeedDesc.textContent = 'Not available on custom sites';
          chooseHide.addEventListener('click', () => {
            window.Toast?.show('Hide Feed not available on custom sites', { type: 'info' });
          });
        } else {
          chooseHide.addEventListener('click', async () => {
            await FTData.UpdateSiteBlockMethod(host, 'hideFeed');
            renderWatchList();
          });
        }
      }
      if (chooseBlock) {
        chooseBlock.addEventListener('click', async () => {
          await FTData.UpdateSiteBlockMethod(host, 'blockSite');
          renderWatchList();
        });
      }

      // Toggle setup
      const toggle = li.querySelector('.js-toggle');
      if (toggle) {
        toggle.checked = enabled;
        toggle.addEventListener('change', async (e) => {
          const checked = !!e.target.checked;
          if (!checked) {
            await FTData.UpdateSiteBlockMethod(host, 'none');
            renderWatchList();
            return;
          }
          // Turning on: choose default method by host
          const defMethod = FEED_DEFAULT_HOSTS.has(host) ? 'hideFeed' : 'logOut';
          await FTData.UpdateSiteBlockMethod(host, defMethod);
          renderWatchList();
        });
      }

      list.appendChild(li);
    });
  }

  async function setupOnDutyUI() {
    await updateOnDutyUI();
    const toggle = document.getElementById('onDutyToggle');
    if (toggle) {
      toggle.addEventListener('change', async (e) => {
        const checked = !!e.target.checked;
        await FTData.ToggleOnDuty(checked);
        updateOnDutyUI();
      });
    }
  }

  async function updateOnDutyUI() {
    if (!window.FTData) return;
    try {
      const data = await FTData.GetSettings();
      const enabled = !!data?.settings?.onDuty?.enabled;
      const toggle = document.getElementById('onDutyToggle');
      const label = document.getElementById('onDutyLabel');
      const overlay = document.getElementById('watchOverlay');
      if (toggle) toggle.checked = enabled;
      if (label) label.textContent = enabled ? 'Ünskrôll is on Duty' : 'Ünskrôll is off Duty';
      if (overlay) overlay.classList.toggle('hidden', enabled);
    } catch (e) {
      console.error('Failed to update On Duty UI', e);
    }
  }

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

  function getFaviconUrl(host) {
    return `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${host}&size=16`;
  }

  function updateSummary(summaryEl, labelEl, method) {
    if (!summaryEl || !labelEl) return;
    // Reset color classes
    summaryEl.classList.remove('text-danger', 'text-warning');
    // Always use primary green for the action label
    if (!summaryEl.classList.contains('text-p1')) summaryEl.classList.add('text-p1');
    if (method === 'logOut') {
      labelEl.textContent = 'Auto Logout';
    } else if (method === 'hideFeed') {
      labelEl.textContent = 'Hide Feed';
    } else if (method === 'blockSite') {
      labelEl.textContent = 'Block Site';
    } else {
      labelEl.textContent = '';
    }
  }
})();
