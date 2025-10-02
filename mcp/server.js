require("./dom-shim.js");

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const path = require("path");
const { extractPdfPage } = require("./pdf");

function createMcpServer() {
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
