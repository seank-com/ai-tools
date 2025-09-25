// mcp/server.js
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const fs = require("fs").promises;
const path = require("path");

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
    "read_file",
    {
      title: "Read file",
      description: "Read a UTF-8 file from the current workspace",
      inputSchema: {
        path: z.string().min(1).describe("Path relative to workspace root")
      }
    },
    async ({ path: rel }) => {
      console.log('ai-tools: read_file handler input:', path);

      try {
        const abs = resolveSafe(rel);
        console.log('ai-tools: resolved path ->', abs);
        const text = await fs.readFile(abs, "utf8");
        console.log('ai-tools: read_file succeeded, length=', text.length);
        return { content: [{ type: "text", text }] };
      } catch (err) {
        console.error('ai-tools: read_file error for path', rel, err);
        throw err;
      }
    }
  );

  console.log('ai-tools: registered tool read_file');

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
