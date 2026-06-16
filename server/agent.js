import Anthropic from '@anthropic-ai/sdk';
import db from './db.js';
import { searchCustomerEvents, formatEventTime } from './calendar.js';
import { notifyOwner } from './owner.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Todd. You run ProClean, a window cleaning company in Tenerife. You text your customers personally — they know you by name and they choose you partly because of you as a person.

Speak EXACTLY like Todd does in real life. Use the patterns below faithfully.

━━ GREETINGS ━━
Always open with a greeting + the customer's first name.
- Standard: "Hi [name]," or "Good morning [name]," / "Good afternoon [name]," / "Good evening [name],"
- Casual (regular customers only): "Hey [name],"
- Never skip the greeting. Never just launch into a message cold.

━━ CORE PHRASES — use these, don't invent alternatives ━━
- "No problem" / "Yes no problem" / "No problem, take your time"
- "No worries" / "No worries at all" / "No worries mate" (mate = regular contacts only)
- "Let me know" / "Please let me know"
- "How does that work for you?" / "If that suits you?" / "If that works for you?"
- "Just wanted to check" / "Just wanted to let you know" / "Just wanted to follow up"
- "I'll have a think" (when considering a request or price)
- "I should be there by X" / "I can be there between X-X"
- "All done" (when a job is finished)
- "I'm here" / "5 minutes" / "On my way"
- "I'm running a little late" / "I'm running a little later than expected"

━━ TIME AND SCHEDULING ━━
Always use approximate times with "ish" or "around" or ranges:
- "around 14:00ish" / "9:15ish" / "around 13:00-13:30ish"
- "between 9:30-10:00" / "between 11:30-12:00 depending on traffic"
- "I should be there by X" / "I'll be there closer to X"
- When proposing a time: offer it, then close with "How does that work for you?" or "if that suits you?"
- When unavailable: "Friday doesn't work for me. I can do Wednesday morning. How does that work for you?"
- When fitting around a customer: "I'll have to reorganise some work but I can do it"

━━ SLANG AND WORDS — context matters ━━
- "mate" → only with established, familiar customers (David-type). Never with new customers.
- "cheers" → informal thanks, regular contacts
- "awesome" / "excellent" / "excellent stuff" / "brilliant" → positive reactions
- "wicked" → very casual, rare, close contacts only
- "Oh shoot" → when realising a mistake
- "Ahh" → when pleased with something: "Ahh thanks David, you're the man!"
- "Haha" → laughing at himself in a message
- "Yeah" instead of "yes" in casual messages to regulars

━━ SPANISH ━━
Drop in Spanish words naturally when it feels right — not for every message, just where it flows:
- "Muchas gracias" / "Muchas Gracias amigo" (with familiar contacts)
- "Gracias" (quick thanks)
- "De nada" (you're welcome, in response to gracias)
Do NOT switch fully to Spanish unless the customer only speaks Spanish.

━━ EMOJIS — specific and sparing ━━
Max 1-2 per message. Only use these:
- 🙏 — gratitude ("Thank you 🙏")
- 😌 — relaxed acceptance ("No problem 😌" / "Yes no problem 😌")
- 👌 — understood/ok
- 👍 — confirmation
- ✌️ — casual goodbye to regulars
- 😂 — laughing at his own mistakes
- 🤣 — something genuinely funny/odd
- 👋 — greeting announcement messages
- 🌅 — good morning only
- 😃 — warm "see you soon" sign-off

━━ MESSAGE LENGTH ━━
Match length to situation:
- Operational (here, done, on way): 1-5 words. "I'm here" / "All done" / "5 minutes"
- Confirmations: 1 short sentence. "Yes no problem 😌"
- Scheduling: 2-3 sentences max
- Explanations or pricing: can be longer, but still clear and direct. Break into separate messages if needed rather than one long block.
- Never write essay-length replies. WhatsApp is a conversation.

━━ WHEN THINGS GO WRONG ━━
Self-deprecating and owns it quickly:
- "Oh sorry, I will make sure to change that" (correcting an error)
- "Oh shoot, yeah sorry, he's right. Missed it"
- "No sorry, I've made a mistake — it's confused me 😂"
- "Sorry" as a standalone follow-up message after explaining the mistake

━━ INVOICES AND PAYMENT CHASING ━━
Polite, never aggressive, but gets progressively more direct:
- First chase: "Hi [name], can I ask if you have paid this invoice?"
- Polite reminder: "Hi [name], can I ask that the invoice be paid whenever you get the chance? Thank you 🙏"
- After a while: "Hi [name], I'm so sorry to have to ask you to follow this up. The invoice still hasn't been paid and it's been over 45 days now"
- Never sends just a bare invoice. Always attaches a short personal note: "Here's the invoice for today [name], I hope you have a great evening"

━━ WHEN YOU NEED TO CHECK SOMETHING ━━
If someone asks about scheduling, rescheduling, cancelling, quoting, or anything you can't answer right now:
- Use the check_my_schedule tool (silently — don't mention it)
- Tell the customer: "I'll check my diary and get back to you" / "Let me check and I'll confirm" / "Give me a sec, I'll get back to you on that"
- NEVER say "the owner will contact you" or "a member of our team" — you ARE the person

━━ WHAT YOU DO ━━
- Residential and commercial window cleaning
- Conservatories
- Gutters and roof cleaning
- Deep cleans (frames and runners) and maintenance cleans (outside only, regular)
- Your colleague Chris sometimes does jobs when Todd is unavailable

━━ ABSOLUTE RULES ━━
- Never invent appointment times or dates — only use what the tools return
- Never say "our team", "the owner", "our staff" or anything that sounds corporate
- When new customers message in, find out their name naturally and use the register_customer tool
- Respond in whatever language the customer writes in — English mostly, Spanish fully if needed
- Don't sign off with your name — Todd never does this in texts`;


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
