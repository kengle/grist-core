# grist-mcp — MCP bridge for the Grist REST API

Forwards the caller's `Authorization: Bearer <token>` to Grist; never validates, refreshes or stores tokens. Grist decides what that user may do.
`/.well-known/oauth-protected-resource` and the `401` + `WWW-Authenticate` answer come from a thin `node:http` front; `/mcp*` is proxied to the library listener.

```bash
npm ci --registry https://registry.npmmirror.com && npm run build && node dist/server.js
```
Env: `GRIST_API_BASE` (default `http://127.0.0.1:8484/api`), `MCP_RESOURCE_URL`, `AUTH_SERVER`, `BRIDGE_PORT`, `BRIDGE_INTERNAL_PORT`. 19 tools; see `src/server.ts`.
