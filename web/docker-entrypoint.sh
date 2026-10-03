#!/bin/sh
set -e
mkdir -p "${DATA_DIR:-/data}/audio" "${CERT_DIR:-/data/certs}"
exec node server/start.mjs "$@"
