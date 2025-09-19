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
    setupSettingsPanel();
    setupPanelToggles();

    // Re-render when sync storage changes
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync') {
          renderWatchList();
          updateOnDutyUI();
        }
      });
    } catch (_) {}

    // Close any open dropdowns when clicking elsewhere on the page (watchlist + settings)
    document.addEventListener('click', (e) => {
      document.querySelectorAll('details[open]').forEach((d) => {
        if (!d.contains(e.target)) d.open = false;
      });
    });

    // Wire Add Custom Site
    const urlInput = document.getElementById('addSiteUrl');
    const addBtn = document.getElementById('addSiteButton');
    const methodSelect = document.getElementById('addSiteMethod');
    const defaultMethodValue = methodSelect?.value || 'logOut';
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
        const raw = (urlInput.value || '').trim();
        const host = normalizeHost(raw);
        const urlOk = !!host && host.includes('.');
        const methodOk = !!(methodSelect && methodSelect.value);
        const ok = urlOk && methodOk;
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
        const urlRaw = (urlInput.value || '').trim();
        const host = normalizeHost(urlRaw);
        if (!host) {
          window.Toast?.show('Enter a valid site URL', { type: 'info' });
          return;
        }
        if (!host.includes('.')) {
          window.Toast?.show('Enter a full domain (e.g., example.com)', { type: 'info' });
          return;
        }
        const label = deriveSiteName(host);
        const methodValue = methodSelect?.value || defaultMethodValue;
        const ok = await FTData.AddSite(label, host, methodValue);
        if (!ok) {
          window.Toast?.show('Site already exists', { type: 'info' });
          return;
        }
        window.Toast?.show('Added to watchlist', { type: 'success' });
        urlInput.value = '';
        if (methodSelect) methodSelect.value = defaultMethodValue;
        updateFavicon();
        updateAddButtonState();
        renderWatchList();
      };
      addBtn.addEventListener('click', handler);
      urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handler(); });
      urlInput.addEventListener('input', () => { updateFavicon(); updateAddButtonState(); });
      methodSelect?.addEventListener('change', updateAddButtonState);
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
    const watchAlert = document.getElementById('watchListAlert');
    let activeCount = 0;

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
      if (domainEl) {
        domainEl.textContent = host; // show domain without www.
        domainEl.classList.add('cursor-pointer');
        domainEl.addEventListener('mouseenter', () => {
          domainEl.style.textDecoration = 'underline';
        });
        domainEl.addEventListener('mouseleave', () => {
          domainEl.style.textDecoration = 'none';
        });
        domainEl.addEventListener('click', () => {
          const url = host.includes('://') ? host : `https://${host}`;
          if (chrome?.tabs?.create) {
            chrome.tabs.create({ url });
          } else {
            window.open(url, '_blank');
          }
        });
      }

      // Dropdown setup
      const details = li.querySelector('.js-dropdown');
      const summary = li.querySelector('.js-dropdown-summary');
      const label = li.querySelector('.js-mode-label');
      const noneLabel = li.querySelector('.js-none-label');
      const effectiveMethod = method === 'none' ? (site.lastMethod || 'logOut') : method;
      updateSummary(summary, label, effectiveMethod);
      if (noneLabel) noneLabel.style.display = 'none';
      details.open = false;

      if (summary) {
        summary.style.pointerEvents = enabled ? '' : 'none';
        summary.classList.toggle('opacity-60', !enabled);
        summary.classList.toggle('text-p1', enabled);
        summary.classList.toggle('text-n2', !enabled);
      }
      if (details) {
        details.style.pointerEvents = enabled ? '' : 'none';
        details.classList.toggle('opacity-60', !enabled);
      }

      if (enabled) activeCount += 1;

      // Dropdown actions
      const chooseLogout = li.querySelector('.js-choose-logout');
      const chooseHide = li.querySelector('.js-choose-hidefeed');
      const hideFeedDesc = li.querySelector('.js-hidefeed-desc');
      const chooseMindful = li.querySelector('.js-choose-mindful');
      const chooseGrayscale = li.querySelector('.js-choose-grayscale');
      const chooseRemove = li.querySelector('.js-choose-remove');
      const removeSep = li.querySelector('.js-remove-separator');
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
      if (chooseMindful) {
        chooseMindful.addEventListener('click', async () => {
          await FTData.UpdateSiteBlockMethod(host, 'mindfulTimer');
          renderWatchList();
        });
      }
      if (chooseGrayscale) {
        chooseGrayscale.addEventListener('click', async () => {
          await FTData.UpdateSiteBlockMethod(host, 'grayscale');
          renderWatchList();
        });
      }

      // Remove for custom sites only
      if (chooseRemove && removeSep) {
        if (!isCustom) {
          chooseRemove.style.display = 'none';
          removeSep.style.display = 'none';
        } else {
          chooseRemove.addEventListener('click', async () => {
            const ok = confirm(`Remove ${name} from the watchlist?`);
            if (!ok) return;
            const removed = await FTData.RemoveSite(host);
            if (removed) {
              window.Toast?.show('Removed from watchlist', { type: 'success' });
              renderWatchList();
            } else {
              window.Toast?.show('Could not remove site', { type: 'error' });
            }
          });
        }
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

    if (watchAlert) watchAlert.classList.toggle('hidden', activeCount > 0);
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
      if (label) label.textContent = enabled ? 'Ün-skrôll is on Duty' : 'Ün-skrôll is off Duty';
      if (overlay) overlay.classList.toggle('hidden', enabled);
    } catch (e) {
      console.error('Failed to update On Duty UI', e);
    }
  }

  // ----- Settings Panel -----
  function setupSettingsPanel() {
    // Populate hours/minutes selects
    const hours = Array.from({ length: 12 }, (_, i) => i + 1);
    const minutes = [0, 15, 30, 45];
    fillOptions(document.getElementById('startHour'), hours);
    fillOptions(document.getElementById('endHour'), hours);
    fillOptions(document.getElementById('startMinute'), minutes, true);
    fillOptions(document.getElementById('endMinute'), minutes, true);

    bindAutoLogoutDelay();
    bindFeedBypassMethod();
    bindAlwaysOn();
    bindTimes();
    bindDays();
    bindMindfulTimerDelay();
    bindGrayscaleOpacity();
    
    // Initial render from settings
    updateSettingsUIFromData();
  }

  function fillOptions(select, values, pad2 = false) {
    if (!select) return;
    select.innerHTML = '';
    values.forEach((v) => {
      const opt = document.createElement('option');
      const label = pad2 ? String(v).padStart(2, '0') : String(v);
      opt.value = String(v);
      opt.textContent = label;
      select.appendChild(opt);
    });
  }

  async function updateSettingsUIFromData() {
    try {
      const data = await FTData.GetSettings();
      const od = data.settings.onDuty || {};

      // Auto Logout Delay label
      const aldSummary = document.querySelector('.js-ald-summary .js-ald-label');
      if (aldSummary) aldSummary.textContent = mapAldToLabel(od.autoLogoutDelay);

      // Feed Bypass label
      const fbmSummary = document.querySelector('.js-fbm-summary .js-fbm-label');
      if (fbmSummary) {
        if (od.feedBypassMethod === 'typing') fbmSummary.textContent = 'Typing';
        else if (od.feedBypassMethod === 'none') fbmSummary.textContent = 'None';
        else fbmSummary.textContent = 'Button';
      }

      // Mindful Timer delay label
      const mtdSummary = document.querySelector('.js-mtd-summary .js-mtd-label');
      if (mtdSummary) mtdSummary.textContent = mapMindfulToLabel(od.mindfulTimerDelay);

      // Grayscale strength label
      const gsoSummary = document.querySelector('.js-gso-summary .js-gso-label');
      if (gsoSummary) gsoSummary.textContent = mapOpacityToLabel(od.grayscaleOpacity);

      // AlwaysOn toggle and schedule visibility
      const alwaysOn = od.AlwaysOn == null ? true : !!od.AlwaysOn;
      const alwaysOnToggle = document.getElementById('alwaysOnToggle');
      if (alwaysOnToggle) alwaysOnToggle.checked = alwaysOn;
      const scheduleFields = document.getElementById('scheduleFields');
      if (scheduleFields) scheduleFields.classList.toggle('hidden', alwaysOn);

      // Times (convert 24h to 12h)
      setTimeSelects('start', od.startTime || '09:00');
      setTimeSelects('end', od.endTime || '17:00');

      // Days
      const dayBtns = document.querySelectorAll('.js-day');
      dayBtns.forEach((btn) => {
        const d = btn.getAttribute('data-day');
        const on = !!(od.days && od.days[d]);
        btn.classList.toggle('bg-p1/10', on);
        btn.classList.toggle('text-p1', on);
      });

    } catch (e) {
      console.error('Failed to update settings UI', e);
    }
  }

  function mapAldToLabel(val) {
    switch (val) {
      case '0s': return 'Immediately';
      case '15s': return '15 seconds';
      case '5m': return '5 minutes';
      case '1h': return '1 hour';
      case '24h': return '24 hours';
      default: return '15 seconds';
    }
  }

  function mapMindfulToLabel(val) {
    switch (val) {
      case '3s': return '3 seconds';
      case '15s': return '15 seconds';
      case '30s': return '30 seconds';
      default: return '15 seconds';
    }
  }

  function mapOpacityToLabel(val) {
    const normalized = String(val || '100').replace('%', '');
    switch (normalized) {
      case '25': return '25%';
      case '50': return '50%';
      case '75': return '75%';
      case '100':
      default: return '100%';
    }
  }

  function bindAutoLogoutDelay() {
    const container = document.querySelector('.js-ald');
    if (!container) return;
    container.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', async () => {
        const mapping = {
          'js-ald-0s': '0s',
          'js-ald-15s': '15s',
          'js-ald-5m': '5m',
          'js-ald-1h': '1h',
          'js-ald-24h': '24h',
        };
        const cls = Array.from(li.classList).find((c) => c.startsWith('js-ald-'));
        const value = mapping[cls];
        if (value) {
          await FTData.UpdateAutoLogoutDelay(value);
          window.Toast?.show('Saved', { type: 'success' });
          updateSettingsUIFromData();
          container.open = false;
        }
      });
    });
  }

  function bindFeedBypassMethod() {
    const container = document.querySelector('.js-fbm');
    if (!container) return;
    const optionNone = container.querySelector('.js-fbm-none');
    const optionButton = container.querySelector('.js-fbm-button');
    const optionTyping = container.querySelector('.js-fbm-typing');
    const bind = (el, value) => {
      if (!el) return;
      el.addEventListener('click', async () => {
        await FTData.UpdateFeedBypassMethod(value);
        window.Toast?.show('Saved', { type: 'success' });
        updateSettingsUIFromData();
        container.open = false;
      });
    };
    bind(optionNone, 'none');
    bind(optionButton, 'button');
    bind(optionTyping, 'typing');
  }

  function bindMindfulTimerDelay() {
    const container = document.querySelector('.js-mtd');
    if (!container) return;
    const mapping = {
      'js-mtd-3s': '3s',
      'js-mtd-15s': '15s',
      'js-mtd-30s': '30s',
    };
    container.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', async () => {
        const cls = Array.from(li.classList).find((c) => c.startsWith('js-mtd-'));
        const value = mapping[cls];
        if (value) {
          await FTData.UpdateMindfulTimerDelay(value);
          window.Toast?.show('Saved', { type: 'success' });
          updateSettingsUIFromData();
          container.open = false;
        }
      });
    });
  }

  function bindGrayscaleOpacity() {
    const container = document.querySelector('.js-gso');
    if (!container) return;
    const mapping = {
      'js-gso-100': '100',
      'js-gso-75': '75',
      'js-gso-50': '50',
      'js-gso-25': '25',
    };
    container.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', async () => {
        const cls = Array.from(li.classList).find((c) => c.startsWith('js-gso-'));
        const value = mapping[cls];
        if (value) {
          await FTData.UpdateGrayscaleOpacity(value);
          window.Toast?.show('Saved', { type: 'success' });
          updateSettingsUIFromData();
          container.open = false;
        }
      });
    });
  }

  function bindAlwaysOn() {
    const toggle = document.getElementById('alwaysOnToggle');
    const scheduleFields = document.getElementById('scheduleFields');
    if (!toggle || !scheduleFields) return;
    toggle.addEventListener('change', async (e) => {
      const checked = !!e.target.checked;
      await FTData.UpdateAlwaysOn(checked);
      if (scheduleFields) scheduleFields.classList.toggle('hidden', checked);
      window.Toast?.show('Saved', { type: 'success' });
    });
  }

  function bindTimes() {
    const sh = document.getElementById('startHour');
    const sm = document.getElementById('startMinute');
    const sap = document.getElementById('startAmPm');
    const eh = document.getElementById('endHour');
    const em = document.getElementById('endMinute');
    const eap = document.getElementById('endAmPm');
    if (sh) sh.addEventListener('change', saveStartTime);
    if (sm) sm.addEventListener('change', saveStartTime);
    if (sap) sap.addEventListener('change', saveStartTime);
    if (eh) eh.addEventListener('change', saveEndTime);
    if (em) em.addEventListener('change', saveEndTime);
    if (eap) eap.addEventListener('change', saveEndTime);
  }

  async function saveStartTime() {
    const t = getTimeFromSelects('start');
    if (t) {
      await FTData.UpdateStartTime(t);
      window.Toast?.show('Saved', { type: 'success' });
    }
  }

  async function saveEndTime() {
    const t = getTimeFromSelects('end');
    if (t) {
      await FTData.UpdateEndTime(t);
      window.Toast?.show('Saved', { type: 'success' });
    }
  }

  function getTimeFromSelects(prefix) {
    const hSel = document.getElementById(prefix + 'Hour');
    const mSel = document.getElementById(prefix + 'Minute');
    const apSel = document.getElementById(prefix + 'AmPm');
    if (!hSel || !mSel || !apSel) return null;
    let hour12 = parseInt(hSel.value, 10) || 12;
    const minute = parseInt(mSel.value, 10) || 0;
    const ap = apSel.value === 'PM' ? 'PM' : 'AM';
    let hour24 = hour12 % 12;
    if (ap === 'PM') hour24 += 12;
    const hh = String(hour24).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function setTimeSelects(prefix, hhmm) {
    const [hhStr, mmStr] = (hhmm || '09:00').split(':');
    let hh = parseInt(hhStr, 10) || 0;
    const mm = parseInt(mmStr, 10) || 0;
    const ap = hh >= 12 ? 'PM' : 'AM';
    let hour12 = hh % 12;
    if (hour12 === 0) hour12 = 12;
    const hSel = document.getElementById(prefix + 'Hour');
    const mSel = document.getElementById(prefix + 'Minute');
    const apSel = document.getElementById(prefix + 'AmPm');
    if (hSel) hSel.value = String(hour12);
    if (mSel) mSel.value = String(mm);
    if (apSel) apSel.value = ap;
  }

  function bindDays() {
    const dayBtns = document.querySelectorAll('.js-day');
    dayBtns.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const d = btn.getAttribute('data-day');
        const next = !btn.classList.contains('text-p1');
        await FTData.UpdateDay(d, next);
        btn.classList.toggle('bg-p1/10', next);
        btn.classList.toggle('text-p1', next);
        window.Toast?.show('Saved', { type: 'success' });
      });
    });
  }  

  // ----- Collapsible panels (Advanced / Add Site) -----
  async function setupPanelToggles() {
    const advBtn = document.getElementById('advancedCaret');
    const advHeader = document.getElementById('advancedHeader');
    const advContent = document.getElementById('advancedContent');
    const addBtn = document.getElementById('addSiteCaret');
    const addHeader = document.getElementById('addSiteHeader');
    const addContent = document.getElementById('addSiteContent');
    const settings = await FTData.GetSettings();
    const panels = (settings.settings.ui && settings.settings.ui.panels) || {};
    const advOpen = !!panels.advancedOpen;
    const addOpen = !!panels.addSiteOpen;

    setPanelOpen(advContent, advBtn, advOpen);
    setPanelOpen(addContent, addBtn, addOpen);

    const toggleAdvanced = async () => {
      const open = togglePanel(advContent, advBtn);
      await FTData.UpdatePanelOpen('advanced', open);
    };
    const toggleAddSite = async () => {
      const open = togglePanel(addContent, addBtn);
      await FTData.UpdatePanelOpen('addSite', open);
    };

    if (advBtn) advBtn.addEventListener('click', toggleAdvanced);
    if (advHeader) advHeader.addEventListener('click', (e) => {
      // avoid double-trigger when clicking the caret itself
      if (e.target.closest('#advancedCaret')) return;
      toggleAdvanced();
    });
    if (addBtn) addBtn.addEventListener('click', toggleAddSite);
    if (addHeader) addHeader.addEventListener('click', (e) => {
      if (e.target.closest('#addSiteCaret')) return;
      toggleAddSite();
    });
  }

  function togglePanel(container, btn) {
    if (!container) return false;
    const isOpen = !container.classList.contains('hidden');
    if (isOpen) slideUp(container); else slideDown(container);
    if (btn) btn.firstElementChild?.classList.toggle('rotate-180', !isOpen);
    return !isOpen;
  }

  function setPanelOpen(container, btn, open) {
    if (!container) return;
    if (open) {
      container.classList.remove('hidden');
      container.style.maxHeight = 'none';
      if (btn) btn.firstElementChild?.classList.add('rotate-180');
    } else {
      container.classList.add('hidden');
      container.style.maxHeight = null;
      if (btn) btn.firstElementChild?.classList.remove('rotate-180');
    }
  }

  function slideUp(el) {
    el.style.overflow = 'hidden';
    el.style.maxHeight = el.scrollHeight + 'px';
    requestAnimationFrame(() => {
      el.style.transition = 'max-height 200ms ease';
      el.style.maxHeight = '0px';
      setTimeout(() => {
        el.classList.add('hidden');
        el.style.transition = '';
        el.style.maxHeight = '';
        el.style.overflow = '';
      }, 210);
    });
  }

  function slideDown(el) {
    el.classList.remove('hidden');
    el.style.overflow = 'hidden';
    el.style.maxHeight = '0px';
    const target = el.scrollHeight;
    requestAnimationFrame(() => {
      el.style.transition = 'max-height 200ms ease';
      el.style.maxHeight = target + 'px';
      setTimeout(() => {
        el.style.transition = '';
        el.style.maxHeight = '';
        el.style.overflow = '';
      }, 210);
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

  function getFaviconUrl(host) {
    return `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${host}&size=16`;
  }

  function deriveSiteName(host) {
    if (!host) return 'Site';
    let core = host.toLowerCase();
    if (core.startsWith('www.')) core = core.slice(4);
    const primary = core.split('.')[0] || core;
    const words = primary.split(/[-_]/g).filter(Boolean);
    const title = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    return title || primary.charAt(0).toUpperCase() + primary.slice(1);
  }

  function updateSummary(summaryEl, labelEl, method) {
    if (!summaryEl || !labelEl) return;
    // Reset color highlight classes
    summaryEl.classList.remove('text-danger', 'text-warning');
    if (method === 'logOut') {
      labelEl.textContent = 'Auto Logout';
    } else if (method === 'hideFeed') {
      labelEl.textContent = 'Hide Feed';
    } else if (method === 'mindfulTimer') {
      labelEl.textContent = 'Mindful Timer';
    } else if (method === 'grayscale') {
      labelEl.textContent = 'Grayscale';
    } else {
      labelEl.textContent = '';
    }
  }
})();
