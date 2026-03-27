#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# crawl-and-deploy.sh — Full pipeline: crawl BC curriculum, deploy to Fly.io
#
# Runs the Playwright crawler, uploads the updated SQLite database to
# the Fly.io volume, restarts the server, and generates a change report.
#
# Usage:
#   bash scripts/crawl-and-deploy.sh               # Standard crawl + deploy
#   bash scripts/crawl-and-deploy.sh --force        # Force re-crawl all pages
#   bash scripts/crawl-and-deploy.sh --crawl-only   # Skip Fly.io deployment
#   bash scripts/crawl-and-deploy.sh --deploy-only  # Skip crawl, just upload + restart
#
# Environment:
#   DB_PATH       — Override SQLite path (default: ./bc-curriculum.sqlite)
#   FLY_APP       — Fly app name (default: bc-curriculum-mcp)
#   FLY_DB_PATH   — Remote DB path on Fly volume (default: /data/bc-curriculum.sqlite)
#
# ═══════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="${DB_PATH:-$PROJECT_DIR/bc-curriculum.sqlite}"
FLY_APP="${FLY_APP:-bc-curriculum-mcp}"
FLY_DB_PATH="${FLY_DB_PATH:-/data/bc-curriculum.sqlite}"

FORCE_CRAWL=false
CRAWL_ONLY=false
DEPLOY_ONLY=false
LOG_FILE="$PROJECT_DIR/crawl-$(date +%Y%m%d-%H%M%S).log"

# ── Argument parsing ──────────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --force)       FORCE_CRAWL=true ;;
    --crawl-only)  CRAWL_ONLY=true ;;
    --deploy-only) DEPLOY_ONLY=true ;;
    --help|-h)
      head -25 "$0" | tail -20
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (try --help)"
      exit 1
      ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────

log()   { echo "$(date '+%H:%M:%S') [INFO]  $*" | tee -a "$LOG_FILE"; }
warn()  { echo "$(date '+%H:%M:%S') [WARN]  $*" | tee -a "$LOG_FILE" >&2; }
error() { echo "$(date '+%H:%M:%S') [ERROR] $*" | tee -a "$LOG_FILE" >&2; }
fail()  { error "$*"; exit 1; }

check_command() {
  if ! command -v "$1" &>/dev/null; then
    fail "Required command not found: $1. $2"
  fi
}

# ── Dependency checks ────────────────────────────────────────────────────

log "═══════════════════════════════════════════════════════"
log "  BC Curriculum MCP — Crawl & Deploy Pipeline"
log "═══════════════════════════════════════════════════════"
log ""
log "Checking dependencies..."

check_command "node" "Install Node.js >= 18 from https://nodejs.org"

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js >= 18 required, found v$(node -v). Please upgrade."
fi
log "  ✓ Node.js $(node -v)"

if [ "$DEPLOY_ONLY" = false ]; then
  # Playwright is only needed for crawling
  if ! npx --yes playwright --version &>/dev/null 2>&1; then
    warn "Playwright not found. Attempting to install..."
    cd "$PROJECT_DIR"
    npx playwright install chromium 2>&1 | tee -a "$LOG_FILE"
    if ! npx --yes playwright --version &>/dev/null 2>&1; then
      fail "Playwright installation failed. Run: npx playwright install chromium"
    fi
  fi
  log "  ✓ Playwright available"
fi

if [ "$CRAWL_ONLY" = false ]; then
  check_command "fly" "Install Fly CLI: curl -L https://fly.io/install.sh | sh"
  log "  ✓ Fly CLI $(fly version 2>/dev/null | head -1 || echo 'installed')"

  # Verify Fly auth
  if ! fly auth whoami &>/dev/null 2>&1; then
    fail "Not logged into Fly.io. Run: fly auth login"
  fi
  log "  ✓ Fly.io authenticated"

  # Verify app exists
  if ! fly apps list 2>/dev/null | grep -q "$FLY_APP"; then
    fail "Fly app '$FLY_APP' not found. Check FLY_APP env var or run: fly launch"
  fi
  log "  ✓ Fly app '$FLY_APP' exists"
fi

# Check project is built
if [ ! -d "$PROJECT_DIR/dist" ]; then
  log "  Building project (dist/ not found)..."
  cd "$PROJECT_DIR"
  npm run build 2>&1 | tee -a "$LOG_FILE"
fi
log "  ✓ Project built"

# Verify node_modules
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  log "  Installing dependencies..."
  cd "$PROJECT_DIR"
  npm install 2>&1 | tee -a "$LOG_FILE"
fi
log "  ✓ Dependencies installed"

log ""
log "All checks passed."
log ""

# ── Pre-crawl: back up existing database ──────────────────────────────────

cd "$PROJECT_DIR"

if [ -f "$DB_PATH" ] && [ "$DEPLOY_ONLY" = false ]; then
  BACKUP_PATH="${DB_PATH}.backup-$(date +%Y%m%d)"
  if [ ! -f "$BACKUP_PATH" ]; then
    cp "$DB_PATH" "$BACKUP_PATH"
    log "Database backed up to $(basename "$BACKUP_PATH")"
  else
    log "Backup already exists for today: $(basename "$BACKUP_PATH")"
  fi
fi

# ── Phase 1: Crawl ───────────────────────────────────────────────────────

