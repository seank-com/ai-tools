const DEFAULT_RETRIES = 3;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, { accessToken, method = 'GET', params }) {
  let finalUrl = url;
  if (params) {
    const search = new URLSearchParams(params);
    const hasQuery = finalUrl.includes('?');
    finalUrl = `${finalUrl}${hasQuery ? '&' : '?'}${search.toString()}`;
  }

  let attempt = 0;
  while (attempt < DEFAULT_RETRIES) {
    const res = await fetch(finalUrl, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (res.status === 401) {
      const err = new Error('Unauthorized');
      err.code = 'UNAUTH';
      throw err;
    }

    if ((res.status === 429 || res.status >= 500) && attempt < DEFAULT_RETRIES - 1) {
      const wait = 500 * Math.pow(2, attempt);
      await delay(wait);
      attempt += 1;
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Google API request failed (${res.status})`);
      err.status = res.status;
      err.body = text;
      throw err;
    }

    const text = await res.text();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      const parseErr = new Error('Failed to parse Google API response');
      parseErr.cause = err;
      parseErr.body = text;
      throw parseErr;
    }
  }

  throw new Error('Exceeded Google API retry attempts');
}

async function listMessages({ accessToken, q, maxResults = 10, pageToken }) {
  const limit = typeof maxResults === 'number' ? maxResults : 10;
  const params = { maxResults: String(limit) };
  if (q) params.q = q;
  if (pageToken) params.pageToken = pageToken;
  return fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
    accessToken,
    params
  });
}

async function getMessage({ accessToken, id, format = 'full' }) {
  if (!id) {
    throw new Error('Message id required');
  }
  const params = { format };
  return fetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`, {
    accessToken,
    params
  });
}

async function listEvents({ accessToken, calendarId = 'primary', timeMin, timeMax, maxResults = 25, q, pageToken }) {
  const limit = typeof maxResults === 'number' ? maxResults : 25;
  const params = {
    maxResults: String(limit)
  };
  if (timeMin) params.timeMin = timeMin;
  if (timeMax) params.timeMax = timeMax;
  if (q) params.q = q;
  if (pageToken) params.pageToken = pageToken;
  params.singleEvents = 'true';
  params.orderBy = 'startTime';
  return fetchJson(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    accessToken,
    params
  });
}

async function listConnections({ accessToken, pageSize = 50, pageToken, personFields = 'names,emailAddresses,phoneNumbers,organizations' }) {
  const limit = typeof pageSize === 'number' ? pageSize : 50;
  const params = {
    pageSize: String(limit),
    personFields
  };
  if (pageToken) params.pageToken = pageToken;
  return fetchJson('https://people.googleapis.com/v1/people/me/connections', {
    accessToken,
    params
  });
}

module.exports = {
  gmail: {
    listMessages,
    getMessage
  },
  calendar: {
    listEvents
  },
  people: {
    listConnections
  }
};
