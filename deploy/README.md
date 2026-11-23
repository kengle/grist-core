# deploy/ — Grist with Caddy, Authelia, and the built-in MCP bridge
One image runs two processes: the Grist server, and `apps/mcp-bridge` on `127.0.0.1:8765`.
Caddy is the only public entry; Authelia does single sign-on with forward auth; `/mcp*` goes straight
to the bridge, which forwards only `Authorization` and leaves permissions to Grist.

Prerequisites: Docker + Compose, a host name (DNS A record, or Caddy's self-signed CA), ports 8080/443.

1. `cp grist.env.example grist.env` and `cp authelia/users_database.example.yml authelia/users_database.yml`
2. Fill the secrets: `grist.env`, `authelia/users_database.yml`, and every `<REPLACE_WITH_...>` in
   `authelia/configuration.yml` (session, storage key, OIDC HMAC, JWKS key, client secret).
3. `docker compose up -d --build`

Data lives in the bind mount `../data` (documents `data/docs`, home DB `data/home.sqlite3`).
Upgrade: `git fetch origin && git checkout umain && git merge --ff-only origin/main && git checkout main
&& git merge umain`, then rebuild; `deploy/` holds configuration only.
Traps we hit — keep them in mind:
- The Authelia lifespan key is `authorize_code`, not `authorization_code`; the wrong one stops startup.
- The `grist-mcp` client secret must be hex: base64 may contain `+`, which breaks the Basic auth header.
- In the container the JWKS must be `http://authelia:9091/authelia/jwks.json`: the Grist container does not
  trust Caddy's self-signed CA.
