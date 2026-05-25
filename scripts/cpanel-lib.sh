#!/usr/bin/env bash
#
# Shared helpers for cPanel deploy/upload scripts.
#

cpanel_script_dir() {
  cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" && pwd
}

cpanel_load_env() {
  CPANEL_LIB_DIR="$(cpanel_script_dir)"
  CPANEL_PROJECT_ROOT="$(cd "$CPANEL_LIB_DIR/.." && pwd)"
  CPANEL_ENV_FILE="$CPANEL_LIB_DIR/deploy-cpanel.env"

  if [[ -f "$CPANEL_ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CPANEL_ENV_FILE"
  else
    cpanel_warn "Missing $CPANEL_ENV_FILE — using environment variables only."
  fi

  CPANEL_SSH_HOST="${CPANEL_SSH_HOST:-}"
  CPANEL_SSH_USER="${CPANEL_SSH_USER:-}"
  CPANEL_SSH_PORT="${CPANEL_SSH_PORT:-22}"
  CPANEL_SSH_KEY="${CPANEL_SSH_KEY:-}"
  CPANEL_REMOTE_PATH="${CPANEL_REMOTE_PATH:-}"
  CPANEL_PUBLIC_HTML="${CPANEL_PUBLIC_HTML:-}"
  CPANEL_DEPLOY_MODE="${CPANEL_DEPLOY_MODE:-node}"
  CPANEL_PKG_MANAGER="${CPANEL_PKG_MANAGER:-npm}"
  CPANEL_STARTUP_FILE="${CPANEL_STARTUP_FILE:-server.js}"
  CPANEL_RESTART_METHOD="${CPANEL_RESTART_METHOD:-passenger}"
  CPANEL_RESTART_CMD="${CPANEL_RESTART_CMD:-}"

  CPANEL_SSH_BASE=(ssh -p "$CPANEL_SSH_PORT")
  CPANEL_RSYNC_SSH="ssh -p $CPANEL_SSH_PORT"

  if [[ -n "$CPANEL_SSH_KEY" ]]; then
    CPANEL_SSH_BASE+=(-i "$CPANEL_SSH_KEY")
    CPANEL_RSYNC_SSH="ssh -p $CPANEL_SSH_PORT -i $CPANEL_SSH_KEY"
  fi

  CPANEL_REMOTE="${CPANEL_SSH_USER}@${CPANEL_SSH_HOST}"
}

cpanel_log() {
  printf '\033[1;34m[cpanel]\033[0m %s\n' "$*"
}

cpanel_warn() {
  printf '\033[1;33m[cpanel]\033[0m %s\n' "$*" >&2
}

cpanel_fail() {
  printf '\033[1;31m[cpanel]\033[0m %s\n' "$*" >&2
  exit 1
}

cpanel_require_cmd() {
  command -v "$1" >/dev/null 2>&1 || cpanel_fail "Required command not found: $1"
}

cpanel_validate_ssh() {
  cpanel_require_cmd rsync
  cpanel_require_cmd ssh

  if [[ -z "$CPANEL_SSH_HOST" || -z "$CPANEL_SSH_USER" ]]; then
    cpanel_fail "Set CPANEL_SSH_HOST and CPANEL_SSH_USER in $CPANEL_ENV_FILE or your shell."
  fi
}

cpanel_validate_mode() {
  local mode="$1"

  if [[ "$mode" == "node" && -z "$CPANEL_REMOTE_PATH" ]]; then
    cpanel_fail "Node mode requires CPANEL_REMOTE_PATH (cPanel Node.js application root)."
  fi

  if [[ "$mode" == "static" && -z "$CPANEL_PUBLIC_HTML" ]]; then
    cpanel_fail "Static mode requires CPANEL_PUBLIC_HTML (usually ~/public_html)."
  fi
}

cpanel_run_ssh() {
  local dry_run="${CPANEL_DRY_RUN:-0}"

  if [[ "$dry_run" -eq 1 ]]; then
    cpanel_log "[dry-run] ssh ${CPANEL_SSH_BASE[*]} $CPANEL_REMOTE $*"
    return 0
  fi

  "${CPANEL_SSH_BASE[@]}" "$CPANEL_REMOTE" "$@"
}

cpanel_run_rsync() {
  local dry_run="${CPANEL_DRY_RUN:-0}"

  if [[ "$dry_run" -eq 1 ]]; then
    cpanel_log "[dry-run] rsync $*"
    return 0
  fi

  rsync "$@"
}

cpanel_require_standalone_build() {
  [[ -f "$CPANEL_PROJECT_ROOT/.next/standalone/server.js" ]] || \
    cpanel_fail "Missing .next/standalone/server.js. Run pnpm build first (output: standalone)."
  [[ -d "$CPANEL_PROJECT_ROOT/.next/static" ]] || \
    cpanel_fail "Missing .next/static. Run pnpm build first."
}

cpanel_assemble_standalone() {
  local target_dir="$1"

  cpanel_require_standalone_build
  rm -rf "$target_dir"
  mkdir -p "$target_dir"

  cp -R "$CPANEL_PROJECT_ROOT/.next/standalone/." "$target_dir/"
  mkdir -p "$target_dir/.next/static"
  cp -R "$CPANEL_PROJECT_ROOT/.next/static/." "$target_dir/.next/static/"

  if [[ -d "$CPANEL_PROJECT_ROOT/public" ]]; then
    cp -R "$CPANEL_PROJECT_ROOT/public" "$target_dir/public"
  fi

  rm -rf "$target_dir/node_modules"
}

cpanel_standalone_deploy_readme() {
  cat <<EOF
Manual cPanel upload (Next.js standalone)

1. Open cPanel File Manager
2. Go to your Node.js application root (example: ${CPANEL_REMOTE_PATH:-~/your-app})
3. Upload deploy.zip
4. Extract deploy.zip here (server.js must be at app root)
5. In cPanel terminal, inside the app folder run:
   npm install --omit=dev
6. In cPanel → Setup Node.js App:
   - Application startup file: server.js
   - Application mode: Production
7. Restart the Node.js app
8. Delete deploy.zip after extraction
EOF
}

cpanel_remote_install_deps() {
  cpanel_log "Installing production dependencies on server (node_modules excluded from upload)"

  if [[ "${CPANEL_DRY_RUN:-0}" -eq 1 ]]; then
    cpanel_log "[dry-run] remote npm install --omit=dev on $CPANEL_REMOTE:$CPANEL_REMOTE_PATH"
    return 0
  fi

  "${CPANEL_SSH_BASE[@]}" "$CPANEL_REMOTE" bash -s "$CPANEL_REMOTE_PATH" "$CPANEL_PKG_MANAGER" <<'REMOTE'
set -euo pipefail
cd "$1"
case "$2" in
  pnpm)
    command -v pnpm >/dev/null 2>&1 || corepack enable pnpm
    pnpm install --prod
    ;;
  yarn)
    yarn install --production
    ;;
  npm)
    npm install --omit=dev
    ;;
  *)
    echo "Unsupported CPANEL_PKG_MANAGER: $2" >&2
    exit 1
    ;;
