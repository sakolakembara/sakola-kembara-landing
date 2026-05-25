#!/usr/bin/env bash
#
# Generate id_rsa / id_rsa.pub in scripts/credentials for cPanel deploy.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDENTIALS_DIR="$SCRIPT_DIR/credentials"
PRIVATE_KEY="$CREDENTIALS_DIR/id_rsa"
PUBLIC_KEY="$CREDENTIALS_DIR/id_rsa.pub"

FORCE="${FORCE:-0}"
KEY_COMMENT="${KEY_COMMENT:-sakola-kembara-cpanel}"

if ! command -v ssh-keygen >/dev/null 2>&1; then
  echo "error: ssh-keygen not found" >&2
  exit 1
fi

mkdir -p "$CREDENTIALS_DIR"
chmod 700 "$CREDENTIALS_DIR"

if [[ -f "$PRIVATE_KEY" || -f "$PUBLIC_KEY" ]]; then
  if [[ "$FORCE" != "1" ]]; then
    echo "error: keys already exist at $CREDENTIALS_DIR" >&2
    echo "Set FORCE=1 to overwrite." >&2
    exit 1
  fi
  rm -f "$PRIVATE_KEY" "$PUBLIC_KEY"
fi

ssh-keygen \
  -t rsa \
  -b 4096 \
  -f "$PRIVATE_KEY" \
  -C "$KEY_COMMENT" \
  -N ""

chmod 600 "$PRIVATE_KEY"
chmod 644 "$PUBLIC_KEY"

echo "Private key: $PRIVATE_KEY"
echo "Public key:  $PUBLIC_KEY"
echo
echo "Add the public key to cPanel SSH Access, then set in scripts/deploy-cpanel.env:"
echo "CPANEL_SSH_KEY=$PRIVATE_KEY"
