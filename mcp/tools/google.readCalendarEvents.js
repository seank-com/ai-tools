const { z } = require('zod');
const googleApis = require('../googleApiClients');

function formatLocalIso(date) {
  const d = date;
  const pad = (value) => String(value).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const offsetHours = pad(Math.floor(abs / 60));
  const offsetMinutes = pad(abs % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
}

function createReadCalendarEventsTool({ context, googleAuth }) {
  const definition = {
    title: 'Google: Read Calendar Events',
    description: 'List upcoming Google Calendar events.',
    inputSchema: {
      calendarId: z.string().min(1).optional(),
      timeMin: z.string().min(1).optional(),
      timeMax: z.string().min(1).optional(),
      maxResults: z.number().int().min(1).max(100).optional(),
      query: z.string().min(1).optional(),
      pageToken: z.string().min(1).optional()
    }
  };

  async function runWithAccessToken(fn) {
    let attempt = 0;
    while (attempt < 2) {
      const accessToken = await googleAuth.getAccessToken(context);
      try {
        return await fn(accessToken);
      } catch (err) {
        if (err && err.code === 'UNAUTH' && attempt === 0) {
          await googleAuth.invalidateSession(context);
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
    throw new Error('Failed to execute Calendar request');
  }

  async function handler(input) {
    const { calendarId, timeMin, timeMax, maxResults, query, pageToken } = input || {};

    const response = await runWithAccessToken(async (accessToken) => {
      const list = await googleApis.calendar.listEvents({
        accessToken,
        calendarId: calendarId || 'primary',
        timeMin: timeMin || formatLocalIso(new Date()),
        timeMax,
        maxResults,
        q: query,
        pageToken
      });

      const events = (list.items || []).map((event) => ({
        id: event.id,
        status: event.status,
        htmlLink: event.htmlLink,
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: event.start,
        end: event.end,
        attendees: event.attendees
      }));

      return {
        events,
        nextPageToken: list.nextPageToken
      };
    });

    const text = JSON.stringify(response, null, 2);
    return { content: [{ type: 'text', text }] };
  }

  return {
    name: 'google.read_calendar_events',
    definition,
    handler
  };
}

module.exports = createReadCalendarEventsTool;
