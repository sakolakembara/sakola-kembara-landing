#!/usr/bin/env bash
#
# Upload Next.js standalone bundle to cPanel and restart the server.
# Does not run a local build — use deploy-cpanel.sh or pnpm build first.
#
# Usage:
#   cp scripts/deploy-cpanel.env.example scripts/deploy-cpanel.env
#   pnpm build
#   ./scripts/upload-cpanel.sh
#
# Options:
#   --dry-run        Print actions without uploading or restarting
#   --node           Upload standalone bundle (default)
#   --static         Upload out/ to public_html
#   --restart-only   Skip upload, only restart the server
#   --no-install     Upload only, skip remote npm install --omit=dev
#   --no-restart     Skip server restart (install still runs unless --no-install)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/cpanel-lib.sh"

MODE=""
DRY_RUN=0
RESTART_ONLY=0
NO_RESTART=0
NO_INSTALL=0

usage() {
  cat <<'EOF'
Upload to cPanel and restart server.

Usage:
  ./scripts/upload-cpanel.sh [options]

Options:
  --dry-run        Print actions without uploading or restarting
  --node           Upload standalone bundle (default)
  --static         Upload out/ to public_html
  --restart-only   Skip upload, only restart the server
  --no-install     Upload only, skip remote npm install --omit=dev
  --no-restart     Skip server restart (install still runs unless --no-install)
  -h, --help       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --node)
      MODE="node"
      shift
      ;;
    --static)
      MODE="static"
      shift
      ;;
    --restart-only)
      RESTART_ONLY=1
      shift
      ;;
    --no-restart)
      NO_RESTART=1
      shift
      ;;
    --no-install)
      NO_INSTALL=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      cpanel_fail "Unknown option: $1 (try --help)"
      ;;
  esac
done

CPANEL_DRY_RUN="$DRY_RUN"
cpanel_load_env
cpanel_validate_ssh

MODE="${MODE:-$CPANEL_DEPLOY_MODE}"
cpanel_validate_mode "$MODE"

if [[ "$RESTART_ONLY" -eq 1 && "$MODE" != "node" ]]; then
  cpanel_fail "--restart-only is only supported in node mode."
fi

if [[ "$MODE" == "node" && "$RESTART_ONLY" -eq 0 ]]; then
  cpanel_require_standalone_build
fi

if [[ "$RESTART_ONLY" -eq 0 ]]; then
  case "$MODE" in
    node)
      cpanel_upload_node "$NO_INSTALL"
      ;;
    static)
      cpanel_upload_static
      ;;
  esac
else
  cpanel_log "Upload skipped (--restart-only)"
fi

if [[ "$MODE" == "node" && "$NO_RESTART" -eq 0 ]]; then
  cpanel_restart_node_app
elif [[ "$MODE" == "node" ]]; then
  cpanel_log "Restart skipped (--no-restart)"
fi

cpanel_log "Upload/restart complete."
