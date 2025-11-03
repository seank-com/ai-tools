require("./dom-shim.js");

const http = require('http');
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require("zod");
const path = require("path");
const { extractPdfPage } = require("./pdf");
const createReadEmailTool = require("./tools/google.readEmail.js");
const createReadCalendarEventsTool = require("./tools/google.readCalendarEvents.js");
const createReadContactsTool = require("./tools/google.readContacts.js");

// Constants for HTTP server
const MCP_PATH = '/mcp';
const SUCCESS_HTML = '<html><body><h1>Success</h1><p>You may close this window and return to VS Code.</p></body></html>';
const ERROR_HTML = '<html><body><h1>Error</h1><p>You may close this window and return to VS Code.</p></body></html>';

/**
 * Creates and configures the MCP server with HTTP transport.
 * @param {Object} options - Configuration object
 * @param {Object} options.context - VS Code extension context (required for Google tools)
 * @param {Object} [options.mcpEmitter] - VS Code EventEmitter to notify when server is ready
 * @returns {Object} Server instance (will be enhanced in later steps)
 */
  function createMcpServer(options = {}) {
  const { context, mcpEmitter } = options;
  // If the extension provided a workspace path via environment, switch to it
  // so file resolution and any relative operations use the intended
  // workspace root.
  if (process.env.AI_TOOLS_WORKSPACE) {
    try {
      process.chdir(process.env.AI_TOOLS_WORKSPACE);
      console.log('ai-tools: cwd set to', process.cwd());
    } catch (err) {
      console.warn('ai-tools: failed to chdir to workspace', err);
    }
  }

  function resolveSafe(rel) {
    const cwd = process.cwd();
    const abs = path.resolve(cwd, rel);
    if (!abs.startsWith(path.resolve(cwd) + path.sep) && abs !== path.resolve(cwd)) {
      throw new Error("Path escapes workspace root");
    }
    return abs;
  }

  const server = new McpServer({
    name: "ai-tools",
    version: "0.0.1"
  });

  console.log('ai-tools: createMcpServer invoked, creating server', { name: 'ai-tools', version: '0.0.1' });
  server.registerTool(
    "read_pdf",
    {
      title: "Read PDF",
      description: "Extract text content from a PDF file within the workspace",
      inputSchema: {
        path: z.string().min(1).describe("Path relative to workspace root"),
        page: z.number().int().min(1).optional().describe("Page number (1-based) to extract")
      }
    },
    async ({ path: rel, page }) => {
      console.log('ai-tools: read_pdf handler input:', { path: rel, page });

      try {
        const abs = resolveSafe(rel);
        console.log('ai-tools: resolved path ->', abs);
        const result = await extractPdfPage(abs, page ?? 1);
        const payload = {
          ...result,
          hasMore: result.page < result.pageCount
        };
        const text = JSON.stringify(payload, null, 2);
        console.log('ai-tools: read_pdf succeeded', {
          page: result.page,
          pageCount: result.pageCount,
          textLength: result.text.length
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        console.error('ai-tools: read_pdf error for path', rel, err);
        throw err;
      }
    }
  );

  console.log('ai-tools: registered tool read_pdf');

  // Load googleAuth for use in both tool registration and HTTP server
  const googleAuth = context ? require("./googleAuth.js") : null;

  if (context) {
    try {
      const deps = { context, googleAuth };
      const emailTool = createReadEmailTool(deps);
      server.registerTool(emailTool.name, emailTool.definition, emailTool.handler);
      const calendarTool = createReadCalendarEventsTool(deps);
      server.registerTool(calendarTool.name, calendarTool.definition, calendarTool.handler);
      const contactsTool = createReadContactsTool(deps);
      server.registerTool(contactsTool.name, contactsTool.definition, contactsTool.handler);
      console.log('ai-tools: registered Google tools');
    } catch (err) {
      console.error('ai-tools: failed to register Google tools', err);
    }
  } else {
    console.log('ai-tools: extension context missing, skipping Google tool registration');
  }

  // Create HTTP transport and connect MCP server
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  server.connect(transport).then(() => {
    console.log('ai-tools: MCP server connected to HTTP transport');
  }).catch((err) => {
    console.error('ai-tools: MCP server failed to connect to HTTP transport', err);
  });

  // Variables to be set when server starts listening
  let dynamicPort = 0;

  // Create HTTP server with request handlers
  const httpServer = http.createServer(async (req, res) => {
    // Health check endpoint
    if (req.method === 'GET' && req.url === '/mcp-health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Google OAuth callback endpoint
    if (req.method === 'GET' && req.url && req.url.startsWith('/oauth/google')) {
      try {
        const base = `http://127.0.0.1:${dynamicPort || 0}`;
        const url = new URL(req.url, base);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');
        const handled = googleAuth ? googleAuth.handleOAuthRedirect({ code, error, errorDescription }) : false;
        if (!handled) {
          console.warn('ai-tools: received unexpected google oauth callback');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(error ? ERROR_HTML : SUCCESS_HTML);
      } catch (err) {
        console.error('ai-tools: failed to process oauth callback', err);
        try {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(ERROR_HTML);
        } catch (sendErr) {
          console.error('ai-tools: failed to respond to oauth callback', sendErr);
        }
      }
      return;
    }

    // MCP protocol endpoint
    if (req.method !== 'POST' || req.url !== MCP_PATH) {
      res.writeHead(404);
      res.end();
      return;
    }

    console.log('ai-tools: incoming MCP POST', req.url);
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', async () => {
      console.log('ai-tools: MCP POST raw body:', body);
      try {
        let parsed;
        try {
          parsed = JSON.parse(body);
          console.log('ai-tools: MCP POST parsed JSON:', parsed);
        } catch (parseErr) {
          console.warn('ai-tools: failed to parse request body as JSON, forwarding raw body', parseErr);
          parsed = body;
        }

        // Use the transport to handle the MCP request
        await transport.handleRequest(req, res, parsed);
        console.log('ai-tools: transport.handleRequest completed');
      } catch (err) {
        console.error('ai-tools: http transport error', err, 'body:', body);
        try {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
        } catch (e) {
          console.error('ai-tools: failed to send error response', e);
        }
      }
    });
  });

  return server;
}

// If run directly, create a server and connect to stdio so this script still
// works as a standalone MCP server.
if (require.main === module) {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch(err => {
    console.error("ai-tools MCP server failed:", err);
  });
}

module.exports = createMcpServer;
