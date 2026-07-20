#!/usr/bin/env bash
# SSH deploy on contabo-sg. Writes .env.local on the server from the ENV_FILE_CONTENT
# blob, then pulls the latest image and rolls the app container.
#
# Env in:
#   DEPLOY_SSH_PRIVATE_KEY  private key (raw PEM or base64), a GH variable
#   DEPLOY_SSH_HOST         VPS host/IP
#   DEPLOY_SSH_USER         ssh user
#   DEPLOY_DIR              remote dir holding compose.yml (created if missing)
#   ENV_FILE_CONTENT        full contents of .env.local, written on the server
set -euo pipefail

eval "$(ssh-agent -s)"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
k="${DEPLOY_SSH_PRIVATE_KEY}"
if [ -f "$k" ]; then
  ssh-add "$k"
elif [ "${k#-----BEGIN}" != "$k" ]; then
  printf '%s\n' "$k" | tr -d '\r' | ssh-add -
else
  printf '%s' "$k" | tr -d '\r\n ' | base64 -d | ssh-add -
fi
ssh-keyscan -H "$DEPLOY_SSH_HOST" >> ~/.ssh/known_hosts 2>/dev/null
printf '%s\n' \
  "Host contabo-sg" \
  "  HostName ${DEPLOY_SSH_HOST}" \
  "  User ${DEPLOY_SSH_USER}" \
  "  StrictHostKeyChecking yes" \
  >> ~/.ssh/config
chmod 600 ~/.ssh/config

# Ship compose.yml + public/ + .env.local, then roll the container.
ssh contabo-sg "mkdir -p '${DEPLOY_DIR}'"
scp compose.yml "contabo-sg:${DEPLOY_DIR}/compose.yml"

# Sync baked assets into the bind-mounted public/. No --delete: dashboard uploads
# that live only on the host are preserved; repo assets are refreshed.
rsync -az --rsh=ssh public/ "contabo-sg:${DEPLOY_DIR}/public/"

# Write .env.local on the server (mode 600) without printing it into logs.
printf '%s' "$ENV_FILE_CONTENT" | ssh contabo-sg "umask 177 && cat > '${DEPLOY_DIR}/.env.local'"

ssh contabo-sg "cd '${DEPLOY_DIR}' && docker compose up -d --pull always app && docker image prune -f"
