#!/usr/bin/env bash
#
# Build locally (or static export) then upload to cPanel.
# For upload/restart only, use scripts/upload-cpanel.sh instead.
#
# Usage:
#   cp scripts/deploy-cpanel.env.example scripts/deploy-cpanel.env
#   ./scripts/deploy-cpanel.sh
#
# Options:
#   --dry-run     Pass through to upload-cpanel.sh
#   --build-only  Build locally, create deploy.zip, exit without uploading
#   --static      Static export mode
#   --node        Node.js app mode (default)
#   --no-upload   Build only (alias for --build-only)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/cpanel-lib.sh"

BUILD_ONLY=0
UPLOAD_ARGS=()

# Bash 3.2 (macOS) treats empty "${array[@]}" as unbound under set -u.
cpanel_has_upload_args() {
  ((${#UPLOAD_ARGS[@]} > 0))
}

cpanel_run_upload() {
  local mode="$1"
  shift

  if cpanel_has_upload_args; then
    bash "$SCRIPT_DIR/upload-cpanel.sh" "--$mode" "${UPLOAD_ARGS[@]}" "$@"
  else
    bash "$SCRIPT_DIR/upload-cpanel.sh" "--$mode" "$@"
  fi
}

usage() {
  cat <<'EOF'
Build and deploy to cPanel.

Usage:
  ./scripts/deploy-cpanel.sh [options]

Options:
  --dry-run      Build and show upload/restart steps without executing them
  --build-only   Build locally, create deploy.zip, exit without uploading
  --static       Static export mode
  --node         Node.js app mode (default)
  -h, --help     Show this help

Upload/restart only:
  ./scripts/upload-cpanel.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      UPLOAD_ARGS+=(--dry-run)
      CPANEL_DRY_RUN=1
      shift
      ;;
    --build-only | --no-upload)
      BUILD_ONLY=1
      shift
      ;;
    --static)
      UPLOAD_ARGS+=(--static)
      shift
      ;;
    --node)
      UPLOAD_ARGS+=(--node)
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

cpanel_load_env

detect_local_pkg_manager() {
  if [[ -f "$PROJECT_ROOT/pnpm-lock.yaml" ]] && command -v pnpm >/dev/null 2>&1; then
    echo "pnpm"
  elif [[ -f "$PROJECT_ROOT/yarn.lock" ]] && command -v yarn >/dev/null 2>&1; then
    echo "yarn"
  else
    echo "npm"
  fi
}

install_and_build_local() {
  local pm
  pm="$(detect_local_pkg_manager)"
  cpanel_log "Local build with $pm"

  cd "$PROJECT_ROOT"

  case "$pm" in
    pnpm)
      pnpm install --frozen-lockfile
      pnpm run build
      ;;
    yarn)
      yarn install --frozen-lockfile
      yarn build
      ;;
    npm)
      npm ci
      npm run build
      ;;
  esac
}

build_static_export() {
  cpanel_log "Building static export (requires output: 'export' in next.config.ts)"
  cd "$PROJECT_ROOT"
  export CPANEL_STATIC=1
  install_and_build_local
  [[ -d "$PROJECT_ROOT/out" ]] || cpanel_fail "Static build did not produce an out/ directory."
}

MODE="${CPANEL_DEPLOY_MODE:-node}"
if cpanel_has_upload_args; then
  for arg in "${UPLOAD_ARGS[@]}"; do
    if [[ "$arg" == "--static" ]]; then
      MODE="static"
    elif [[ "$arg" == "--node" ]]; then
      MODE="node"
    fi
  done
fi

cpanel_log "Mode: $MODE"

if [[ "$MODE" == "static" ]]; then
  build_static_export
else
  install_and_build_local
fi

if [[ "$BUILD_ONLY" -eq 1 ]]; then
  cpanel_create_deploy_zip "$MODE"
  cpanel_log "Build-only complete. Upload deploy.zip via cPanel File Manager."
  exit 0
fi

if [[ "$MODE" == "node" ]]; then
  cpanel_run_upload node
else
  cpanel_run_upload static
fi
