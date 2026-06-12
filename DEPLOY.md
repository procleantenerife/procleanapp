# ProClean PWA — Deployment Guide

## What you're deploying
A full Progressive Web App with:
- Installable on iOS & Android home screen (acts like a native app)
- Lock screen push notifications with "Mark complete" action button
- Face ID / Touch ID login (on supported devices)
- Offline support via service worker
- All features: Jobs, Calendar, Customers, Income, Expenses, Revenue, Payroll

---

## Step 1 — Deploy the app to Netlify (5 minutes, free)

1. Go to https://netlify.com and sign up (free)
2. Click **"Add new site" → "Deploy manually"**
3. Drag the entire `proclean-pwa` folder onto the Netlify upload box
4. Netlify gives you a URL like `https://proclean-abc123.netlify.app`
5. Optional: buy a custom domain (e.g. `proclean.app`) and connect it in Netlify settings

> **That's it** — the app is live and fully functional for all features
> except server-side push (step 3). Push notifications still work
> locally on the device that adds the job.

---

## Step 2 — Enable VAPID push keys (for real lock screen notifications)

Push notifications need a key pair. Do this once:

```bash
# Install web-push globally
npm install -g web-push

# Generate your keys
npx web-push generate-vapid-keys
```

You'll get output like:
```
Public Key:  BEl62iUYgUivxIkv69yViEuiBIa-...
Private Key: UUxI4O8-HoHic2...
```

1. Copy the **Public Key** into `index.html`, replacing `YOUR_VAPID_PUBLIC_KEY_HERE`
2. Re-upload to Netlify
3. Keep the **Private Key** for the push server (step 3)

---

## Step 3 — Deploy the push server (optional, for server-side push)

The push server lets the owner's device send notifications to employees'
devices remotely (not just the local device).

### Deploy to Railway (free tier)
1. Go to https://railway.app and sign up
2. Create a new project → "Deploy from GitHub" or upload `push-server.js`
3. Add environment variables in Railway dashboard:
   ```
   VAPID_PUBLIC_KEY=your_public_key_here
   VAPID_PRIVATE_KEY=your_private_key_here
   PORT=3001
   ```
4. Railway gives you a URL like `https://proclean-push.up.railway.app`
5. In `index.html`, update the `PUSH_SERVER_URL` constant to this URL

### Or deploy to Render (also free)
Same steps, at https://render.com

---

## Step 4 — Install the app on team phones

### iPhone / iPad (iOS 16.4+)
1. Open Safari and go to your Netlify URL
2. Tap the **Share** button (box with arrow) at the bottom
3. Tap **"Add to Home Screen"**
4. Tap **Add** — app appears on home screen like a native app
5. Open the app → it will ask to **Enable Notifications** → tap Allow
6. On first PIN login, iOS will offer **Face ID** setup — tap Yes

### Android
1. Open Chrome and go to your Netlify URL
2. Tap the **three-dot menu** → **"Add to Home Screen"** or **"Install app"**
3. A banner may appear automatically at the bottom — tap Install
4. Open the app → tap **Enable** on the notification banner
5. Biometric unlock uses fingerprint automatically

---

## How push notifications work once live

| Action | What happens |
|---|---|
| Owner adds a job and assigns staff | Notification fires to assigned employees' lock screens |
| Owner taps "Notify staff" button | All pending jobs for the day are pushed at once |
| Employee receives lock screen notification | They see the address and amount |
| Employee taps **"✓ Mark complete"** | Job is marked done — no need to open the app |
| Employee taps **"Open app"** | App opens directly to the Jobs tab |

---

## Face ID / Touch ID details

- **Registration**: happens automatically after first PIN login
- **Supported on**: iPhone X+ (Face ID), iPhone 8+ (Touch ID), most Android phones
- **Security**: uses WebAuthn — biometric data never leaves the device
- **Fallback**: if biometric fails, PIN login always works

---

## Data & privacy

- All business data is stored in `localStorage` on each device
- For shared real-time data across all team phones, you would add a
  backend database (Supabase free tier works well — ask for the sync upgrade)
- No data is sent to any third party

---

## Files in this package

```
proclean-pwa/
├── index.html        ← The entire app (open this in a browser to test locally)
├── manifest.json     ← PWA metadata (name, icons, theme colour)
├── sw.js             ← Service worker (offline + push notification handler)
├── netlify.toml      ← Netlify routing config
├── push-server.js    ← Optional Node.js push server
├── icons/
│   ├── icon-192.png  ← App icon (home screen, notifications)
│   └── icon-512.png  ← Splash screen icon
└── DEPLOY.md         ← This file
```

---

## Test locally before deploying

```bash
# Serve locally with HTTPS (required for service workers)
npx serve .
# Then open http://localhost:3000 in Chrome or Safari
```

To test push notifications locally, you need to use a tool like
`ngrok` to expose localhost over HTTPS, or just deploy to Netlify
(it's free and takes 2 minutes).
