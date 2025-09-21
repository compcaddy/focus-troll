# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Focus Troll – Chrome Extension

## Project Overview
Chrome extension that helps users stay on task by applying focus methods (auto logout, mindful delays, grayscale, feed hiding) per site. Built with Manifest V3 service worker architecture, vanilla JS, and Tailwind CSS.

## Development Commands
```bash
npm install          # Install dependencies (Tailwind CLI)
npm run build        # Full build: CSS compilation + copy files to builds/dev/
npm run build:css    # Compile Tailwind CSS only
npm run build:copy   # Copy extension files to builds/dev/
npm run build:watch  # Watch mode for Tailwind development
```
**Note:** No test framework configured. No linting tools set up.

## Architecture & Key Components

### Service Worker (`background.js` - 1,568 lines)
- Imports `data.js` for storage operations
- Manages tab lifecycle, timers, content injection
- Features: logout timers (10s delay after last tab), grayscale injection, mindful timers
- Respects on-duty schedule before applying methods
- Graceful permission handling with fallback logging

### Data Layer (`data.js` - 582 lines)
- Promise-based `chrome.storage.sync` abstraction (`FTData` global)
- Storage key: `ft_settings_v1`
- Default sites: Facebook, Instagram, YouTube, TikTok, Reddit, X, LinkedIn
- Action logging with quota management (250 items or 30 days)
- URL normalization: strips protocol, removes www, lowercases

### UI Layer (`popup2.js` - 722 lines + `popup.html`)
- Template-based rendering using `#watchItemTemplate`
- Dynamic watchlist with toggle states
- Custom site addition with auto-derived names
- Settings panel with on-duty scheduling
- Toast notifications via `toast.js`

### Build Output Structure
```
builds/dev/         # Loadable extension directory
├── manifest.json
├── background.js
├── popup.html
├── popup2.js
├── data.js
├── tailwind.css
├── toast.js
└── [icons/images]
```

## Data Model
```javascript
site = {
  name: string,
  url: string,              // normalized host (no scheme, lowercase)
  blockMethod: 'none' | 'logOut' | 'hideFeed' | 'mindfulTimer' | 'grayscale',
  lastMethod: string,       // remembers last active method when toggled off
  isCustom: boolean
}

settings = {
  enabled: boolean,
  AlwaysOn: boolean,
  startTime: string,        // HH:MM format
  endTime: string,
  days: number[],           // 0-6 (Sun-Sat)
  mindfulTimerDelay: number,
  grayscaleOpacity: number
}
```

## Implementation Details

### Permissions Architecture
- Uses `<all_urls>` with graceful degradation
- Background checks `chrome.permissions.contains` before features
- No automatic permission requests - logs warnings only
- Predefined host patterns for popular sites

### Advanced Features
- **Logout System:** Tracks tabs per domain, 10s timer after last tab closes, clears cookies/storage
- **Grayscale:** Uses `chrome.scripting.executeScript` with inline styles to override site CSS
- **Action Logging:** Quota-aware (250 items/30 days) to respect sync storage limits
- **URL Processing:** Normalizes user input (strips protocol, www, trailing slashes)
- **State Persistence:** `lastMethod` remembers selection even when site toggled off

### UI Behavior
- Watchlist shows domain + method, dims when disabled
- Alert banner appears if all sites disabled
- Domain text clickable (opens new tab) with hover underline
- Dropdown read-only when site disabled
- Custom site form validates domain format (requires dot)

## Critical Notes
- `DEFAULT_SITES` in `data.js` is authoritative source
- When adding methods, update: `BLOCK_METHODS` enum, UI labels, background handlers
- Always use `FTData` helpers for storage operations
- Check service worker console for permission issues
- Extension loads from `builds/dev/` after build
