#!/bin/sh
# One shot: generate configuration, start LLDAP, create the bind account, finish Grist's
# first-run setup, then start everything. Safe to re-run.
set -eu
cd "$(dirname "$0")"

./init.sh
docker compose up -d lldap
./bootstrap.sh
docker compose up -d

# Wait for Grist, then hand it the boot key and the admin email. Without this every API
# call answers "Grist is not yet configured".
. ./.env
# grist.env holds values with spaces (GVISOR_FLAGS), so read the two keys instead of sourcing it.
GRIST_BOOT_KEY=$(sed -n 's/^GRIST_BOOT_KEY=//p' grist.env)
GRIST_ADMIN_EMAIL=$(sed -n 's/^GRIST_ADMIN_EMAIL=//p' grist.env)
# 443 is implicit in an https URL; any other port has to be spelled out.
URL="https://$GRIST_DOMAIN"
[ "$PUBLIC_PORT" = "443" ] || URL="$URL:$PUBLIC_PORT"
say() { printf '%s\n' "$*"; }

say "waiting for Grist on $URL ..."
i=0
while [ $i -lt 90 ]; do
    if curl -fsSk "$URL/boot" >/dev/null 2>&1; then break; fi
    i=$((i + 1)); sleep 2
done

RESPONSE=$(curl -sk -X POST "$URL/boot/login" \
    -H 'Content-Type: application/json' \
    -d "{\"bootKey\":\"$GRIST_BOOT_KEY\",\"adminEmail\":\"$GRIST_ADMIN_EMAIL\"}" \
    -w '\n%{http_code}' || true)
CODE=$(printf '%s' "$RESPONSE" | tail -1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')
if [ "$CODE" != "204" ]; then
    say "Grist setup failed: HTTP $CODE"
    say "$BODY"
    exit 1
fi
say "Grist setup complete: install admin is $GRIST_ADMIN_EMAIL"

docker compose ps
say ""
say "Sign in at $URL with an LLDAP account whose email is $GRIST_ADMIN_EMAIL (or another one you create)."
