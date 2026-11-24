#!/bin/sh
# One shot: generate configuration, start LLDAP, create the bind account, start everything.
set -eu
cd "$(dirname "$0")"
./init.sh
docker compose up -d lldap
./bootstrap.sh
docker compose up -d
docker compose ps