if [ "$DEPLOY_ONLY" = false ]; then
  log "───────────────────────────────────────────────────────"
  log "  PHASE 1: Crawling curriculum.gov.bc.ca"
  log "───────────────────────────────────────────────────────"
  log ""

  CRAWL_ARGS="--all"
  if [ "$FORCE_CRAWL" = true ]; then
    CRAWL_ARGS="$CRAWL_ARGS --force"
    log "Force mode: re-crawling all pages regardless of existing data."
  fi

  CRAWL_START=$(date +%s)
  log "Starting full K-12 crawl... (this takes 60-90 minutes)"
  log ""

  if node dist/crawler/run-crawl.js $CRAWL_ARGS 2>&1 | tee -a "$LOG_FILE"; then
    CRAWL_END=$(date +%s)
    CRAWL_DURATION=$(( (CRAWL_END - CRAWL_START) / 60 ))
    log ""
    log "✅ Crawl completed in ${CRAWL_DURATION} minutes."
  else
    CRAWL_EXIT=$?
    error "Crawl failed with exit code $CRAWL_EXIT."
    error "Check the log: $LOG_FILE"
    error "You can retry with: bash scripts/crawl-and-deploy.sh --force"
    exit $CRAWL_EXIT
  fi

  # Verify database was updated
  if [ ! -f "$DB_PATH" ]; then
    fail "Database file not found at $DB_PATH after crawl."
  fi

  DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
  log "Database size: $DB_SIZE"
  log ""
fi

# ── Phase 2: Change report ───────────────────────────────────────────────

if [ "$DEPLOY_ONLY" = false ]; then
  log "───────────────────────────────────────────────────────"
  log "  PHASE 2: Generating change report"
  log "───────────────────────────────────────────────────────"
  log ""

  REPORT_FILE="$PROJECT_DIR/crawl-report-$(date +%Y%m%d).txt"
  if node scripts/crawl-report.cjs --db "$DB_PATH" 2>&1 | tee "$REPORT_FILE" | tee -a "$LOG_FILE"; then
    log ""
    log "Report saved to $(basename "$REPORT_FILE")"
  else
    warn "Report generation had issues, but continuing with deployment."
  fi
  log ""
fi

# ── Phase 3: Deploy to Fly.io ────────────────────────────────────────────

if [ "$CRAWL_ONLY" = false ]; then
  log "───────────────────────────────────────────────────────"
  log "  PHASE 3: Deploying to Fly.io ($FLY_APP)"
  log "───────────────────────────────────────────────────────"
  log ""

  if [ ! -f "$DB_PATH" ]; then
    fail "No database file at $DB_PATH. Run crawl first or set DB_PATH."
  fi

  # Upload database via SFTP
  log "Uploading database to Fly.io volume..."
  if echo "put $DB_PATH $FLY_DB_PATH" | fly ssh sftp shell -a "$FLY_APP" 2>&1 | tee -a "$LOG_FILE"; then
    log "✅ Database uploaded."
  else
    error "SFTP upload failed. Trying alternative method..."
    # Fallback: use fly ssh console to verify the volume mount exists
    if fly ssh console -a "$FLY_APP" -C "ls -la /data/" 2>&1 | tee -a "$LOG_FILE"; then
      log "Volume mount exists. Retrying upload..."
      echo "put $DB_PATH $FLY_DB_PATH" | fly ssh sftp shell -a "$FLY_APP" 2>&1 | tee -a "$LOG_FILE" \
        || fail "Database upload failed on retry. Check Fly.io status and try manually."
    else
      fail "Cannot access Fly.io volume. Check: fly status -a $FLY_APP"
    fi
  fi
  log ""

  # Restart to pick up new database
  log "Restarting server..."
  if fly apps restart "$FLY_APP" 2>&1 | tee -a "$LOG_FILE"; then
    log "✅ Server restarted."
  else
    warn "Restart command returned non-zero. Checking status..."
  fi
  log ""

  # Health check (wait a moment for server to come up)
  log "Waiting for server to come up..."
  sleep 10

  HEALTH_URL="https://${FLY_APP}.fly.dev/health"
  HEALTH_ATTEMPTS=0
  HEALTH_OK=false

  while [ $HEALTH_ATTEMPTS -lt 6 ]; do
    HEALTH_ATTEMPTS=$((HEALTH_ATTEMPTS + 1))
    if curl -sf "$HEALTH_URL" 2>/dev/null | grep -q '"ok"'; then
      HEALTH_OK=true
      break
    fi
    log "  Health check attempt $HEALTH_ATTEMPTS/6 — waiting 10s..."
    sleep 10
  done

  if [ "$HEALTH_OK" = true ]; then
    log "✅ Server healthy at $HEALTH_URL"
  else
    warn "Server health check failed after 6 attempts."
    warn "Check manually: curl $HEALTH_URL"
    warn "Or: fly logs -a $FLY_APP"
  fi
  log ""
fi

# ── Done ──────────────────────────────────────────────────────────────────

log "═══════════════════════════════════════════════════════"
log "  PIPELINE COMPLETE"
log "═══════════════════════════════════════════════════════"
log ""
log "Log file: $LOG_FILE"
[ "$DEPLOY_ONLY" = false ] && [ -f "$REPORT_FILE" ] && log "Change report: $REPORT_FILE"
log ""
log "Next scheduled crawl: January or July (whichever comes next)"
log ""