esac
REMOTE
}

cpanel_upload_node() {
  local skip_install="${1:-0}"
  local staging_dir

  staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/cpanel-standalone.XXXXXX")"
  cpanel_assemble_standalone "$staging_dir"

  cpanel_log "Uploading standalone bundle (without node_modules) to $CPANEL_REMOTE:$CPANEL_REMOTE_PATH"
  cpanel_run_rsync -az --delete -e "$CPANEL_RSYNC_SSH" \
    "$staging_dir/" "$CPANEL_REMOTE:$CPANEL_REMOTE_PATH/"

  rm -rf "$staging_dir"

  if [[ "$skip_install" -eq 0 ]]; then
    cpanel_remote_install_deps
  fi
}

cpanel_upload_static() {
  [[ -d "$CPANEL_PROJECT_ROOT/out" ]] || cpanel_fail "Missing out/ directory. Run a static build first."

  cpanel_log "Uploading out/ to $CPANEL_REMOTE:$CPANEL_PUBLIC_HTML"
  cpanel_run_rsync -az --delete -e "$CPANEL_RSYNC_SSH" \
    "$CPANEL_PROJECT_ROOT/out/" "$CPANEL_REMOTE:$CPANEL_PUBLIC_HTML/"

  if [[ -f "$CPANEL_LIB_DIR/cpanel-static.htaccess" ]]; then
    cpanel_log "Uploading .htaccess"
    cpanel_run_rsync -az -e "$CPANEL_RSYNC_SSH" \
      "$CPANEL_LIB_DIR/cpanel-static.htaccess" "$CPANEL_REMOTE:$CPANEL_PUBLIC_HTML/.htaccess"
  fi
}

