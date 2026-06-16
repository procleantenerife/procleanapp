import cron from 'node-cron';
import db from './db.js';
import { getEventsInWindow, parseEventTitle, formatEventTime } from './calendar.js';
import { sendTemplate } from './whatsapp.js';

const TZ = 'Atlantic/Canary';

export function startScheduler() {
  // 48-hour appointment reminders — runs daily at 9:00 AM Canary Islands time
  cron.schedule('0 9 * * *', sendAppointmentReminders, { timezone: TZ });

  // Re-engagement sweep — runs every Monday at 10:00 AM
  cron.schedule('0 10 * * 1', sendReengagementMessages, { timezone: TZ });

  console.log('Scheduler started (tz: Atlantic/Canary)');
}

// ── 48-hour appointment reminders ──────────────────────────────────────────

async function sendAppointmentReminders() {
  console.log('[scheduler] Running 48-hour reminder job...');
  try {
    // Look for events starting between 46 and 50 hours from now
    const events = await getEventsInWindow(46, 50);
    console.log(`[scheduler] Found ${events.length} event(s) in window`);

    for (const event of events) {
      const { customerName, address } = parseEventTitle(event.summary);
      if (!customerName) continue;

      // Skip if reminder already sent for this event
      const alreadySent = db.prepare(
        `SELECT 1 FROM reminder_log WHERE calendar_event_id = ? AND reminder_type = 'appointment'`
      ).get(event.id);
      if (alreadySent) continue;

      const customer = matchCustomer(customerName, address);
      if (!customer?.phone) {
        console.log(`[scheduler] No phone found for: ${customerName}`);
        continue;
      }

      const appointmentTime = formatEventTime(event);

      await sendTemplate(
        customer.phone,
        'appointment_reminder',   // Must be approved in Meta dashboard
        'en_US',
        [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: customer.name.split(' ')[0] }, // First name
              { type: 'text', text: appointmentTime },
            ],
          },
        ]
      );

      db.prepare(
        `INSERT OR IGNORE INTO reminder_log (calendar_event_id, customer_phone, reminder_type)
         VALUES (?, ?, 'appointment')`
      ).run(event.id, customer.phone);

      db.prepare(
        `UPDATE customers SET last_contacted_at = datetime('now') WHERE phone = ?`
      ).run(customer.phone);

      console.log(`[scheduler] Reminder sent → ${customer.name} (${customer.phone}) for ${appointmentTime}`);
    }
  } catch (err) {
    console.error('[scheduler] Reminder job error:', err.message);
  }
}

// ── 9-week re-engagement ───────────────────────────────────────────────────

async function sendReengagementMessages() {
  console.log('[scheduler] Running re-engagement job...');
  try {
    const nineWeeksAgo = new Date(Date.now() - 63 * 86_400_000).toISOString();

    const staleCustomers = db.prepare(`
      SELECT * FROM customers
      WHERE phone IS NOT NULL
        AND (last_contacted_at IS NULL OR last_contacted_at < ?)
      ORDER BY last_contacted_at ASC
    `).all(nineWeeksAgo);

    console.log(`[scheduler] ${staleCustomers.length} customer(s) due for re-engagement`);

    for (const customer of staleCustomers) {
      await sendTemplate(
        customer.phone,
        'reengagement_window_cleaning',  // Must be approved in Meta dashboard
        'en_US',
        [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: customer.name.split(' ')[0] },
            ],
          },
        ]
      );

      db.prepare(
        `UPDATE customers SET last_contacted_at = datetime('now') WHERE phone = ?`
      ).run(customer.phone);

      console.log(`[scheduler] Re-engagement sent → ${customer.name}`);

      // Small delay between sends to avoid Meta rate limits
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch (err) {
    console.error('[scheduler] Re-engagement job error:', err.message);
  }
}

// ── Customer matching ──────────────────────────────────────────────────────

function matchCustomer(name, address) {
  // 1. Exact name match
  let customer = db.prepare(
    `SELECT * FROM customers WHERE lower(trim(name)) = lower(trim(?))`
  ).get(name);
  if (customer) return customer;

  // 2. First + last name anywhere in stored name
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    customer = db.prepare(
      `SELECT * FROM customers WHERE lower(name) LIKE lower(?) AND lower(name) LIKE lower(?)`
    ).get(`%${parts[0]}%`, `%${parts[parts.length - 1]}%`);
    if (customer) return customer;
  }

  // 3. First word of address match (usually the street number + name)
  if (address) {
    const addrKey = address.split(',')[0].trim();
    customer = db.prepare(
      `SELECT * FROM customers WHERE address IS NOT NULL AND lower(address) LIKE lower(?)`
    ).get(`%${addrKey}%`);
    if (customer) return customer;
  }

  return null;
}
