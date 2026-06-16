import db from './db.js';
import { sendText } from './whatsapp.js';

const rawOwnerPhone = () => (process.env.OWNER_PHONE || '').replace(/\D/g, '');

export function isOwner(phone) {
  const op = rawOwnerPhone();
  return op && phone === op;
}

export function isInHumanMode(phone) {
  const state = db.prepare(
    `SELECT mode FROM conversation_states WHERE customer_phone = ?`
  ).get(phone);
  return state?.mode === 'human';
}

export function setHumanMode(phone, enabled) {
  db.prepare(`
    INSERT INTO conversation_states (customer_phone, mode, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(customer_phone) DO UPDATE SET
      mode       = excluded.mode,
      updated_at = excluded.updated_at
  `).run(phone, enabled ? 'human' : 'bot');
}

/**
 * Notify the owner via WhatsApp that a conversation needs attention.
 */
export async function notifyOwner(customerPhone, reason) {
  const ownerPhone = rawOwnerPhone();
  if (!ownerPhone) {
    console.warn('[owner] OWNER_PHONE not set — cannot send alert');
    return;
  }

  const customer = db.prepare(
    'SELECT name FROM customers WHERE phone = ?'
  ).get(customerPhone);
  const name = customer?.name || `+${customerPhone}`;

  const history = db.prepare(`
    SELECT direction, body FROM messages
    WHERE customer_phone = ?
      AND template_name IS NULL
      AND body NOT LIKE '[%'
    ORDER BY sent_at DESC LIMIT 6
  `).all(customerPhone).reverse();

  const historyText = history
    .map(m => `${m.direction === 'in' ? '👤' : '🤖'} ${m.body}`)
    .join('\n');

  const alert = [
    `🚩 *Agent needs your help*`,
    ``,
    `Customer: *${name}* (+${customerPhone})`,
    `Reason: ${reason}`,
    ``,
    historyText ? `Recent conversation:\n${historyText}\n` : '',
    `Reply *TAKEOVER ${customerPhone}* to handle manually.`,
  ].filter(l => l !== undefined).join('\n');

  await sendText(ownerPhone, alert);
}

/**
 * Handle a message sent TO the business number by the owner.
 * Commands:
 *   TAKEOVER <phone>         — take over a customer conversation
 *   HANDBACK <phone>         — return conversation to bot
 *   <phone>: <message>       — relay a message to a customer
 */
export async function handleOwnerMessage(body) {
  const ownerPhone = rawOwnerPhone();
  body = body.trim();

  // TAKEOVER <phone>
  const takeoverMatch = body.match(/^TAKEOVER\s+(\d+)/i);
  if (takeoverMatch) {
    const customerPhone = takeoverMatch[1].replace(/\D/g, '');
    setHumanMode(customerPhone, true);
    const customer = db.prepare('SELECT name FROM customers WHERE phone = ?').get(customerPhone);
    const name = customer?.name || `+${customerPhone}`;
    await sendText(
      ownerPhone,
      `✅ You're now handling *${name}*'s conversation.\n\nTheir messages will be forwarded to you. To reply, send:\n${customerPhone}: your message here\n\nTo return to bot: HANDBACK ${customerPhone}`
    );
    return;
  }

  // HANDBACK <phone>
  const handbackMatch = body.match(/^HANDBACK\s+(\d+)/i);
  if (handbackMatch) {
    const customerPhone = handbackMatch[1].replace(/\D/g, '');
    setHumanMode(customerPhone, false);
    const customer = db.prepare('SELECT name FROM customers WHERE phone = ?').get(customerPhone);
    const name = customer?.name || `+${customerPhone}`;
    await sendText(
      ownerPhone,
      `🤖 Bot mode restored for *${name}*. The agent will handle their messages again.`
    );
    return;
  }

  // <phone>: <message> — relay to customer
  const relayMatch = body.match(/^(\d{10,15}):\s*(.+)$/s);
  if (relayMatch) {
    const customerPhone = relayMatch[1];
    const message = relayMatch[2].trim();
    await sendText(customerPhone, message);
    return;
  }

  // Unknown command — show help
  await sendText(
    ownerPhone,
    `❓ Unknown command.\n\nAvailable:\n• *TAKEOVER 34666123456* — take over conversation\n• *HANDBACK 34666123456* — return to bot\n• *34666123456: your reply* — send message to customer`
  );
}
