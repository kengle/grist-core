#!/bin/sh
# Create the LLDAP bind account Authelia needs, then add it to the read-only group.
# Run after `docker compose up -d lldap` and before the first `up -d` of Authelia.
set -eu
cd "$(dirname "$0")"

. ./.env
. ./lldap.env
BASE_DN=${LLDAP_LDAP_BASE_DN:-dc=example,dc=com}
WEB=${LLDAP_WEB_PORT:-17170}

say() { printf '%s\n' "$*"; }

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
{"query":"mutation(\$u:CreateUserInput!){createUser(user:\$u){id}}","variables":{"u":{"id":"svc-authelia","email":"svc-authelia@example.com","displayName":"Authelia bind"}}}
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

# 4. Put it in the read-only group so Authelia can enumerate users and groups.
GROUP_ID=$(gql '{"query":"{groups{id displayName}}"}' | sed -n 's/.*"id":\([0-9]*\),"displayName":"lldap_strict_readonly".*/\1/p')
[ -n "$GROUP_ID" ] || GROUP_ID=3
gql "{\"query\":\"mutation{addUserToGroup(userId:\\\"svc-authelia\\\",groupId:$GROUP_ID){ok}}\"}" >/dev/null \
    && say "svc-authelia added to lldap_strict_readonly (group $GROUP_ID)"
say ""
say "Now create your own people at http://127.0.0.1:$WEB (admin password: LLDAP_LDAP_USER_PASS in lldap.env),"
say "and add them to the group lldap_admin. Then: docker compose up -d"
