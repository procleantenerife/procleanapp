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

## Step 4 — Enable cloud data sync (recommended — prevents data loss)

By default the app only stores data in `localStorage` on each device. If
the app is removed from the home screen and re-added (common on iOS), that
local data can be wiped. Cloud sync fixes this by automatically backing up
every change to a free Firebase database, and restoring it the moment the
app is reopened.

1. Go to https://console.firebase.google.com and create a free project
2. In the project, go to **Build → Firestore Database → Create database**
   (choose **Production mode**, any region)
3. Go to **Project settings → General → Your apps → Add app → Web (`</>`)**,
   register the app (no hosting needed), and copy the `firebaseConfig` object
4. In `index.html`, find the `FIREBASE_CONFIG` constant near the top of the
   `<script>` block and replace the placeholder values with your real config
5. In Firestore, go to **Rules** and set:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /proclean_data/main {
         allow read, write: if true;
       }
     }
   }
   ```
   (This restricts access to a single document used by the app. Anyone with
   your Firebase config could read/write your business data — fine for a
   small private team app, but don't share the config publicly.)
6. Re-upload `index.html` to Netlify

Once configured, every job, customer, payment, etc. is synced automatically.
Reinstalling the app, switching devices, or clearing site data will pull
the latest data back down from the cloud on next launch.

---

## Step 5 — Install the app on team phones

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

- Business data is cached in `localStorage` on each device for instant,
  offline-first access
- If cloud sync is configured (Step 4), every change is also backed up to
  your private Firebase project and restored automatically on any device
  that opens the app — this is what protects you from losing data if the
  app is deleted and reinstalled
- Without cloud sync configured, data lives only in `localStorage` and can
  be lost if the app/site data is cleared or the home screen icon is
  removed and re-added
- No data is sent to any third party other than your own Firebase project

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
