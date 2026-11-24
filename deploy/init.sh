#!/bin/sh
# Generate the secrets and configuration this deployment needs. Safe to re-run:
# anything that already exists is left alone.
set -eu

cd "$(dirname "$0")"

GRIST_DOMAIN=${GRIST_DOMAIN:-grist.example.com}
PUBLIC_PORT=${PUBLIC_PORT:-8080}
LDAP_PORT=${LDAP_PORT:-3890}
LLDAP_WEB_PORT=${LLDAP_WEB_PORT:-17170}
BASE_DN=${BASE_DN:-dc=example,dc=com}
GRIST_IMAGE=${GRIST_IMAGE:-grist-merged:local}
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@example.com}
BOOT_KEY=${BOOT_KEY:-$(openssl rand -hex 12)}

say() { printf '%s\n' "$*"; }
hex() { openssl rand -hex "$1"; }
b64() { openssl rand -base64 "$1" | tr -d '\n'; }

# Create a file with 600 permissions only when it is missing.
write_new() {
    file=$1
    if [ -f "$file" ]; then
        say "exists, skipped: $file"
        return 0
    fi
    ( umask 077; cat > "$file" )
    chmod 600 "$file"
    say "created: $file"
}

mkdir -p data lldap authelia
chmod 700 authelia 2>/dev/null || true

# Compose-level settings.
write_new .env <<EOF
GRIST_DOMAIN=$GRIST_DOMAIN
PUBLIC_PORT=$PUBLIC_PORT
LDAP_PORT=$LDAP_PORT
LLDAP_WEB_PORT=$LLDAP_WEB_PORT
GRIST_IMAGE=$GRIST_IMAGE
EOF

# LLDAP: session signing key and the admin password.
LLDAP_JWT=$(hex 32)
LLDAP_ADMIN=$(b64 24)
SVC_PASSWORD=$(b64 24)
write_new lldap.env <<EOF
LLDAP_JWT_SECRET=$LLDAP_JWT
LLDAP_LDAP_BASE_DN=$BASE_DN
LLDAP_LDAP_USER_PASS=$LLDAP_ADMIN
SVC_AUTHELIA_PASSWORD=$SVC_PASSWORD
AUTHELIA_AUTHENTICATION_BACKEND_LDAP_PASSWORD=$SVC_PASSWORD
EOF

# Grist: session secret and the OIDC wiring. The audience is the public origin,
# which is what the browser's "resource" parameter asks for.
GRIST_SESSION=$(hex 32)
write_new grist.env <<EOF
GRIST_SESSION_SECRET=$GRIST_SESSION
GRIST_DEFAULT_EMAIL=$ADMIN_EMAIL
GRIST_ADMIN_EMAIL=$ADMIN_EMAIL
GRIST_BOOT_KEY=$BOOT_KEY
GRIST_SANDBOX_FLAVOR=unsandboxed
GRIST_ORG_IN_PATH=true
GRIST_SERVE_SAME_ORIGIN=true
GRIST_HOST=0.0.0.0
# Skips Grist's first-run setup gate (FlexServer.ts:755). Caddy and Authelia stand in
# front, and the boot key below still guards /boot, so a half-configured instance is
# not exposed; without this the gate blocks /auth/login and forward auth never starts.
GRIST_IN_SERVICE=true
GRIST_DATA_DIR=/persist/docs
GRIST_INST_DIR=/persist
GRIST_SESSION_COOKIE=grist_core
GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING=true
GRIST_EXT_FULL_EDITION_BASE_URL=https://grist-static.com/grist-full-edition
GVISOR_FLAGS=-unprivileged -ignore-cgroups
NODE_OPTIONS=--no-deprecation --disable-proto=delete
NODE_ENV=production
TYPEORM_DATABASE=/persist/home.sqlite3
TZ=UTC
APP_HOME_URL=https://$GRIST_DOMAIN:$PUBLIC_PORT/
APP_HOME_INTERNAL_URL=http://127.0.0.1:8484/
GRIST_FORWARD_AUTH_HEADER=Remote-Email
GRIST_FORWARD_AUTH_LOGOUT_PATH=/authelia/logout
GRIST_TEMPLATE_ORG=
GRIST_OIDC_JWKS_URL=http://authelia:9091/authelia/jwks.json
GRIST_OIDC_ISSUER=https://$GRIST_DOMAIN:$PUBLIC_PORT/authelia
GRIST_OIDC_AUDIENCE=https://$GRIST_DOMAIN:$PUBLIC_PORT
GRIST_OIDC_EMAIL_CLAIM=email
GRIST_API_BASE=http://127.0.0.1:8484/api
MCP_RESOURCE_URL=https://$GRIST_DOMAIN:$PUBLIC_PORT
EOF

