#!/bin/sh
# Generate the secrets and configuration this deployment needs. Safe to re-run:
# anything that already exists is left alone.
set -eu

cd "$(dirname "$0")"

GRIST_SITE_DOMAIN=${GRIST_SITE_DOMAIN:?GRIST_SITE_DOMAIN must be set explicitly, for example g.example.org}
PUBLIC_PORT=${PUBLIC_PORT:-443}
LDAP_PORT=${LDAP_PORT:-3890}
LLDAP_WEB_PORT=${LLDAP_WEB_PORT:-17170}
GRIST_IMAGE=${GRIST_IMAGE:-grist-merged:local}
GRIST_ADMIN_EMAIL=${GRIST_ADMIN_EMAIL:?GRIST_ADMIN_EMAIL must be set explicitly, for example you@example.com}
case "$GRIST_ADMIN_EMAIL" in
    *@*) ;;
    *) echo "GRIST_ADMIN_EMAIL must contain an @domain: $GRIST_ADMIN_EMAIL"; exit 1 ;;
esac
SERVICE_EMAIL_DOMAIN=${SERVICE_EMAIL_DOMAIN:-$(printf '%s' "$GRIST_ADMIN_EMAIL" | sed 's/.*@//')}
BASE_DN=${BASE_DN:-dc=$(printf '%s' "$SERVICE_EMAIL_DOMAIN" | sed 's/\./,dc=/g')}
DATA_ROOT=${DATA_ROOT:-./state}
# 443 is implicit in an https URL; any other port has to be spelled out.
PUBLIC_URL="https://$GRIST_SITE_DOMAIN"
[ "$PUBLIC_PORT" = "443" ] || PUBLIC_URL="$PUBLIC_URL:$PUBLIC_PORT"
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

mkdir -p "$DATA_ROOT/grist" "$DATA_ROOT/lldap" "$DATA_ROOT/authelia"
chmod 700 "$DATA_ROOT/authelia" 2>/dev/null || true

# Compose-level settings.
write_new .env <<EOF
GRIST_SITE_DOMAIN=$GRIST_SITE_DOMAIN
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
GRIST_DEFAULT_EMAIL=$GRIST_ADMIN_EMAIL
GRIST_ADMIN_EMAIL=$GRIST_ADMIN_EMAIL
GRIST_BOOT_KEY=$BOOT_KEY
GRIST_SANDBOX_FLAVOR=gvisor
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
APP_HOME_URL=$PUBLIC_URL/
APP_HOME_INTERNAL_URL=http://127.0.0.1:8484/
GRIST_FORWARD_AUTH_HEADER=Remote-Email
GRIST_FORWARD_AUTH_LOGOUT_PATH=/authelia/logout
GRIST_TEMPLATE_ORG=
GRIST_OIDC_JWKS_URL=http://authelia:9091/authelia/jwks.json
GRIST_OIDC_ISSUER=$PUBLIC_URL/authelia
GRIST_OIDC_AUDIENCE=$PUBLIC_URL
GRIST_OIDC_EMAIL_CLAIM=email
GRIST_API_BASE=http://127.0.0.1:8484/api
MCP_RESOURCE_URL=$PUBLIC_URL
EOF

# Authelia: render configuration.yml from the template, filling in fresh secrets.
if [ -f "$DATA_ROOT/authelia/configuration.yml" ]; then
    say "exists, skipped: $DATA_ROOT/authelia/configuration.yml"
