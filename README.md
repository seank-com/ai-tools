# ai-tools

A VS Code extension that exposes workspace-aware tools to GitHub Copilot and other LLMs using the Model Context Protocol (MCP).

## Features
- In-process MCP server started on a random port for each VS Code instance
- Automatic registration with VS Code/Copilot (no manual mcp.json editing required)
- Tools can access and operate on files in the current workspace
- Dynamic workspace folder support (server restarts on workspace change)
- Example tool: `read_file` (reads a UTF-8 file from the workspace)

## Usage
1. Install the extension and reload VS Code.
2. Open a workspace folder.
3. In Copilot Chat (Agent mode), select the "AI Tools" MCP server and enable the `read_file` tool.
4. Use prompts like:
   - "Read the contents of .gitignore using the read_file tool."
   - "Show me the first 10 lines of src/index.js."

## LLM/Copilot Integration
- The extension advertises the MCP server and tools automatically.
- LLMs must provide the `path` argument for `read_file` (relative to workspace root).
- The extension supports multiple VS Code windows (each with its own MCP server).

## Requirements
- VS Code 1.104.0 or later
- GitHub Copilot (for tool usage in chat)

## Known Issues
- LLMs may sometimes call tools with missing arguments; always specify the required parameters in prompts.
- File access is limited to the current workspace root.

## Release Notes
- See CHANGELOG.md for details.

---

For LLM and extension maintainers: see `copilot-instructions.md` for integration details and best practices.
