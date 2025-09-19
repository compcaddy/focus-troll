# Focus Troll Extension – Agent Guide

## Quick Orientation
- **Codebase root:** `Extension/`
- **Entry points:** `background.js` (service worker), `popup.html` + `popup2.js` (settings UI), `data.js` (storage abstraction), `manifest.json`
- **Build artefacts:** Tailwind output and packaged files land in `builds/dev/` via `npm run build`

## Features Snapshot
- **Watchlist actions:** `logOut`, `hideFeed`, `mindfulTimer`, `grayscale`
- **Auto Logout:** Clears auth cookies/storage after all tabs on a host close, respecting working-hours and on-duty toggle
- **Mindful Timer:** Uses stored delay options (`3s`, `15s`, `30s`)
- **Grayscale:** Background script injects inline styles when a site’s action is `grayscale`, during working hours, and permissions are granted
- **Custom sites:** Added via URL + method selector; name auto-generated from domain

## State & Storage
- Settings live in `chrome.storage.sync` under `ft_settings_v1`
- Each site record: `{ name, url, blockMethod, lastMethod, isCustom }`
  - `blockMethod === 'none'` means disabled, but `lastMethod` retains the prior action for UI/UX
- `data.js` exposes Promise-based helpers (`AddSite`, `UpdateSiteBlockMethod`, etc.). Always use these rather than touching storage directly

## UI Notes
- Tailwind utility bundle: `tailwind.css`
- Watchlist template in `popup.html` (`#watchItemTemplate`) is cloned and populated by `popup2.js`
- Disabled sites keep their previous method label but the dropdown is muted; alert banner (`#watchListAlert`) appears when every site is disabled
- Legacy layout (handled by `popup.js`) still exists but is hidden; don’t rely on it for new work

## Background Worker
- Imports `data.js` via `importScripts`
- Tracks tab URLs, on-duty schedule, permissions
- Injects/removes grayscale styles with `chrome.scripting.executeScript`
- Requests no new permissions silently; `ensureSitePermissions` only checks and logs missing hosts
- Auto logout waits 10 seconds, then clears cookies/local/session storage using pattern lists

## Development Workflow
1. `npm install` (only Tailwind/CLI dev deps required)
2. `npm run build` to produce CSS and copy files into `builds/dev`
3. Load unpacked extension from `builds/dev/` in `chrome://extensions`
4. For CSS tweaks during dev: `npm run build:watch`

## Testing Checklist
- Toggle each method to confirm storage updates and UI states (muted vs active)
- Verify grayscale appears after page load and clears when switching away
- Ensure alert banner appears when all watchlist switches are off
- Test custom-site validation: URL must contain a dot; method select persists
- Confirm auto logout logic respects working hours and only runs on enabled sites

## Styling & Conventions
- JS: vanilla ES modules within MV3 constraints (service worker requires `importScripts`)
- Tailwind classes kept in markup; prefer minimal inline styles except where required (e.g., injected grayscale)
- Toast notifications via `window.Toast?.show(message, { type })`
- Keep `data.js` the source of truth for defaults and enums; mirror any changes in UI constants as needed

## Useful Utilities
- `normalizeHost` / `deriveSiteName` in `popup2.js`
- `ensureSettings()` / `applyActionsForTab()` in `background.js`
- `deriveSiteName` creates a readable label from domains (used for custom sites)

## Common Pitfalls
- Forgetting to update `lastMethod` when introducing new actions – UI will fall back to `logOut`
- Injecting CSS into tabs without checking permissions – the service worker will log failures
- Relying on hidden legacy markup (`defaultSites`, `customSites`, etc.) that `popup.js` still touches

Keep this guide handy when planning or reviewing changes; it reflects the current architecture after the grayscale rollout and watchlist refresh.
