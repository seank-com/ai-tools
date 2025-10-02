# Copilot/LLM Integration Instructions for ai-tools

## Key Design Points
- The MCP server is started in-process on a random port for each VS Code instance.
- The extension advertises the MCP server using the VS Code MCP provider API, so no manual mcp.json editing is required.
- The MCP server always resolves file paths relative to the current workspace root (using the AI_TOOLS_WORKSPACE env var).
- The extension supports dynamic workspace folder changes and will restart the MCP server as needed.
- The `reference/` folder contains a separate, read-only project; use it for guidance only and avoid modifying its contents.
- Do not hand edit `package.json` files directly; use `npm` commands for adding/removing dependencies.

## Tool Registration
- Tools are registered using the @modelcontextprotocol/sdk and zod for input validation.
- The tool requires a `path` parameter (string, relative to workspace root).
- Input schemas must be plain objects of zod schemas (not z.object(...)) for compatibility with the MCP SDK.

---

For extension maintainers: update this file with any changes to tool registration, server startup, or workspace handling.