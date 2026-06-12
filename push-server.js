/**
 * ProClean Push Notification Server
 * ──────────────────────────────────
 * Run this on any Node.js host (Railway, Render, Fly.io — free tiers work fine).
 *
 * Setup:
 *   npm install web-push express cors
 *   npx web-push generate-vapid-keys   ← copy these into .env and index.html
 *   node push-server.js
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const webpush  = require('web-push');

const app = express();
app.use(cors());
app.use(express.json());

webpush.setVapidDetails(
  'mailto:your@email.com',           // ← change this
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/* In production, store subscriptions in a database (e.g. Supabase, PlanetScale).
   This in-memory store resets on server restart — fine for testing. */
const subscriptions = {};   // { userId: pushSubscription }

/* Employee registers their push subscription */
app.post('/subscribe', (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Missing fields' });
  subscriptions[userId] = subscription;
  console.log(`Subscription saved for ${userId}`);
  res.json({ ok: true });
});

/* Owner fires a job notification to specific employees */
app.post('/notify-job', async (req, res) => {
  const { userIds, job } = req.body;
  const results = [];
  for (const uid of userIds) {
    const sub = subscriptions[uid];
    if (!sub) { results.push({ uid, sent: false, reason: 'No subscription' }); continue; }
    try {
      await webpush.sendNotification(sub, JSON.stringify({
        title: 'ProClean – Job assigned',
        body:  `📍 ${job.address} · £${job.amount}`,
        tag:   'job-' + job.id,
        requireInteraction: true,
        actions: [
          { action: 'done', title: '✓ Mark complete' },
          { action: 'open', title: 'Open app' }
        ],
        url:   '/?page=jobs',
        jobId: job.id
      }));
      results.push({ uid, sent: true });
    } catch(err) {
      results.push({ uid, sent: false, reason: err.message });
    }
  }
  res.json({ results });
});

/* Health check */
app.get('/', (_, res) => res.json({ status: 'ProClean push server running' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Push server running on port ${PORT}`));
