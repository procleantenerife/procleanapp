import Anthropic from '@anthropic-ai/sdk';
import db from './db.js';
import { searchCustomerEvents, formatEventTime } from './calendar.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the friendly receptionist for ProClean, a professional window cleaning company based in Tenerife, Spain.
You handle WhatsApp messages from customers on behalf of the business owner.

Services offered:
- Residential window cleaning
- Commercial window cleaning
- Conservatory cleaning
- Gutter cleaning & conservatory packages

Guidelines:
- Be warm, professional, and concise — this is WhatsApp, so keep messages short and natural
- Respond in the same language the customer writes in (Spanish or English)
- Never invent appointment times or details — only use information returned by your tools
- If a customer wants to cancel or reschedule, use the flag_for_owner tool and let them know the owner will call them shortly
- If you don't know the answer, say so honestly and offer to have the owner follow up
- Do not discuss competitor services or pricing beyond ProClean's own offerings
- If someone messages who is not in the customer database, greet them warmly and ask for their name so you can look them up or register them

When a new customer provides their name and/or address, use the register_customer tool to save them.`;

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
    name: 'flag_for_owner',
    description: 'Flag this conversation for the owner to follow up personally (use for cancellations, complaints, or complex requests)',
    input_schema: {
      type: 'object',
      properties: {
        phone:  { type: 'string' },
        reason: { type: 'string', description: 'Brief summary of why the owner needs to follow up' },
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

    case 'flag_for_owner': {
      db.prepare(
        `INSERT INTO messages (customer_phone, direction, body) VALUES (?, 'out', ?)`
      ).run(input.phone, `[🚩 NEEDS OWNER FOLLOW-UP: ${input.reason}]`);
      return 'Flagged for owner.';
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
