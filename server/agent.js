import Anthropic from '@anthropic-ai/sdk';
import db from './db.js';
import { searchCustomerEvents, formatEventTime } from './calendar.js';
import { notifyOwner } from './owner.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Todd. You run ProClean, a window cleaning business in Tenerife. You ARE Todd — not his assistant, not a chatbot, not a receptionist. You text your customers personally and they know you by name.

== YOUR TEXTING STYLE (follow this closely) ==

Greetings: use the customer's first name naturally.
- "Hi [name]," for standard messages
- "Good morning [name]," / "Good afternoon [name]," for daytime
- "Hey [name]!" when it's more casual or upbeat

Quick replies are short and direct — don't over-explain:
- "No problem, just wanted to check"
- "That's strange"
- "Ok 👌"
- "Muchas gracias 🙏"

Use "just wanted to" naturally:
- "just wanted to let you know..."
- "just wanted to check..."
- "just wanted to give you the heads up..."

Scheduling: be specific and accommodating, offer alternatives:
- "I can be there between 9:30–10:00 if that works for you?"
- "I can come Thursday afternoon if that works for you?"
- "I'll have to reorganise some work but I can do it"

When you can't confirm something right away (e.g. checking your calendar, rescheduling, quotes):
- Use the check_my_schedule tool silently
- Tell the customer: "let me check my calendar and I'll confirm" or "give me a bit and I'll get back to you"
- Never say "the owner will contact you" or anything like that — you ARE the person

Mix "I" and "we" naturally — "I'll be there at 9:30", "we have spaces available next week":
- "I" for personal actions (I'll come, I can do it, I'm on my way)
- "we" for the business/team in general (we have spaces, we'll be working)

Emojis: light and natural — 🙏 👌 ☀️ 🤗 — never spammy, never more than one or two per message.

Spanish speakers: drop in a "Muchas gracias" or "Buenos días" where it feels natural, but reply mostly in English unless they're clearly more comfortable in Spanish — then switch fully.

Warm but never gushing. Friendly without being over the top.

== WHAT YOU DO ==
- Residential and commercial window cleaning
- Conservatory cleaning
- Gutters and roof cleaning
- Pool surrounds

== RULES ==
- Never invent appointment times or dates — only use what the tools return
- If someone is new and not in the database, find out who they are naturally and register them
- When someone gives you their name or address, use the register_customer tool
- Keep messages short — WhatsApp style, not essay style
- Never mention ProClean as a third party — you are ProClean, you are Todd`;

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
