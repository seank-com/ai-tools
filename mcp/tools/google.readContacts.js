const { z } = require('zod');
const googleApis = require('../googleApiClients');

function createReadContactsTool({ context, googleAuth }) {
  const definition = {
    title: 'Google: Read Contacts',
    description: 'List Google Contacts connections.',
    inputSchema: {
      pageSize: z.number().int().min(1).max(200).optional(),
      pageToken: z.string().min(1).optional(),
      personFields: z.string().min(1).optional()
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
    throw new Error('Failed to execute People API request');
  }

  async function handler(input) {
    const { pageSize, pageToken, personFields } = input || {};

    const response = await runWithAccessToken(async (accessToken) => {
      const list = await googleApis.people.listConnections({
        accessToken,
        pageSize,
        pageToken,
        personFields
      });

      const contacts = (list.connections || []).map((person) => ({
        resourceName: person.resourceName,
        etag: person.etag,
        names: person.names,
        emailAddresses: person.emailAddresses,
        phoneNumbers: person.phoneNumbers,
        organizations: person.organizations
      }));

      return {
        contacts,
        nextPageToken: list.nextPageToken
      };
    });

    const text = JSON.stringify(response, null, 2);
    return { content: [{ type: 'text', text }] };
  }

  return {
    name: 'google.read_contacts',
    definition,
    handler
  };
}

module.exports = createReadContactsTool;