cpanel_restart_node_app() {
  cpanel_log "Restarting Node.js app via ${CPANEL_RESTART_METHOD}"

  case "$CPANEL_RESTART_METHOD" in
    passenger)
      cpanel_run_ssh "mkdir -p '$CPANEL_REMOTE_PATH/tmp' && touch '$CPANEL_REMOTE_PATH/tmp/restart.txt'" || {
        cpanel_warn "Could not touch tmp/restart.txt — restart the app manually in cPanel."
      }
      ;;
    cloudlinux)
      cpanel_run_ssh "cloudlinux-selector restart --app-root '$CPANEL_REMOTE_PATH'" || {
        cpanel_warn "cloudlinux-selector restart failed — restart manually in cPanel."
      }
      ;;
    command)
      [[ -n "$CPANEL_RESTART_CMD" ]] || cpanel_fail "CPANEL_RESTART_METHOD=command requires CPANEL_RESTART_CMD."
      cpanel_run_ssh "$CPANEL_RESTART_CMD" || {
        cpanel_warn "Custom restart command failed."
      }
      ;;
    none)
      cpanel_log "Restart skipped (CPANEL_RESTART_METHOD=none)"
      ;;
    *)
      cpanel_fail "Unknown CPANEL_RESTART_METHOD: $CPANEL_RESTART_METHOD"
      ;;
  esac
}

cpanel_create_deploy_zip() {
  local mode="$1"
  local zip_path="$CPANEL_PROJECT_ROOT/deploy.zip"
  local staging_dir
  local size

  cpanel_require_cmd zip

  rm -f "$zip_path"
  staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/cpanel-deploy.XXXXXX")"

  cpanel_log "Creating deploy.zip for manual cPanel upload (node_modules excluded)"

  if [[ "$mode" == "static" ]]; then
    [[ -d "$CPANEL_PROJECT_ROOT/out" ]] || cpanel_fail "Missing out/ directory. Run a static build first."

    cp -R "$CPANEL_PROJECT_ROOT/out/." "$staging_dir/"

    if [[ -f "$CPANEL_LIB_DIR/cpanel-static.htaccess" ]]; then
      cp "$CPANEL_LIB_DIR/cpanel-static.htaccess" "$staging_dir/.htaccess"
    fi

    cat >"$staging_dir/DEPLOY-README.txt" <<'EOF'
Manual cPanel upload (static site)

1. Open cPanel File Manager
2. Go to public_html (or your domain document root)
3. Upload deploy.zip
4. Extract deploy.zip here
5. Confirm index.html is at the document root
6. Delete deploy.zip after extraction
EOF
  else
    cpanel_assemble_standalone "$staging_dir"
    cpanel_standalone_deploy_readme >"$staging_dir/DEPLOY-README.txt"
  fi

  (
    cd "$staging_dir"
    zip -qr "$zip_path" .
  )

  rm -rf "$staging_dir"

  size="$(du -h "$zip_path" | awk '{print $1}')"
  cpanel_log "Created $zip_path ($size)"
}