else
    # A database from an older configuration cannot be read with a freshly generated
    # encryption key; move it aside instead of letting Authelia fail at startup.
    if [ -f "$DATA_ROOT/authelia/db.sqlite3" ]; then
        mv "$DATA_ROOT/authelia/db.sqlite3" "$DATA_ROOT/authelia/db.sqlite3.old-$(date +%Y%m%d-%H%M%S)"
        say "moved stale authelia/db.sqlite3 aside (its storage key no longer matches)"
    fi
    JWT_SECRET=$(hex 32)
    SESSION_SECRET=$(hex 32)
    STORAGE_KEY=$(hex 24)
    OIDC_HMAC=$(hex 32)
    CLIENT_SECRET=$(hex 32)
    openssl genrsa -out "$DATA_ROOT/authelia/oidc_signing_key.pem" 2048 2>/dev/null
    chmod 600 "$DATA_ROOT/authelia/oidc_signing_key.pem"
    sed \
        -e "s|__BASE_DN__|$BASE_DN|g" \
        -e "s|__GRIST_HOST__|$GRIST_SITE_DOMAIN|g" \
        -e "s|__GRIST_PORT__|$PUBLIC_PORT|g" \
        -e "s|__JWT_SECRET__|$JWT_SECRET|g" \
        -e "s|__SESSION_SECRET__|$SESSION_SECRET|g" \
        -e "s|__STORAGE_KEY__|$STORAGE_KEY|g" \
        -e "s|__OIDC_HMAC_SECRET__|$OIDC_HMAC|g" \
        -e "s|__OIDC_CLIENT_SECRET__|$CLIENT_SECRET|g" \
        authelia/configuration.yml.tpl > "$DATA_ROOT/authelia/configuration.yml.tmp"
    # The JWKS private key is multi-line: splice it in with awk, then drop the token line.
    awk -v keyfile="$DATA_ROOT/authelia/oidc_signing_key.pem" '
        /^__OIDC_JWKS_KEY_PEM__$/ {
            while ((getline line < keyfile) > 0) { printf "          %s\n", line }
            next
        }
        { print }
    ' "$DATA_ROOT/authelia/configuration.yml.tmp" > "$DATA_ROOT/authelia/configuration.yml"
    rm -f "$DATA_ROOT/authelia/configuration.yml.tmp"
    chmod 600 "$DATA_ROOT/authelia/configuration.yml"
    say "created: $DATA_ROOT/authelia/configuration.yml"
fi

say ""
say "NOTE: GRIST_ADMIN_EMAIL was derived from GRIST_SITE_DOMAIN: $GRIST_ADMIN_EMAIL" 2>/dev/null || true
say ""
say "Next steps:"
say "  1. docker compose up -d --build"
say "  2. open http://127.0.0.1:$LLDAP_WEB_PORT (user 'admin', password in lldap.env: LLDAP_LDAP_USER_PASS)"
say "     - create the people you need under $BASE_DN"
say "     - create the bind account 'svc-authelia' and set its password to SVC_AUTHELIA_PASSWORD (also in lldap.env)"
say "     - add 'svc-authelia' to the built-in group lldap_strict_readonly, and your own account to lldap_admin"
say "  3. open $PUBLIC_URL and sign in with one of those accounts"
say ""
say "Back up $DATA_ROOT (documents, directory and Authelia state live there). One tar covers it all."
say "authelia/configuration.yml and the *.env files hold secrets: keep them out of git."

# Refuse to continue with configuration from another domain or port: grist.env and the
# rendered Authelia configuration bake both into URLs, so a stale .env silently produces
# links that point at the wrong host.
EXPECTED_URL="$PUBLIC_URL"
if [ -f grist.env ]; then
    FOUND_URL=$(sed -n 's/^APP_HOME_URL=//p' grist.env)
    if [ "$FOUND_URL" != "$EXPECTED_URL/" ]; then
        say ""
        say "!!!!!!!!!!!!!!!!!!!!!!!! CONFIGURATION MISMATCH !!!!!!!!!!!!!!!!!!!!!!!!"
        say "grist.env has APP_HOME_URL=$FOUND_URL"
        say "this run expects APP_HOME_URL=$EXPECTED_URL/"
        say "Delete .env, grist.env, lldap.env and state/, then run this script again."
        say "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        exit 1
    fi
fi
