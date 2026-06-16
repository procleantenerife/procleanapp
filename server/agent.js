import Anthropic from '@anthropic-ai/sdk';
import db from './db.js';
import { searchCustomerEvents, formatEventTime } from './calendar.js';
import { notifyOwner } from './owner.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are handling WhatsApp messages for a window cleaning business in Tenerife. You ARE the person who runs the business — not a receptionist, not an assistant, not a company rep. Write exactly as the business owner would text their customers personally.

Tone: casual and chatty, like texting a mate. Short sentences. Warm and friendly. The odd emoji is fine but don't overdo it. Customers use this service partly because they have a personal relationship with you — keep that feel alive.

Language: match whatever language the customer writes in. English → English. Spanish → Spanish. If they mix, you mix. Don't default to formal — keep it natural.

Voice rules — burn these in:
- Always say "I", never "we", "our team", "the business", etc.
- Say things like "let me check my calendar", "I'll sort that", "I'll get back to you", "give me a sec"
- Never say "the owner", "our staff", "a member of our team" or anything corporate
- Never say "please contact us" — you ARE the contact
- When you can't confirm something immediately, use the check_my_schedule tool and tell the customer you'll come back to them — e.g. "let me check that and I'll confirm" or "give me a mo, I'll get back to you"
- Keep messages short — WhatsApp, not email. Two or three lines max unless they've asked something detailed.

What you do:
- Residential and commercial window cleaning
- Conservatory cleaning
- Gutters

If someone new messages in and they're not in the database, chat naturally and find out who they are so you can look them up or get them added.
When someone gives you their name or address, use the register_customer tool to save them.
Never invent or guess appointment details — only use what the tools return.`;

const TOOLS = [
  {
    name: 'get_customer_info',
    description: 'Look up a customer record by their WhatsApp phone number',
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Phone number as received (E.164 without leading +)' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'get_upcoming_appointments',
    description: "Search Google Calendar for a customer's upcoming appointments using their name",
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Full name of the customer to search for' },
      },
      required: ['customer_name'],
    },
  },
  {
    name: 'register_customer',
    description: 'Register a new customer or update an existing one in the database',
    input_schema: {
      type: 'object',
      properties: {
        phone:        { type: 'string', description: 'Phone number (E.164 without +)' },
        name:         { type: 'string', description: 'Full name' },
        address:      { type: 'string', description: 'Property address (optional)' },
        service_type: { type: 'string', description: 'residential | commercial | conservatory | gutters (optional)' },
      },
      required: ['phone', 'name'],
    },
  },
  {
    name: 'check_my_schedule',
    description: 'Use when you need to personally follow up, check your calendar, or handle something that needs a real decision — cancellations, rescheduling, quotes, complaints. Triggers a notification so you can take over.',
    input_schema: {
      type: 'object',
      properties: {
        phone:  { type: 'string' },
        reason: { type: 'string', description: 'Brief summary of what needs following up' },
      },
      required: ['phone', 'reason'],
    },
  },
];

async function executeTool(name, input) {
  switch (name) {
    case 'get_customer_info': {
      const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(input.phone);
      return customer
        ? JSON.stringify(customer)
        : 'No customer found with this phone number in the database.';
    }

    case 'get_upcoming_appointments': {
      const events = await searchCustomerEvents(input.customer_name, 90);
      if (!events.length) return 'No upcoming appointments found for this customer in the calendar.';
      return events
        .slice(0, 3)
        .map(e => `• ${e.summary} — ${formatEventTime(e)}`)
        .join('\n');
    }

    case 'register_customer': {
      const normPhone = input.phone.replace(/\D/g, '');
      db.prepare(`
        INSERT INTO customers (name, phone, address, service_type)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET
          name         = excluded.name,
          address      = COALESCE(excluded.address, address),
          service_type = COALESCE(excluded.service_type, service_type)
      `).run(input.name, normPhone, input.address || null, input.service_type || null);
      return `Customer registered: ${input.name} (${normPhone})`;
    }

    case 'check_my_schedule': {
      db.prepare(
        `INSERT INTO messages (customer_phone, direction, body) VALUES (?, 'out', ?)`
      ).run(input.phone, `[🚩 NEEDS FOLLOW-UP: ${input.reason}]`);
      notifyOwner(input.phone, input.reason).catch(err =>
        console.error('[owner notify error]', err.message)
      );
      return 'Notification sent. Tell the customer you will check and get back to them.';
    }

    default:
      return 'Unknown tool.';
  }
}

/**
 * Run the conversational agent for an inbound WhatsApp message.
 * Returns the text reply to send back, or null if nothing should be sent.
 */
export async function runAgent(fromPhone, userMessage) {
  const history = buildHistory(fromPhone);
  history.push({ role: 'user', content: userMessage });

  let response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: TOOLS,
    messages: history,
  });

  // Agentic tool-use loop
  while (response.stop_reason === 'tool_use') {
    const toolBlock = response.content.find(b => b.type === 'tool_use');
    console.log(`[agent tool] ${toolBlock.name}`, toolBlock.input);
    const result = await executeTool(toolBlock.name, toolBlock.input);

    history.push({ role: 'assistant', content: response.content });
    history.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolBlock.id, content: result }],
    });

    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: history,
    });
  }

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.text?.trim() || null;
}

function buildHistory(phone) {
  const rows = db.prepare(`
    SELECT direction, body
    FROM messages
    WHERE customer_phone = ?
      AND template_name IS NULL
      AND body NOT LIKE '[%'
    ORDER BY sent_at DESC
    LIMIT 20
  `).all(phone).reverse();

  // Merge consecutive same-role messages and ensure messages alternate
  const merged = [];
  for (const row of rows) {
    const role = row.direction === 'in' ? 'user' : 'assistant';
    if (merged.length && merged[merged.length - 1].role === role) {
      merged[merged.length - 1].content += '\n' + row.body;
    } else {
      merged.push({ role, content: row.body });
    }
  }

  // Messages must start with 'user'
  while (merged.length && merged[0].role !== 'user') merged.shift();

  return merged;
}
