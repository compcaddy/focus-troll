# Focus Troll – Claude Reference

## Project Snapshot
- **Purpose:** Chrome extension that helps users stay on task by applying focus methods (auto logout, mindful delays, grayscale, feed hiding) per site.
- **Tech:** Manifest V3 service worker (`background.js`), vanilla JS popup (`popup2.js` + `data.js`), Tailwind-generated CSS (`tailwind.css`).
- **Storage:** Settings live in `chrome.storage.sync` under `ft_settings_v1`, managed through the Promise-based helpers in `data.js`.

## Key Files
| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, optional host permissions, scripting + cookies access |
| `background.js` | Service worker: tab tracking, logout timers, grayscale injection, settings cache |
| `popup.html` | Settings UI shell (Tailwind layout + watchlist template) |
| `popup2.js` | Main UI logic: watchlist rendering, custom-site flow, toggle handling |
| `data.js` | Storage abstraction, default site list, on-duty schedule helpers |
| `tailwind.css` | Precompiled Tailwind utilities used across the popup |

## Current Behaviour Highlights
- **Watchlist UI**
  - Sites display domain + focus method. When disabled, the method label remains but dims; dropdown is read-only until re-enabled.
  - Alert banner (`#watchListAlert`) appears if every site is toggled off.
  - Domain text is clickable (opens new tab) with hover underline.
- **Custom Sites**
  - Form now collects URL + method; site name is auto-derived (title-cased domain fragment).
  - Basic validation requires a dot in the host; invalid input triggers toast feedback.
  - `lastMethod` persists the chosen action even when toggled off.
- **Background Worker**
  - Imports `data.js`, caches settings, reacts to storage changes, tab updates, and activation.
  - Grayscale uses `chrome.scripting.executeScript` to set inline `filter`/`opacity`, ensuring styles override stubborn site CSS.
  - Auto logout waits 10 seconds after last tab closes, then clears cookies/local/session storage using predefined patterns.
  - On-duty schedule respected (day-of-week, start/end times, always-on flag).

## Data Model Essentials
```json
site = {
  name: string,
  url: string,              // normalized host (no scheme, lowercase)
  blockMethod: 'none' | 'logOut' | 'hideFeed' | 'mindfulTimer' | 'grayscale',
  lastMethod: same as above, // remembers last active method
  isCustom: boolean
}
```
- Default sites ship with `blockMethod: 'none'` and sensible `lastMethod` (e.g., YouTube/TikTok default to `hideFeed`).
- On-duty settings include `enabled`, `AlwaysOn`, `startTime`, `endTime`, `days`, `mindfulTimerDelay`, `grayscaleOpacity`.

## Permissions Story
- Optional host permissions for popular sites + wildcard (`*://*/*`) allow gradual permission requests.
- Background checks with `chrome.permissions.contains`; if missing, it logs a warning and skips feature application (no auto-request).

## Build & Development
- `npm install` (Tailwind CLI).
- `npm run build` → outputs CSS and copies extension assets into `builds/dev/` for loading in Chrome.
- `npm run build:watch` for live Tailwind recompilation during UI work.

## Gotchas & Tips
- Keep `DEFAULT_SITES` in `data.js` authoritative; mirror any changes in UI defaults.
- When adding new methods, update enums (`BLOCK_METHODS`), UI labels (`updateSummary`), and background handling.
- Popups still include `popup.js` for legacy layout; avoid regressing functionality there even though it’s largely hidden.
- For grayscale issues, check service-worker console for “Missing permissions” messages, and verify `document.documentElement.style.filter` when debugging.
- Use `FTData` helpers instead of direct storage writes to ensure `lastMethod`, validation, and caching stay consistent.

This reference reflects the codebase after the watchlist refresh and grayscale feature rollout; use it when answering questions or planning follow-up work.
