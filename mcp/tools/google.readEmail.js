const { z } = require('zod');
const googleApis = require('../googleApiClients');

const HEADER_KEYS = ['From', 'To', 'Subject', 'Date'];
const MAX_PREVIEW = 4000;

function decodeBody(data) {
  if (!data) return '';
  try {
    const buffer = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return buffer.toString('utf8');
  } catch (err) {
    console.warn('ai-tools: failed to decode gmail body', err);
    return '';
  }
}

function extractPlainText(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return decodeBody(payload.body.data);
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) {
        return text;
      }
    }
  }

  if (payload.body && payload.body.data) {
    const text = decodeBody(payload.body.data);
    if (payload.mimeType === 'text/html') {
      return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return text;
  }

  return '';
}

function pickHeaders(payload) {
  const headers = {};
  const payloadHeaders = payload && payload.headers ? payload.headers : [];
  for (const header of payloadHeaders) {
    if (HEADER_KEYS.includes(header.name) && header.value) {
      headers[header.name] = header.value;
    }
  }
  return headers;
}

function createReadEmailTool({ context, googleAuth }) {
  const definition = {
    title: 'Google: Read Gmail',
    description: 'Search Gmail messages and optionally include basic body previews.',
    inputSchema: {
      query: z.string().min(1).optional(),
      maxResults: z.number().int().min(1).max(50).optional(),
      includeBodies: z.boolean().optional(),
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
    throw new Error('Failed to execute Gmail request');
  }

  async function handler(input) {
    const { query, maxResults, includeBodies, pageToken } = input || {};

    const response = await runWithAccessToken(async (accessToken) => {
      const list = await googleApis.gmail.listMessages({
        accessToken,
        q: query,
        maxResults,
        pageToken
      });

      const messages = list.messages || [];
      if (messages.length === 0) {
        return { messages: [], nextPageToken: list.nextPageToken };
      }

      const detailed = await Promise.all(messages.map((msg) => {
        const format = includeBodies ? 'full' : 'metadata';
        return googleApis.gmail.getMessage({ accessToken, id: msg.id, format });
      }));

      const simplified = detailed.map((message) => {
        const base = {
          id: message.id,
          threadId: message.threadId
        };
        if (message.snippet) {
          base.snippet = message.snippet;
        }
        const headers = pickHeaders(message.payload || {});
        if (Object.keys(headers).length > 0) {
          base.headers = headers;
        }
        if (includeBodies) {
          const preview = extractPlainText(message.payload || '');
          if (preview) {
            base.bodyPreview = preview.slice(0, MAX_PREVIEW);
          }
        }
        return base;
      });

      return {
        messages: simplified,
        nextPageToken: list.nextPageToken
      };
    });

    const text = JSON.stringify(response, null, 2);
    return { content: [{ type: 'text', text }] };
  }

  return {
    name: 'google.read_email',
    definition,
    handler
  };
}

module.exports = createReadEmailTool;
