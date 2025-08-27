const DEFAULT_SITES = {
  'x.com': { enabled: false, name: 'X (Twitter)', permissions: ['*://x.com/*'], icon: 'https://s.magecdn.com/social/tc-x.svg' },
  'facebook.com': { enabled: false, name: 'Facebook', permissions: ['*://facebook.com/*', '*://www.facebook.com/*'], icon: 'https://s.magecdn.com/social/tc-facebook.svg' },
  'instagram.com': { enabled: false, name: 'Instagram', permissions: ['*://instagram.com/*', '*://www.instagram.com/*'], icon: 'https://s.magecdn.com/social/tc-instagram.svg' },
  'linkedin.com': { enabled: false, name: 'LinkedIn', permissions: ['*://linkedin.com/*', '*://www.linkedin.com/*'], icon: 'https://s.magecdn.com/social/tc-linkedin.svg' },
  'tiktok.com': { enabled: false, name: 'TikTok', permissions: ['*://tiktok.com/*', '*://www.tiktok.com/*'], icon: 'https://s.magecdn.com/social/tc-tiktok.svg' },
  'reddit.com': { enabled: false, name: 'Reddit', permissions: ['*://reddit.com/*', '*://www.reddit.com/*'], icon: 'https://s.magecdn.com/social/tc-reddit.svg' },
  'youtube.com': { enabled: false, name: 'YouTube', permissions: ['*://youtube.com/*', '*://www.youtube.com/*'], icon: 'https://s.magecdn.com/social/tc-youtube.svg' }
};

let currentSettings = {};
let isSetupMode = false;
let isPermissionsMode = false;

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  isSetupMode = urlParams.has('setup');
  isPermissionsMode = urlParams.has('permissions');
  
  if (isSetupMode) {
    document.body.classList.add('setup-mode');
    //document.getElementById('setupHeader').style.display = 'block';
    //document.getElementById('setupDescription').style.display = 'block';
    document.getElementById('setupDone').style.display = 'block';
  }
  
  if (isPermissionsMode) {
    document.getElementById('setupHeader').innerHTML = '<h2>🔒 Grant Permissions</h2><p>Enable access to the sites you want to monitor</p>';
  }
  
  await loadSettings();
  await renderDefaultSites();
  renderCustomSites();
  setupEventListeners();
  updateStatus();
  await updateEnableAllButton();
});

async function loadSettings() {
  const result = await chrome.storage.sync.get(['focusTrollSites']);
  currentSettings = result.focusTrollSites || DEFAULT_SITES;
}

async function saveSettings() {
  await chrome.storage.sync.set({ focusTrollSites: currentSettings });
}

async function renderDefaultSites() {
  const container = document.getElementById('defaultSites');
  container.innerHTML = '';
  
  const defaultDomains = Object.keys(DEFAULT_SITES);
  const uniqueDefaults = {};
  
  for (const domain of defaultDomains) {
    const site = DEFAULT_SITES[domain];
    if (!uniqueDefaults[site.name]) {
      const hasPermission = await chrome.permissions.contains({
        origins: site.permissions
      });
      
      uniqueDefaults[site.name] = {
        domains: [domain],
        enabled: currentSettings[domain]?.enabled ?? false,
        name: site.name,
        permissions: site.permissions,
        hasPermission: hasPermission,
        icon: site.icon
      };
    } else {
      uniqueDefaults[site.name].domains.push(domain);
      if (currentSettings[domain]?.enabled === false) {
        uniqueDefaults[site.name].enabled = false;
      }
    }
  }
  
  Object.entries(uniqueDefaults).forEach(([name, site]) => {
    const siteElement = createSiteElement(site.name, site.enabled, false, site.domains, site.permissions, site.hasPermission, site.icon);
    container.appendChild(siteElement);
  });
}

function renderCustomSites() {
  const container = document.getElementById('customSites');
  const customSites = Object.entries(currentSettings).filter(([domain]) => 
    !DEFAULT_SITES.hasOwnProperty(domain)
  );
  
  if (customSites.length === 0) {
    container.innerHTML = '';//<div class="empty-state">No custom sites added</div>';
    return;
  }
  
  container.innerHTML = '';
  customSites.forEach(([domain, site]) => {
    const permissions = [`*://${domain}/*`, `*://www.${domain}/*`];
    const siteElement = createSiteElement(site.name || domain, site.enabled, true, [domain], permissions, false);
    container.appendChild(siteElement);
  });
}

