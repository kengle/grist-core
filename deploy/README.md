# deploy/ — Grist with Caddy, Authelia (LLDAP backed), and the built-in MCP bridge

One image runs two processes: the Grist server and `apps/mcp-bridge` on `127.0.0.1:8765`.
Caddy is the only public entry; Authelia does single sign-on with forward auth against LLDAP;
`/mcp*` goes straight to the bridge, which forwards only `Authorization` and leaves permissions to Grist.

Prerequisites: Docker + Compose, a host name that resolves to this machine (a DNS A record, or
Caddy's self-signed CA you trust), and free ports 8080/443 or whichever `PUBLIC_PORT` you pick.

```sh
GRIST_DOMAIN=grist.example.com PUBLIC_PORT=8080 ./deploy.sh
```

`deploy.sh` runs `init.sh` (secrets and configuration, never overwriting), starts LLDAP, creates the
bind account with `bootstrap.sh`, then starts everything else. With a prebuilt image, set
`GRIST_IMAGE=your/image:tag` to skip the local build; otherwise the image is built from the repository root.

First run also needs Grist's own boot step: `docker compose logs grist | grep -A2 "BOOT KEY"`, then
open `/boot`, paste that key, and set the admin email. Grist refuses every API call until this is done.

First login: open `http://127.0.0.1:17170` with `admin` (password `LLDAP_LDAP_USER_PASS` in `lldap.env`),
create your own account and the bind account `svc-authelia` (password `SVC_AUTHELIA_PASSWORD`), put
`svc-authelia` in `lldap_strict_readonly` and yourself in `lldap_admin`. Authelia binds as `svc-authelia`,
so it can read users and groups but change nothing.

Back up `./data` (every document) and `./lldap` (every directory entry). Keep `.env`, `grist.env`,
`lldap.env`, `authelia/configuration.yml` and `authelia/oidc_signing_key.pem` out of git.

Upgrading: `git fetch origin && git checkout umain && git merge --ff-only origin/main && git checkout main
&& git merge umain`, then `docker compose up -d --build`; `deploy/` holds configuration only.

Traps we hit — keep them in mind:
- The Authelia lifespan key is `authorize_code`, not `authorization_code`; the wrong one stops startup.
- The `grist-mcp` client secret must be hex: base64 may contain `+`, which breaks the Basic auth header.
- In the container the JWKS must be `http://authelia:9091/authelia/jwks.json`: the Grist container does not
  trust Caddy's self-signed CA; the issuer stays the public `https://…` URL.
- Changing a user's email means updating `logins.email` in `home.sqlite3`, not `aliases` (that table is for
  document URLs). Any other email is a new user with no access.

Details: `DEPLOYMENT.md` (what runs here, step by step) and `LAN-DEPLOY.md` (two ways to reach a LAN).
