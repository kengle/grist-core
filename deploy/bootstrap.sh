#!/bin/sh
# Create the LLDAP bind account Authelia needs.
# NOTE: LLDAP's own `admin` account is never modified here. Its password comes only from
# LLDAP_LDAP_USER_PASS, and no step of this script may overwrite it., then add it to the read-only group.
# Run after `docker compose up -d lldap` and before the first `up -d` of Authelia.
set -eu
cd "$(dirname "$0")"

. ./.env
. ./lldap.env
BASE_DN=${LLDAP_LDAP_BASE_DN:?run init.sh first}
GRIST_ADMIN_EMAIL=${GRIST_ADMIN_EMAIL:-$(sed -n 's/^GRIST_ADMIN_EMAIL=//p' grist.env)}
SERVICE_EMAIL_DOMAIN=${SERVICE_EMAIL_DOMAIN:-$(printf '%s' "$GRIST_ADMIN_EMAIL" | sed 's/.*@//')}
WEB=${LLDAP_WEB_PORT:-17170}

say() { printf '%s\n' "$*"; }
b64() { openssl rand -base64 "$1" | tr -d '\n'; }

say "waiting for LLDAP on 127.0.0.1:$WEB ..."
i=0
while [ $i -lt 60 ]; do
    if curl -fsS "http://127.0.0.1:$WEB/health" >/dev/null 2>&1; then break; fi
    i=$((i + 1)); sleep 1
done
curl -fsS "http://127.0.0.1:$WEB/health" >/dev/null || { say "LLDAP did not come up"; exit 1; }

# 1. Log in as the LLDAP admin and keep the bearer token.
LOGIN=$(curl -fsS -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$LLDAP_LDAP_USER_PASS\"}" \
    "http://127.0.0.1:$WEB/auth/simple/login")
TOKEN=$(printf '%s' "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { say "could not log in to LLDAP"; exit 1; }

gql() {
    # $1 is a complete JSON body, written with a heredoc by the callers below: no shell quoting games.
    curl -sS -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
        -d "$1" "http://127.0.0.1:$WEB/api/graphql"
}

# 2. Create the bind account.
CREATE_BODY=$(cat <<JSON
{"query":"mutation(\$u:CreateUserInput!){createUser(user:\$u){id}}","variables":{"u":{"id":"svc-authelia","email":"svc-authelia@$SERVICE_EMAIL_DOMAIN","displayName":"Authelia bind"}}}
JSON
)
RESULT=$(gql "$CREATE_BODY")
case "$RESULT" in
    *already\ exists*|*"duplicate key"*) say "user svc-authelia already exists" ;;
    *'"createUser"'*) say "created user svc-authelia" ;;
    *) say "could not create svc-authelia: $RESULT"; exit 1 ;;
esac

# 3. Give it the password from lldap.env (passed as an environment variable, never in the host command line).
docker compose exec -T -e LLDAP_USER_PASSWORD="$SVC_AUTHELIA_PASSWORD" lldap \
    /app/lldap_set_password -b http://localhost:17170 --admin-username admin \
    --admin-password "$LLDAP_LDAP_USER_PASS" -u svc-authelia >/dev/null \
    && say "password set for svc-authelia"

# 3b. Create the first human account. Its email is GRIST_ADMIN_EMAIL; the login name is the
# LLDAP uid, so Grist users sign in with "grist-admin", not with the email.
# It is deliberately NOT put in lldap_admin: LLDAP's own `admin` account stays the only
# directory administrator, and this user is only the Grist administrator.
FIRST_PASSWORD=$(sed -n 's/^FIRST_USER_PASSWORD=//p' lldap.env)
if [ -z "$FIRST_PASSWORD" ]; then
    FIRST_PASSWORD=$(b64 18)
    printf 'FIRST_USER_PASSWORD=%s\n' "$FIRST_PASSWORD" >> lldap.env
    chmod 600 lldap.env
fi
FIRST_BODY=$(cat <<JSON
{"query":"mutation(\$u:CreateUserInput!){createUser(user:\$u){id}}","variables":{"u":{"id":"grist-admin","email":"$GRIST_ADMIN_EMAIL","displayName":"Grist admin"}}}
JSON
)
RESULT=$(gql "$FIRST_BODY")
case "$RESULT" in
    *already\ exists*|*"duplicate key"*) say "user grist-admin already exists" ;;
    *'"createUser"'*) say "created user grist-admin ($GRIST_ADMIN_EMAIL), not a directory administrator" ;;
    *) say "could not create grist-admin: $RESULT"; exit 1 ;;
esac
docker compose exec -T -e LLDAP_USER_PASSWORD="$FIRST_PASSWORD" lldap \
    /app/lldap_set_password -b http://localhost:17170 --admin-username admin \
    --admin-password "$LLDAP_LDAP_USER_PASS" -u grist-admin >/dev/null \
    && say "password set for grist-admin (FIRST_USER_PASSWORD in lldap.env)"

# 4. Put it in the read-only group so Authelia can enumerate users and groups.
GROUP_ID=$(gql '{"query":"{groups{id displayName}}"}' | sed -n 's/.*"id":\([0-9]*\),"displayName":"lldap_strict_readonly".*/\1/p')
[ -n "$GROUP_ID" ] || GROUP_ID=3
gql "{\"query\":\"mutation{addUserToGroup(userId:\\\"svc-authelia\\\",groupId:$GROUP_ID){ok}}\"}" >/dev/null \
    && say "svc-authelia added to lldap_strict_readonly (group $GROUP_ID)"
say ""
say "Now create your own people at http://127.0.0.1:$WEB (admin password: LLDAP_LDAP_USER_PASS in lldap.env),"
say "They need no LLDAP group to log in; lldap_admin is only for directory administrators (like admin). Then: docker compose up -d"
