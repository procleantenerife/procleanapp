# ProClean — AI Operating System Context

## What this project is

ProClean is a Progressive Web App (PWA) for managing a window cleaning business based in Adeje, Tenerife. The entire app lives in a single file: `index.html`.

## Architecture

- **Single-file app**: all HTML, CSS, and JavaScript is in `index.html` (~154 KB)
- **No build system**: no npm, no bundler — open in a browser and it works
- **Storage**: `localStorage` only (no backend database)
- **PWA**: installable on iOS/Android via browser "Add to Home Screen"
- **Optional server**: `push-server.js` — a Node.js/Express server for server-side push notifications

## Key features

| Feature | Notes |
|---|---|
| Jobs management | Create/assign/complete jobs by date and team member |
| Customers | Client directory with contact info |
| Calendar | Monthly view with job planning |
| Payroll | Timesheet tracking, hourly rates, wages |
| Financial dashboard | Income, expenses, tax reserves, equipment fund |
| Revenue analytics | Per-employee revenue tracking |
| Push notifications | Lock-screen notifications with "Mark complete" action |
| Biometric auth | Face ID / Touch ID via WebAuthn + PIN fallback |
| Offline support | Full functionality via service worker |
| Route optimisation | AI-powered job ordering using Claude (Anthropic API) |

## AI integration (existing)

- Function `runRoute()` in `index.html` calls `https://api.anthropic.com/v1/messages`
- Model: `claude-sonnet-4-20250514`
- Replace `YOUR_VAPID_PUBLIC_KEY_HERE` with a real VAPID public key before deploying

## Local development

```bash
# Serve the app (required for service worker / PWA features)
npx serve .
# Open http://localhost:3000

# Generate VAPID keys for push notifications
npx web-push generate-vapid-keys
```

## Deployment

- **App**: drag folder onto Netlify (see DEPLOY.md)
- **Push server**: deploy `push-server.js` to Railway or Render with env vars:
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `PORT=3001`

## File map

```
procleanapp/
├── index.html        ← Entire app
├── manifest.json     ← PWA metadata
├── sw.js             ← Service worker (offline + push)
├── netlify.toml      ← Netlify routing + security headers
├── push-server.js    ← Optional Node.js push server
├── gen-icons.js      ← Icon generator script
├── icon-192.png      ← App icon
├── icon-512.png      ← Splash screen icon
├── DEPLOY.md         ← Deployment guide
└── .claude/
    ├── settings.json ← Claude Code hooks config
    └── hooks/
        └── session-start.sh ← AIOS session startup hook
```
