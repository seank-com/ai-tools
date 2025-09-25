const vscode = require('vscode');
const path = require("path");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // --- MCP server/transport/httpServer state ---
  let httpServer, mcpServerInstance, transport;
  let dynamicPort = 0;
  let serverUri = '';
  const PATH = '/mcp';
  const _mcpEmitter = new vscode.EventEmitter();
  const http = require('http');
  const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const createMcpServer = require(path.join(context.extensionPath, 'mcp', 'server.js'));

  function startMcpServerWithWorkspace() {
    // Set workspace root for MCP server file resolution
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) {
      process.env.AI_TOOLS_WORKSPACE = ws.uri.fsPath;
      console.log('ai-tools: set AI_TOOLS_WORKSPACE to', ws.uri.fsPath);
    }
    if (httpServer) {
      try { httpServer.close(); } catch (e) {}
      httpServer = undefined;
    }
    mcpServerInstance = createMcpServer();
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    mcpServerInstance.connect(transport).then(() => {
      console.log('ai-tools: MCP server connected at activation');
    }).catch((err) => {
      console.error('ai-tools: MCP server failed to connect at activation', err);
    });

    httpServer = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/mcp-health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (req.method !== 'POST' || req.url !== PATH) {
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

          // Use the pre-created MCP server instance and transport
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

    // Listen on a random port (0) and update serverUri after binding
    httpServer.listen(0, '127.0.0.1', () => {
      dynamicPort = httpServer.address().port;
      serverUri = `http://localhost:${dynamicPort}${PATH}`;
      console.log('ai-tools: in-process HTTP MCP endpoint listening at', serverUri);
      _mcpEmitter.fire(); // Notify provider to refresh with new port
    });
  }

  // Start initially
  startMcpServerWithWorkspace();

  const _mcpProvider = {
    onDidChangeMcpServerDefinitions: _mcpEmitter.event,
    provideMcpServerDefinitions: async () => {
      const ws = vscode.workspace.workspaceFolders?.[0];
      const cwd = ws ? ws.uri.fsPath : context.extensionUri.fsPath;
      console.log('ai-tools: provideMcpServerDefinitions called. workspace=', cwd);
      // Wait for serverUri to be set (after httpServer.listen)
      if (!serverUri) {
        console.warn('ai-tools: provideMcpServerDefinitions called before serverUri is ready');
        return [];
      }
      const httpUri = vscode.Uri.parse(serverUri);
      const serverDef = new vscode.McpHttpServerDefinition('AI Tools', httpUri, {}, '0.0.1');
      console.log('ai-tools: provideMcpServerDefinitions returning:', serverDef);
      return [serverDef];
    },
    resolveMcpServerDefinition: async (server) => {
      console.log('ai-tools: resolveMcpServerDefinition called');
      return server;
    }
  };

  const mcpServer = vscode.lm.registerMcpServerDefinitionProvider("ai-tools.provider", _mcpProvider);
  context.subscriptions.push(mcpServer);

  // On workspace folder change, restart MCP server and fire event
  const _wsListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    console.log('ai-tools: workspace folders changed, restarting MCP server');
    startMcpServerWithWorkspace();
    _mcpEmitter.fire();
  });
  context.subscriptions.push(_wsListener);

  const helloCommand = vscode.commands.registerCommand('ai-tools.helloWorld', function () {
    vscode.window.showInformationMessage('Hello World from ai-tools!');
  });
  context.subscriptions.push(helloCommand);

  // Add a small developer-only command to force the editor to refresh MCP providers
  const refreshMcpCommand = vscode.commands.registerCommand('ai-tools.refreshMcpServers', function () {
    console.log('ai-tools: manual refresh requested');
    try {
      _mcpEmitter.fire();
      vscode.window.showInformationMessage('ai-tools: MCP servers refresh requested');
    } catch (e) {
      console.error('ai-tools: failed to fire mcp emitter', e);
    }
  });
  context.subscriptions.push(refreshMcpCommand);

  console.log('Congratulations, your extension "ai-tools" is now active!');
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
}
