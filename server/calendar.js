import { google } from 'googleapis';

function getCalendarClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var not set');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  return google.calendar({ version: 'v3', auth });
}

/**
 * Returns events whose start time falls in the window [now + fromHours, now + toHours].
 */
export async function getEventsInWindow(fromHours, toHours) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return [];
  const cal = getCalendarClient();
  const now = Date.now();
  const timeMin = new Date(now + fromHours * 3_600_000).toISOString();
  const timeMax = new Date(now + toHours * 3_600_000).toISOString();
  const res = await cal.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return res.data.items || [];
}

/**
 * Searches calendar events for a given text string (customer name / address).
 */
export async function searchCustomerEvents(searchText, daysAhead = 90) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return [];
  const cal = getCalendarClient();
  const now = new Date();
  const timeMax = new Date(now.getTime() + daysAhead * 86_400_000).toISOString();
  const res = await cal.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax,
    q: searchText,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return res.data.items || [];
}

/**
 * Parses an event title into { customerName, address }.
 *
 * Supported formats (case-insensitive):
 *   "Window clean - John Smith, 45 Calle Mayor"
 *   "Window cleaning – Jane Doe, Edificio Sol"
 *   "John Smith - 45 Calle Real"
 *   "John Smith, 45 Calle Real"
 */
export function parseEventTitle(title) {
  if (!title) return { customerName: null, address: null };

  // Strip a leading service label like "Window clean -", "WC -", "Cleaning -"
  const stripped = title.replace(/^(window\s*clean(?:ing)?|wc|cleaning)\s*[-–]\s*/i, '').trim();

  // Try "Name, Address"
  const commaMatch = stripped.match(/^(.+?),\s*(.+)$/);
  if (commaMatch) {
    return { customerName: commaMatch[1].trim(), address: commaMatch[2].trim() };
  }

  // Try "Name - Address" or "Name – Address"
  const dashMatch = stripped.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (dashMatch) {
    return { customerName: dashMatch[1].trim(), address: dashMatch[2].trim() };
  }

  return { customerName: stripped, address: null };
}

/**
 * Formats a calendar event start time as a readable string (Canary Islands time).
 */
export function formatEventTime(event) {
  const start = event.start?.dateTime || event.start?.date;
  if (!start) return 'a scheduled time';
  const d = new Date(start);
  return d.toLocaleString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Atlantic/Canary',
  });
}
