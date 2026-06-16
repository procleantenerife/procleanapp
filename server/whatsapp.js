import axios from 'axios';
import db from './db.js';
import { runAgent } from './agent.js';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

// ── Webhook verification (GET /webhook) ────────────────────────────────────
export function verifyWebhook(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }
  console.warn('Webhook verification failed — check WEBHOOK_VERIFY_TOKEN');
  res.sendStatus(403);
}

// ── Inbound message handler (POST /webhook) ────────────────────────────────
export async function handleInbound(req, res) {
  res.sendStatus(200); // Always acknowledge immediately

  const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
  if (!messages?.length) return;

  for (const msg of messages) {
    if (msg.type !== 'text') continue;

    const from = msg.from; // E.164 without leading +
    const body = msg.text?.body?.trim() || '';
    if (!body) continue;

    console.log(`[WA IN] ${from}: ${body}`);

    db.prepare(
      `INSERT INTO messages (customer_phone, direction, body) VALUES (?, 'in', ?)`
    ).run(from, body);

    try {
      const reply = await runAgent(from, body);
      if (reply) await sendText(from, reply);
    } catch (err) {
      console.error('[agent error]', err.message);
      await sendText(
        from,
        "Sorry, I'm having a technical issue right now. Please try again in a moment or call us directly."
      );
    }
  }
}

// ── Outbound helpers ────────────────────────────────────────────────────────

export async function sendText(to, body) {
  await _dispatch(to, { type: 'text', text: { body, preview_url: false } });
  db.prepare(
    `INSERT INTO messages (customer_phone, direction, body) VALUES (?, 'out', ?)`
  ).run(to, body);
  console.log(`[WA OUT] ${to}: ${body.substring(0, 80)}...`);
}

/**
 * Send an approved WhatsApp template message.
 * @param {string} to - phone number (E.164, no +)
 * @param {string} templateName - approved template name in Meta dashboard
 * @param {string} languageCode - e.g. 'en_US' or 'es_ES'
 * @param {Array}  components   - body/header parameter substitutions
 */
export async function sendTemplate(to, templateName, languageCode = 'en_US', components = []) {
  await _dispatch(to, {
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  });
  db.prepare(
    `INSERT INTO messages (customer_phone, direction, body, template_name) VALUES (?, 'out', ?, ?)`
  ).run(to, `[Template: ${templateName}]`, templateName);
  console.log(`[WA TEMPLATE] ${to}: ${templateName}`);
}

async function _dispatch(to, payload) {
  if (!process.env.WA_PHONE_NUMBER_ID || !process.env.WA_ACCESS_TOKEN) {
    console.warn('[WA] Not configured — message not sent:', payload);
    return;
  }
  await axios.post(
    `${GRAPH_URL}/${process.env.WA_PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload },
    {
      headers: {
        Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}
