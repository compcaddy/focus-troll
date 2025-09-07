# Focus Troll - Claude Development Context

## Project Overview
Focus Troll is a Chrome extension that helps users stay focused by automatically logging them out of social media sites when they close tabs. It uses a privacy-first approach with optional permissions and provides a clean 2-column settings interface.

## Architecture

### Core Files
- **`manifest.json`** - Manifest V3 configuration with optional_host_permissions
- **`background.js`** - Service worker handling tab monitoring and logout logic
- **`popup.html/js`** - Settings interface with 2-column layout
- **`icons/`** - Extension icons (16, 32, 48, 128px)

### Key Technical Decisions

#### Privacy-First Optional Permissions
- Uses `optional_host_permissions` instead of required `host_permissions`
- Requests permissions dynamically when users enable sites
- **Important**: Once permissions are granted, they are NEVER removed (even when toggling off)
- This provides seamless toggle experience without repeated permission dialogs

#### Supported Sites
Default sites configured in both `background.js` and `popup.js`:
- X (Twitter) - `x.com`
- Facebook - `facebook.com`, `www.facebook.com`
- Instagram - `instagram.com`, `www.instagram.com`
- LinkedIn - `linkedin.com`, `www.linkedin.com`
- TikTok - `tiktok.com`, `www.tiktok.com`
- Reddit - `reddit.com`, `www.reddit.com`
- YouTube - `youtube.com`, `www.youtube.com`

#### Custom Sites
- Uses broad `*://*/*` permission for any custom domain
- Only requests this permission when first custom site is added
- Only removes when ALL custom sites are deleted

## User Experience Flow

### First Install
1. Extension opens full-page settings with `?setup=true` parameter
2. Shows welcome header and explanatory content
3. All sites start disabled by default
4. User can use "Enable All" button or toggle individual sites

### Regular Usage
- Click extension icon to access settings popup
- Same functionality as setup, but in compact popup format
- Toggle sites on/off without permission dialogs (after initial grant)

### Permission Flow
1. **First enable**: Shows Chrome permission dialog
2. **Grant**: Site becomes enabled, permission stored permanently
3. **Future toggles**: Instant on/off without permission dialogs
4. **Deny**: Toggle stays off, can try again later

## Logout Logic

### Tab Monitoring
- Watches for tab close events via `chrome.tabs.onRemoved`
- Ignores window closing events (`removeInfo.isWindowClosing`)
- Ignores incognito tabs
- 10-second grace period before triggering logout

### Cookie Clearing
Comprehensive authentication cookie patterns:
- Session IDs (`JSESSIONID`, `sessionid`, `session`, `sid`)
- Auth tokens (`li_at`, `auth_token`, `access_token`, `token`)
- User IDs (`aam_uuid`, `user_id`, `uid`, `account_id`)
- Login state (`logged_in`, `is_authenticated`, `login`)
- Remember me tokens (`li_rm`, `remember_token`, `persistent`)
- Site-specific patterns for LinkedIn, Facebook, Twitter, Reddit, YouTube

### Storage Clearing
Also clears localStorage and sessionStorage items matching auth patterns via content script injection.

## Development Notes

### Code Synchronization
- `DEFAULT_SITES` object exists in both `background.js` and `popup.js`
- Must be kept in sync when adding/removing supported sites
- Background script needs for monitoring, popup needs for UI

### UI Layout
- **Left column**: Informational cards explaining how the extension works
- **Right column**: All controls and settings
- **Width**: 1000px (increased from original 350px)
- **Setup mode**: Shows welcome header and "Start Monitoring" button

### State Management
- Settings stored in `chrome.storage.sync` as `focusTrollSites`
- Each site has: `enabled`, `name`, `permissions` array
- Custom sites also have `custom: true` flag

### Testing Considerations
- Test permission granting/denial flows
- Verify logout works across www/non-www variants
- Check incognito mode handling
- Test custom domain addition/removal
- Verify "Enable All" button states

## Build/Deploy
- **Development Build**: `npm run build` - Generates Tailwind CSS and copies all files to `builds/dev/`
- **CSS Only**: `npm run build:css` - Just regenerates Tailwind CSS
- **Watch Mode**: `npm run build:watch` - Watches for changes and rebuilds CSS automatically
- **Chrome Extension Loading**: Load unpacked extension from `builds/dev/` directory
- **Requirements**: Node.js and npm installed for Tailwind CSS compilation

## Future Enhancement Ideas
- Keyboard shortcuts for quick enable/disable
- Whitelist specific pages (e.g., Facebook Marketplace)
- Custom logout delay per site
- Statistics/usage tracking
- Export/import settings
- Dark mode support

## Common Issues
- **Toggle doesn't enable**: Check if permission was granted in Chrome
- **Logout not working**: Verify site is in supported list and has correct permissions
- **Custom site errors**: Ensure `*://*/*` permission is granted

## Development Environment
- Chrome Extension Manifest V3
- Vanilla JavaScript (no build tools required)
- Chrome Extensions API
- Git repository: https://github.com/compcaddy/focus-troll