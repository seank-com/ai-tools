# Agent Instructions for ai-tools

- Register MCP tools within `mcp/server.js` so all tools share a single registration path. If additional dependencies are needed from the extension host, extend `createMcpServer` options instead of registering tools elsewhere.
- Keep new functions small, with clear error handling and minimal side effects. Prefer plain JavaScript (no TypeScript) across this repository.
- When integrating authentication flows, reuse existing helpers where possible and avoid duplicating logic in the extension activation module.
