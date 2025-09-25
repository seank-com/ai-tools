# Copilot/LLM Integration Instructions for ai-tools

## Key Design Points
- The MCP server is started in-process on a random port for each VS Code instance.
- The extension advertises the MCP server using the VS Code MCP provider API, so no manual mcp.json editing is required.
- The MCP server always resolves file paths relative to the current workspace root (using the AI_TOOLS_WORKSPACE env var).
- The extension supports dynamic workspace folder changes and will restart the MCP server as needed.

## Tool Registration
- Tools are registered using the @modelcontextprotocol/sdk and zod for input validation.
- The `read_file` tool requires a `path` parameter (string, relative to workspace root).
- Input schemas must be plain objects of zod schemas (not z.object(...)) for compatibility with the MCP SDK.

## Best Practices for LLMs
- Always provide the `path` argument when calling `read_file`.
- Use relative paths from the workspace root (e.g., `.gitignore`, `src/index.js`).
- If the workspace changes, the server will update automatically.
- Do not hardcode the MCP server port; always use the advertised server definition.

## Troubleshooting
- If the tool call fails with a missing path, check that the LLM is passing the correct argument.
- If file resolution fails, ensure the workspace root is set and the file exists.
- If running multiple VS Code windows, each will have its own MCP server on a different port.

---

For extension maintainers: update this file with any changes to tool registration, server startup, or workspace handling.