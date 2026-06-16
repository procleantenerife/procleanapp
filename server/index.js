import 'dotenv/config';
import express from 'express';
import { initDB } from './db.js';
import { verifyWebhook, handleInbound } from './whatsapp.js';
import { startScheduler } from './scheduler.js';
import customersRouter from './customers.js';

const app = express();
app.use(express.json());

// WhatsApp webhook
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleInbound);

// Customer management REST API
app.use('/customers', customersRouter);

// Health check
app.get('/health', (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

const PORT = process.env.PORT || 3001;

initDB();
startScheduler();
app.listen(PORT, () => {
  console.log(`ProClean agent running on port ${PORT}`);
  console.log(`Webhook endpoint: POST /webhook`);
});
