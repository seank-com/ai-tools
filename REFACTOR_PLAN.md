# MCP Server Refactoring Plan

## 🚧 Current Progress: Step 2 Complete ✅ - Ready for Step 3

**Last updated:** November 3, 2025

### Completed Steps:
- ✅ **Step 1:** Extended `createMcpServer` options interface to accept `mcpEmitter` - TESTED & VERIFIED
- ✅ **Step 2:** Moved HTTP server creation into `createMcpServer` - COMPLETE, NOT YET TESTED

### Next Step:
- ⏭️ **Step 3:** Move `httpServer.listen()` into `createMcpServer` and start listening on random port

### Changes Made So Far:
1. Added `mcpEmitter` parameter to `createMcpServer` function signature
2. Added imports: `http` and `StreamableHTTPServerTransport`
3. Defined constants: `MCP_PATH`, `SUCCESS_HTML`, `ERROR_HTML`
4. Created `StreamableHTTPServerTransport` and connected it to MCP server
5. Created HTTP server with all three request handlers (health, OAuth, MCP)
6. Moved `googleAuth` require to shared variable for both tools and HTTP server

### Notes:
- Step 2 is complete but **NOT tested** - will need testing when resuming
- The HTTP server is created but **not yet listening** (that's Step 3)
- Function still returns just `server` (will change in Step 4)

---

## Overview
This plan addresses the refactoring of `extension.js` and `mcp/server.js` to properly separate concerns between the VS Code extension activation logic and the MCP server implementation. Currently, server-specific code (HTTP server setup, transport management, OAuth handling) is embedded in `extension.js`, making it harder to maintain and test.

## Goals
1. Move all server-specific logic into `mcp/server.js`
2. Keep extension-specific logic (VS Code API calls, extension lifecycle) in `extension.js`
3. Maintain clean interfaces between the two modules
4. Preserve existing functionality, including OAuth flow and dynamic workspace handling

## Current State Analysis

### Code in `extension.js` that needs to move:
- `mcpServerInstance` creation and `transport.connect()` call
- `StreamableHTTPServerTransport` instantiation
- HTTP server creation with request handlers:
  - `/mcp-health` endpoint
  - `/oauth/google` OAuth callback endpoint
  - `/mcp` POST endpoint for MCP protocol
- `httpServer.listen()` and dynamic port assignment
- `googleAuth.setLoopbackPort()` call
- `_mcpEmitter.fire()` notification

### Dependencies to pass:
- `context` (already passed)
- `_mcpEmitter` (needs to be passed)

### Return values needed in `extension.js`:
- `httpServer` (to close on restart)
- `serverUri` (for `provideMcpServerDefinitions`)

### What stays in `server.js`:
- `successHtml` and `errorHtml` - only used in OAuth handler, no need to expose
- `mcpPath` constant - only used internally for routing, no need to parameterize

---

## Refactoring Steps

### Step 1: Extend `createMcpServer` options interface ✅ COMPLETE
**Goal:** Prepare `createMcpServer` to accept all necessary dependencies.

**Changes to `mcp/server.js`:**
- ✅ Extended the `options` parameter to accept:
  - `mcpEmitter` - the VS Code EventEmitter to notify on port ready when server is listening
- ✅ Added JSDoc comments for the function

**Note:** `successHtml`, `errorHtml`, and `mcpPath` will be defined as constants within `server.js` since they're only used internally.

**Testing:** ✅ VERIFIED - Extension activates correctly, MCP server registers, `read_pdf` tool works.

---

### Step 2: Move HTTP server creation into `createMcpServer` ✅ COMPLETE (NOT TESTED)
**Goal:** Relocate the `http.createServer` call and all request handlers.

**Changes to `mcp/server.js`:**
- ✅ Added `const http = require('http');` at top
- ✅ Added `const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');`
- ✅ Defined constants at module level:
  ```javascript
  const MCP_PATH = '/mcp';
  const SUCCESS_HTML = '<html><body><h1>Success</h1><p>You may close this window and return to VS Code.</p></body></html>';
  const ERROR_HTML = '<html><body><h1>Error</h1><p>You may close this window and return to VS Code.</p></body></html>';
  ```
- ✅ Inside `createMcpServer`, after tool registration:
  - Created `StreamableHTTPServerTransport` instance
  - Called `server.connect(transport)`
  - Created `httpServer` with request handlers for:
    - `/mcp-health`
    - `/oauth/google` (using `googleAuth.handleOAuthRedirect`, `SUCCESS_HTML`, `ERROR_HTML`)
    - MCP POST endpoint at `MCP_PATH` (using `transport.handleRequest`)
- ✅ Moved `googleAuth` require to shared variable (used by both tools and HTTP server)

**Local variables in `createMcpServer` function:**
- `transport` (created)
- `dynamicPort` (initialized to 0, will be set in listen callback in Step 3)
- `httpServer` (created, not yet listening)

**Testing:** ⚠️ NOT YET TESTED - needs testing before proceeding to Step 3.

---

### Step 3: Move `httpServer.listen()` into `createMcpServer` ⏭️ NEXT STEP
**Goal:** Start the HTTP server and handle port assignment within the server module.

**⚠️ IMPORTANT:** Test Step 2 changes first before proceeding with Step 3!

**Changes to `mcp/server.js`:**
- After creating `httpServer`, call `httpServer.listen(0, '127.0.0.1', callback)`
- In the listen callback:
  - Capture `dynamicPort = httpServer.address().port`
  - Construct `serverUri = http://localhost:${dynamicPort}${MCP_PATH}` (note: using `MCP_PATH` constant)
  - Call `googleAuth.setLoopbackPort(dynamicPort)`
  - Call `options.mcpEmitter.fire()` to notify extension that server is ready
  - Log success message with port and URI

**Testing:** Extension should activate and MCP server should listen on random port.

---

### Step 4: Return server artifacts from `createMcpServer`
**Goal:** Provide `extension.js` with references it needs for lifecycle management.

**Changes to `mcp/server.js`:**
- Create a state object to hold async values:
  ```javascript
  const state = { serverUri: '' };
  // ... in listen callback: state.serverUri = `http://localhost:${dynamicPort}${MCP_PATH}`;
  ```
- Return object with only what `extension.js` needs:
  ```javascript
  return {
    httpServer: httpServer,
    getServerUri: () => state.serverUri
  };
  ```
- **Note:** We no longer return `mcpServer` since it's only used internally within `server.js`

**Changes to `extension.js`:**
- Capture returned object from `createMcpServer()`
- Use `getServerUri()` in `provideMcpServerDefinitions`
- Use `httpServer` reference for cleanup in `startMcpServerWithWorkspace`

**Testing:** Verify `serverUri` is available when provider is called.

---

### Step 5: Update `extension.js` to use new interface
**Goal:** Simplify `startMcpServerWithWorkspace` by delegating to `createMcpServer`.

**Changes to `extension.js`:**
- Remove local variables that are no longer needed:
  - `mcpServerInstance` (now handled internally in server.js)
  - `transport` (now handled internally in server.js)
  - `dynamicPort` (now handled internally in server.js)
  - `PATH` (now defined as `MCP_PATH` in server.js)
  - `successHtml` and `errorHtml` (now defined in server.js)
- Remove imports:
  - `const http = require('http');` (no longer used in extension.js)
  - `const { StreamableHTTPServerTransport } = require(...)` (no longer used in extension.js)
- Keep at outer scope of `activate`:
  - `let httpServer` (for cleanup)
  - `let getServerUri` (for provider)
- In `startMcpServerWithWorkspace`:
  - Keep workspace environment setup (lines before `//STARTING HERE`)
  - Keep httpServer cleanup (lines before `//STARTING HERE`)
  - Replace entire `//STARTING HERE` to `//ENDING HERE` section with:
    ```javascript
    const serverState = createMcpServer({
      context,
      mcpEmitter: _mcpEmitter
    });
    httpServer = serverState.httpServer;
    getServerUri = serverState.getServerUri;
    ```
- Update `provideMcpServerDefinitions` to use `getServerUri()` instead of `serverUri`:
  ```javascript
  const uri = getServerUri();
  if (!uri) {
    console.warn('ai-tools: provideMcpServerDefinitions called before serverUri is ready');
    return [];
  }
  const httpUri = vscode.Uri.parse(uri);
  ```

**Testing:** Full end-to-end test: activate extension, verify MCP provider works, test OAuth flow.

---

### Step 6: Handle standalone mode in `server.js`
**Goal:** Determine if standalone stdio mode is needed, and simplify if not.

**Analysis:**
- The `if (require.main === module)` block was originally for running the MCP server in stdio mode
- This was attempted before settling on HTTP transport
- It's not used in unit tests, CI/CD, or production
- **Decision:** Remove the standalone stdio mode entirely to simplify the code

**Changes to `mcp/server.js`:**
- **Remove** the `if (require.main === module)` block completely
- Simplify `createMcpServer` logic:
  - Always create HTTP server when `mcpEmitter` is provided
  - If `mcpEmitter` is not provided, throw an error (required parameter)

**Testing:** Verify extension still works. Skip testing standalone mode if removed.

---

### Step 7: Clean up and add error handling
**Goal:** Improve robustness and maintainability.

**Changes to `mcp/server.js`:**
- Add parameter validation (e.g., check for required options in HTTP mode)
- Wrap `httpServer.listen` in try-catch
- Add graceful shutdown helper if needed
- Add JSDoc comments for the new options interface

**Changes to `extension.js`:**
- Add error handling around `createMcpServer` call
- Log errors clearly if server startup fails

**Testing:** Test error scenarios (e.g., port already in use, invalid options).

---

### Step 8: Update and consolidate documentation
**Goal:** Ensure future maintainers understand the architecture and reduce documentation fragmentation.

**Changes:**

**1. Consolidate `.github/copilot-instructions.md` into `AGENTS.md`:**
- Merge the content from `copilot-instructions.md` into `AGENTS.md`
- Add all key design points about MCP server architecture
- Ensure guidance applies to all AI assistants (GitHub Copilot, Codex, Claude, etc.)
- Delete `.github/copilot-instructions.md` after merging
- This creates a single source of truth for AI-assisted development

**2. Consolidate `vsc-extension-quickstart.md` into `README.md`:**
- Extract useful development information from `vsc-extension-quickstart.md`
- Add a "Development" section to `README.md` covering:
  - How to run/debug the extension (F5)
  - How to run tests
  - Project structure overview
  - Link to VS Code Extension API docs if needed
- Delete `vsc-extension-quickstart.md` after merging
- Keep `README.md` as the entry point for all users and developers

**3. Update `AGENTS.md` with refactoring notes:**
- Document the new `createMcpServer` architecture
- Explain the HTTP server lifecycle (started in server.js, managed by extension.js)
- Note the interface contract between extension.js and server.js
- Update tool registration guidance to reflect current state

**4. Add code documentation:**
- Add JSDoc to `createMcpServer` function describing:
  - `@param {Object} options - Configuration object`
  - `@param {Object} options.context - VS Code extension context`
  - `@param {EventEmitter} options.mcpEmitter - Emitter to notify when server is ready`
  - `@returns {{httpServer: http.Server, getServerUri: Function}}`
- Add comments in `extension.js` explaining the server lifecycle:
  - When server starts (activation + workspace change)
  - How cleanup works (close httpServer on restart)
  - Why we use a getter for serverUri (async port assignment)

**5. Update `README.md` features:**
- Ensure features list is accurate after refactoring
- Update any references to internal architecture if mentioned

---

## Testing Strategy

After each step, verify:
1. ✅ Extension activates without errors
2. ✅ MCP server registers and is visible to Copilot
3. ✅ `read_pdf` tool works correctly
4. ✅ Google OAuth flow works (sign-in command)
5. ✅ Google tools (email, calendar, contacts) work after authentication
6. ✅ Workspace folder changes trigger server restart
7. ✅ Standalone `node mcp/server.js` still works (stdio mode)

---

## Risk Assessment

### Low Risk:
- Steps 1-3: Mostly additive changes
- Step 8: Documentation only

### Medium Risk:
- Step 4-5: Changes to return value and call sites
- Step 6: Backward compatibility with stdio mode

### High Risk:
- None, if steps are followed incrementally with testing

---

## Rollback Strategy

Each step should be committed separately so we can:
1. Bisect to find issues
2. Revert individual steps if needed
3. Review changes in isolation

---

## Summary

This refactoring will:
- ✅ Move ~90 lines of server code from `extension.js` to `mcp/server.js`
- ✅ Reduce `extension.js` complexity and focus it on VS Code integration
- ✅ Make `server.js` more self-contained and testable
- ✅ Maintain all existing functionality
- ✅ Simplify the interface between modules (only `context` and `mcpEmitter` passed in)
- ✅ Eliminate unused stdio mode code
- ✅ Consolidate documentation into two primary files (`README.md` and `AGENTS.md`)
- ✅ Improve maintainability for future development

**Estimated effort:** 2-3 hours for refactoring + 1 hour for documentation
**Priority:** Medium (technical debt reduction, aids future development)