# Authelia: render configuration.yml from the template, filling in fresh secrets.
if [ -f authelia/configuration.yml ]; then
    say "exists, skipped: authelia/configuration.yml"
else
    # A database from an older configuration cannot be read with a freshly generated
    # encryption key; move it aside instead of letting Authelia fail at startup.
    if [ -f authelia/db.sqlite3 ]; then
        mv authelia/db.sqlite3 "authelia/db.sqlite3.old-$(date +%Y%m%d-%H%M%S)"
        say "moved stale authelia/db.sqlite3 aside (its storage key no longer matches)"
    fi
    JWT_SECRET=$(hex 32)
    SESSION_SECRET=$(hex 32)
    STORAGE_KEY=$(hex 24)
    OIDC_HMAC=$(hex 32)
    CLIENT_SECRET=$(hex 32)
    openssl genrsa -out authelia/oidc_signing_key.pem 2048 2>/dev/null
    chmod 600 authelia/oidc_signing_key.pem
    sed \
        -e "s|__BASE_DN__|$BASE_DN|g" \
        -e "s|__GRIST_HOST__|$GRIST_DOMAIN|g" \
        -e "s|__GRIST_PORT__|$PUBLIC_PORT|g" \
        -e "s|__JWT_SECRET__|$JWT_SECRET|g" \
        -e "s|__SESSION_SECRET__|$SESSION_SECRET|g" \
        -e "s|__STORAGE_KEY__|$STORAGE_KEY|g" \
        -e "s|__OIDC_HMAC_SECRET__|$OIDC_HMAC|g" \
        -e "s|__OIDC_CLIENT_SECRET__|$CLIENT_SECRET|g" \
        authelia/configuration.yml.tpl > authelia/configuration.yml.tmp
    # The JWKS private key is multi-line: splice it in with awk, then drop the token line.
    awk -v keyfile=authelia/oidc_signing_key.pem '
        /^__OIDC_JWKS_KEY_PEM__$/ {
            while ((getline line < keyfile) > 0) { printf "          %s\n", line }
            next
        }
        { print }
    ' authelia/configuration.yml.tmp > authelia/configuration.yml
    rm -f authelia/configuration.yml.tmp
    chmod 600 authelia/configuration.yml
    say "created: authelia/configuration.yml"
fi

say ""
say "Next steps:"
say "  1. docker compose up -d --build"
say "  2. open http://127.0.0.1:$LLDAP_WEB_PORT (user 'admin', password in lldap.env: LLDAP_LDAP_USER_PASS)"
say "     - create the people you need under $BASE_DN"
say "     - create the bind account 'svc-authelia' and set its password to SVC_AUTHELIA_PASSWORD (also in lldap.env)"
say "     - add 'svc-authelia' to the built-in group lldap_strict_readonly, and your own account to lldap_admin"
say "  3. open https://$GRIST_DOMAIN:$PUBLIC_PORT and sign in with one of those accounts"
say ""
say "Back up ./data and ./lldap (they hold every document and every directory entry)."
say "authelia/configuration.yml and the *.env files hold secrets: keep them out of git."