function createSiteElement(name, enabled, isCustom, domains, permissions, hasPermission, icon = null) {
  const siteDiv = document.createElement('div');
  siteDiv.className = `site-item ${isCustom ? 'custom-site-item' : ''}`;
  
  const leftSection = document.createElement('div');
  leftSection.className = 'site-left-section';
  
  if (icon && !isCustom) {
    const iconDiv = document.createElement('div');
    iconDiv.className = 'site-icon';
    iconDiv.innerHTML = `<img src="${icon}" alt="${name}" />`;
    leftSection.appendChild(iconDiv);
  }
  
  const nameSpan = document.createElement('span');
  nameSpan.className = 'site-name';
  nameSpan.textContent = name;
  leftSection.appendChild(nameSpan);
  
  const controlsDiv = document.createElement('div');
  controlsDiv.style.display = 'flex';
  controlsDiv.style.alignItems = 'center';
  controlsDiv.style.gap = '8px';
  
  if (!isCustom && !hasPermission && !enabled) {
    const permissionBadge = document.createElement('span');
    permissionBadge.className = 'permission-badge';
    permissionBadge.textContent = 'Permission needed';
    controlsDiv.appendChild(permissionBadge);
  }
  
  const toggle = createToggle(enabled, async (newState) => {
    if (newState && !hasPermission && !isCustom) {
      if (isPermissionsMode) {
        const granted = await chrome.permissions.request({
          origins: permissions
        });
        
        if (!granted) {
          toggle.classList.remove('active');
          return;
        }
        
        hasPermission = true;
        domains.forEach(domain => {
          if (currentSettings[domain]) {
            currentSettings[domain].enabled = true;
          }
        });
        
        await saveSettings();
        await renderDefaultSites();
        updateStatus();
        await updateEnableAllButton();
        return;
      } else {
        chrome.tabs.create({ 
          url: chrome.runtime.getURL('popup.html?permissions=true'),
          active: true 
        });
        return;
      }
    }
    
    domains.forEach(domain => {
      if (currentSettings[domain]) {
        currentSettings[domain].enabled = newState;
      }
    });
    
    await saveSettings();
    updateStatus();
    await updateEnableAllButton();
  });
  
  controlsDiv.appendChild(toggle);
  
  if (isCustom) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Remove';
    deleteBtn.onclick = async () => {
      domains.forEach(domain => delete currentSettings[domain]);
      await saveSettings();
      renderCustomSites();
      updateStatus();
      
      const remainingCustomSites = Object.entries(currentSettings).filter(([domain]) => 
        !DEFAULT_SITES.hasOwnProperty(domain)
      );
      
      if (remainingCustomSites.length === 0) {
        const hasAllSitesPermission = await chrome.permissions.contains({
          origins: ['*://*/*']
        });
        
        if (hasAllSitesPermission) {
          await chrome.permissions.remove({
            origins: ['*://*/*']
          });
        }
      }
    };
    controlsDiv.appendChild(deleteBtn);
  }
  
  siteDiv.appendChild(leftSection);
  siteDiv.appendChild(controlsDiv);
  
  return siteDiv;
}

function createToggle(initialState, onChange) {
  const toggleDiv = document.createElement('div');
  toggleDiv.className = `toggle-switch ${initialState ? 'active' : ''}`;
  
  const slider = document.createElement('div');
  slider.className = 'toggle-slider';
  toggleDiv.appendChild(slider);
  
  toggleDiv.onclick = () => {
    const newState = !toggleDiv.classList.contains('active');
    toggleDiv.classList.toggle('active', newState);
    onChange(newState);
  };
  
  return toggleDiv;
}

function setupEventListeners() {
  const addBtn = document.getElementById('addSiteBtn');
  const input = document.getElementById('newSiteInput');
  const enableAllBtn = document.getElementById('enableAllBtn');
  
  addBtn.onclick = addCustomSite;
  input.onkeypress = (e) => {
    if (e.key === 'Enter') {
      addCustomSite();
    }
  };
  
  input.oninput = () => {
    const domain = input.value.trim();
    addBtn.disabled = !isValidDomain(domain) || currentSettings.hasOwnProperty(domain);
  };
  
  enableAllBtn.onclick = enableAllDefaultSites;
  
  if (isSetupMode) {
    const doneBtn = document.getElementById('setupDone');
    if (doneBtn) {
      doneBtn.onclick = () => {
        window.close();
      };
    }
  }
}

