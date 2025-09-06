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

    // Re-render when sync storage changes
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync') renderWatchList();
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
      if (chooseLogout) {
        chooseLogout.addEventListener('click', async () => {
          await FTData.UpdateSiteBlockMethod(host, 'logOut');
          renderWatchList();
        });
      }
      if (chooseHide) {
        chooseHide.addEventListener('click', async () => {
          await FTData.UpdateSiteBlockMethod(host, 'hideFeed');
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
    } else {
      labelEl.textContent = '';
    }
  }
})();
