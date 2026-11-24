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

`deploy.sh` also finishes Grist's first-run setup: `init.sh` fixes a `GRIST_BOOT_KEY` and an
`GRIST_ADMIN_EMAIL` (`ADMIN_EMAIL`, default `admin@example.com`), and `deploy.sh` posts them to
`/boot/login`. Caddy lets `/boot*` through without forward auth, the boot key being the gate.

Accounts: LLDAP's own `admin` user is the directory administrator, not a Grist user - do not reuse the
name for a person. `bootstrap.sh` creates `grist-admin` with the email you passed as `ADMIN_EMAIL`; its
password is `FIRST_USER_PASSWORD` in `lldap.env`. Grist's install-admin gate compares the request user's
login email with `GRIST_ADMIN_EMAIL` (`InstallAdmin.ts:72-75`), so the first person to sign in must use
exactly that email.

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
- Grist's first-run gate blocks `/auth/login`, so with forward auth nobody can ever get in
  (`FlexServer.ts:766-787`; `InstallAdmin.ts:33-36`). `init.sh` sets `GRIST_IN_SERVICE=true`, which skips
  that gate; the first browser visit must then be `/auth/login?next=/` once, so Grist binds the
  forward-auth identity. Visiting `/` first shows you as a guest.

Details: `DEPLOYMENT.md` (what runs here, step by step) and `LAN-DEPLOY.md` (two ways to reach a LAN).