async function enableAllDefaultSites() {
  const enableAllBtn = document.getElementById('enableAllBtn');
  
  if (!isPermissionsMode) {
    chrome.tabs.create({ 
      url: chrome.runtime.getURL('popup.html?permissions=true'),
      active: true 
    });
    return;
  }
  
  enableAllBtn.disabled = true;
  enableAllBtn.textContent = 'Requesting permissions...';
  
  try {
    const allPermissions = [];
    Object.values(DEFAULT_SITES).forEach(site => {
      allPermissions.push(...site.permissions);
    });
    
    const uniquePermissions = [...new Set(allPermissions)];
    
    const granted = await chrome.permissions.request({
      origins: uniquePermissions
    });
    
    if (granted) {
      for (const [domain, site] of Object.entries(DEFAULT_SITES)) {
        const hasPermission = await chrome.permissions.contains({
          origins: site.permissions
        });
        
        if (hasPermission) {
          currentSettings[domain] = {
            ...site,
            enabled: true
          };
        }
      }
      
      await saveSettings();
      await renderDefaultSites();
      updateStatus();
      updateEnableAllButton();
      
      enableAllBtn.textContent = 'All Enabled!';
      setTimeout(() => {
        updateEnableAllButton();
      }, 2000);
    } else {
      enableAllBtn.textContent = 'Permission Denied';
      setTimeout(() => {
        updateEnableAllButton();
      }, 2000);
    }
  } catch (error) {
    console.error('Error enabling all sites:', error);
    enableAllBtn.textContent = 'Error';
    setTimeout(() => {
      updateEnableAllButton();
    }, 2000);
  }
}

async function updateEnableAllButton() {
  const enableAllBtn = document.getElementById('enableAllBtn');
  const defaultSiteEntries = Object.entries(DEFAULT_SITES);
  let allEnabled = true;
  let someEnabled = false;
  
  for (const [domain] of defaultSiteEntries) {
    const siteEnabled = currentSettings[domain]?.enabled ?? false;
    if (siteEnabled) {
      someEnabled = true;
    } else {
      allEnabled = false;
    }
  }
  
  enableAllBtn.disabled = false;
  
  if (allEnabled) {
    enableAllBtn.textContent = 'All Enabled ✓';
    enableAllBtn.style.display = "none";
  } else if (someEnabled) {
    enableAllBtn.textContent = 'Enable Permissions for All';
  } else {
    enableAllBtn.textContent = 'Enable Permissions for All';
  }
}

async function addCustomSite() {
  const input = document.getElementById('newSiteInput');
  const domain = input.value.trim().toLowerCase();
  
  if (!isValidDomain(domain)) {
    alert('Please enter a valid domain name');
    return;
  }
  
  if (currentSettings.hasOwnProperty(domain)) {
    alert('This site is already in your list');
    return;
  }
  
  const hasAllSitesPermission = await chrome.permissions.contains({
    origins: ['*://*/*']
  });
  
  if (!hasAllSitesPermission) {
    const granted = await chrome.permissions.request({
      origins: ['*://*/*']
    });
    
    if (!granted) {
      alert('Permission denied. This permission is needed to monitor custom sites.');
      return;
    }
  }
  
  const permissions = [`*://${domain}/*`, `*://www.${domain}/*`];
  currentSettings[domain] = {
    enabled: true,
    name: domain,
    custom: true,
    permissions: permissions
  };
  
  input.value = '';
  await saveSettings();
  renderCustomSites();
  updateStatus();
}

function isValidDomain(domain) {
  const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return domainRegex.test(domain) && domain.length > 0 && domain.length < 254;
}

function updateStatus() {
  const statusDiv = document.getElementById('status');
  const enabledSites = Object.values(currentSettings).filter(site => site.enabled).length;
  
  if (enabledSites > 0) {
    statusDiv.textContent = `Monitoring ${enabledSites} site(s)`;
    statusDiv.className = 'status active';
  } else {
    statusDiv.textContent = 'No sites being monitored';
    statusDiv.className = 'status';
  }
}