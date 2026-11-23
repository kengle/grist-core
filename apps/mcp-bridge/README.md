# grist-mcp-ts — MCP bridge for the Grist REST API (TypeScript)

Forwards the caller's `Authorization: Bearer <token>` to Grist; never validates, refreshes or stores tokens.
A thin `node:http` front serves `/.well-known/oauth-protected-resource` and answers `401` + `WWW-Authenticate` without a token; `/mcp*` is proxied to the library listener on 8766.

```bash
npm install --registry https://registry.npmmirror.com && npx tsc && node dist/server.js
```
Env: `GRIST_API_BASE`, `MCP_RESOURCE_URL`, `AUTH_SERVER`, `READ_ONLY` (default 1), `BRIDGE_PORT`, `BRIDGE_INTERNAL_PORT`. Tools: 7 read-only; `READ_ONLY=0` adds `add_records`, `update_records`, `delete_records`.
