#!/usr/bin/env bash
# Gate C: build an isolated test copy of the app from one exact commit, then
# check it through its packaged MCP bridge and its own controller: Session
# routing by UUID (also after a restart), who stopped a Session, the attention
# panel (focus measured; you confirm what you see), the Session name on the
# toolbar, and force quit of a hung Session.
#
# Writes only under $HOME/ResponsivelyGateC/<run>/ (clone, build, caches, data,
# evidence), except what macOS and Electron key by the test bundle ID or app
# name; those are recorded in evidence/outside-tree.txt, never deleted.
# Reads (never writes) ~/Applications/ResponsivelyMCP.app and your real
# Sessions registry, to prove they are unchanged. Refuses to reuse a run folder.
# On completion it writes <run>/tested.env (commit, tree, hashes, verdict),
# which gatef.sh requires before it installs that commit.
#
# Usage: bash gatec.sh <full-commit-sha> [run-name]   (default run-name: c-<sha7>-001)
# Quit the installed Responsively first. Run it in a normal Terminal window and
# stay there: part-way through it asks you 3 yes/no questions.
set -euo pipefail

EXPECTED_SHA="${1:-}"
if ! printf '%s' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Usage: bash gatec.sh <full 40-character commit SHA> [run-name]"
  exit 2
fi
RUN_NAME="${2:-c-${EXPECTED_SHA:0:7}-001}"
REPO_URL="https://github.com/FilippoRomeo/responsively-app.git"
APP_ID="app.responsively.validation-${RUN_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER="$SCRIPT_DIR/gatec-driver.mjs"

RUN="$HOME/ResponsivelyGateC/$RUN_NAME"
EV="$RUN/evidence"
DATA="$RUN/data"
REPO="$RUN/repo"
CACHES="$RUN/caches"
BUILD_REL=".work/gatec-${RUN_NAME}/build"
PACKAGE="$RUN/gatec-${RUN_NAME}-evidence.tgz"

REAL_APP="$HOME/Applications/ResponsivelyMCP.app"
REAL_SESSIONS="$HOME/Library/Application Support/ResponsivelySessions"
# Shared by app name: the test controller and shell append here (src/main/logging.ts).
SHARED_LOG_DIR="$HOME/Library/Logs/ResponsivelyApp"

if [ -e "$RUN" ]; then
  echo "Refusing to reuse $RUN (frozen evidence). Pass a new run name: bash gatec.sh $EXPECTED_SHA <new-run-name>"
  exit 2
fi
mkdir -p "$EV" "$DATA/sessions-root" "$DATA/shell-data" "$CACHES"

# Download caches stay inside the run folder.
export npm_config_cache="$CACHES/npm"
export YARN_CACHE_FOLDER="$CACHES/yarn"
export electron_config_cache="$CACHES/electron"
export ELECTRON_BUILDER_CACHE="$CACHES/electron-builder"
export npm_config_devdir="$CACHES/node-gyp"

STEP="start"
DRIVER_EXIT="not run"
APP=""
log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STEP" "$*" | tee -a "$EV/steps.log"; }

snapshot_real() {
  {
    if [ -f "$REAL_APP/Contents/Resources/app.asar" ]; then
      shasum -a 256 "$REAL_APP/Contents/Resources/app.asar"
    else
      echo "no installed app.asar"
    fi
    if [ -f "$REAL_SESSIONS/sessions-registry.json" ]; then
      shasum -a 256 "$REAL_SESSIONS/sessions-registry.json"
    else
      echo "no real sessions-registry.json"
    fi
    echo "real runtime leases:"
    ls -1 "$REAL_SESSIONS/runtimes" 2>/dev/null | sort || true
  } > "$EV/real-$1.txt"
}

log_sizes() {
  for f in "$SHARED_LOG_DIR"/*.log; do
    [ -f "$f" ] && printf '%s\t%s\n' "$(wc -c < "$f" | tr -d ' ')" "$f"
  done > "$EV/shared-log-sizes-$1.txt" 2>/dev/null || true
}

# pgrep/pkill take a regex; escape the test app path so it matches literally.
test_app_pattern() { printf '%s' "$APP/Contents/" | sed 's/[][\.*^$()+?{}|]/\\&/g'; }

stop_test_processes() {
  [ -n "$APP" ] || return 0
  local pattern
  pattern="$(test_app_pattern)"
  for _ in $(seq 1 30); do
    pgrep -f "$pattern" > /dev/null || { log "all test-app processes exited on their own"; return 0; }
    sleep 2
  done
  pgrep -fl "$pattern" > "$EV/leftover-processes.txt" || true
  log "test-app processes still running after 60s (listed in leftover-processes.txt); stopping them"
  pkill -f "$pattern" || true
}

finish() {
  local code=$?
  set +e
  STEP="finish"
  log "exit code of last step: $code; driver exit: $DRIVER_EXIT"
  stop_test_processes

  snapshot_real after
  if [ ! -f "$EV/real-before.txt" ]; then
    log "ISOLATION CHECK: not run (stopped before the first snapshot)"
  elif cmp -s "$EV/real-before.txt" "$EV/real-after.txt"; then
    log "ISOLATION PASS: installed app, your Sessions registry and runtime leases unchanged"
  else
    log "ISOLATION CHECK: DIFFERS (compare real-before.txt and real-after.txt)"
  fi

  # Lines the test controller/shell appended to the shared app-name log.
  log_sizes after
  mkdir -p "$EV/shared-log-appended"
  if [ -f "$EV/shared-log-sizes-before.txt" ]; then
    while IFS="$(printf '\t')" read -r _ f; do
      before="$(awk -F '\t' -v f="$f" '$2 == f {print $1}' "$EV/shared-log-sizes-before.txt")"
      tail -c +"$(( ${before:-0} + 1 ))" "$f" > "$EV/shared-log-appended/$(basename "$f")"
    done < "$EV/shared-log-sizes-after.txt"
  fi

  # Test Session runtime logs and the test registry.
  if [ -d "$DATA" ]; then
    find "$DATA" -type f \( -name '*.log' -o -name 'sessions-registry.json' \) | while IFS= read -r f; do
      rel="${f#"$DATA"/}"
      mkdir -p "$EV/app-logs/$(dirname "$rel")"
      cp "$f" "$EV/app-logs/$rel"
    done
  fi

  # What macOS created outside the run folder, keyed by the test bundle ID. Not deleted.
  {
    for p in \
      "$HOME/Library/Preferences/$APP_ID.plist" \
      "$HOME/Library/Saved Application State/$APP_ID.savedState" \
      "$HOME/Library/Caches/$APP_ID" \
      "$HOME/Library/HTTPStorages/$APP_ID"; do
      if [ -e "$p" ]; then echo "exists: $p"; else echo "absent: $p"; fi
    done
  } > "$EV/outside-tree.txt"

  tar -czf "$PACKAGE" -C "$RUN" evidence
  log "evidence package: $PACKAGE"
  shasum -a 256 "$PACKAGE" | tee -a "$EV/steps.log"
  echo "Return this file: $PACKAGE"
}
trap finish EXIT
trap 'exit 130' INT TERM

STEP="preflight"
log "run=$RUN appId=$APP_ID expected=$EXPECTED_SHA"
[ "$(uname -s)" = "Darwin" ] || { log "FAIL: macOS required"; exit 1; }
[ "$(uname -m)" = "arm64" ] || { log "FAIL: Apple Silicon arm64 required"; exit 1; }
[ -f "$DRIVER" ] || { log "FAIL: driver not found at $DRIVER"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
log "node $(node --version) at $(command -v node); $(git --version)"
[ "$NODE_MAJOR" -ge 24 ] || { log "FAIL: Node >= 24 required by desktop-app/package.json"; exit 1; }
shasum -a 256 "$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")" "$DRIVER" | tee "$EV/package-inputs.sha256"
snapshot_real before
log_sizes before

STEP="clone"
git clone "$REPO_URL" "$REPO" > "$EV/clone.log" 2>&1
git -C "$REPO" checkout --detach "$EXPECTED_SHA" >> "$EV/clone.log" 2>&1
HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
HEAD_TREE="$(git -C "$REPO" rev-parse HEAD^{tree})"
log "HEAD=$HEAD_SHA tree=$HEAD_TREE"
[ "$HEAD_SHA" = "$EXPECTED_SHA" ] || { log "FAIL: expected commit $EXPECTED_SHA"; exit 1; }

cd "$REPO/desktop-app"

STEP="install"
log "yarn install (several minutes)"
npx -y yarn@1.22.22 install --frozen-lockfile > "$EV/install.log" 2>&1

STEP="build"
log "yarn build"
rm -rf "$REPO/desktop-app/release/app/dist"
npx -y yarn@1.22.22 build > "$EV/build.log" 2>&1

STEP="package"
log "electron-builder --dir, appId $APP_ID"
CI=false CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder \
  --mac --arm64 --dir --publish never \
  -c.appId="$APP_ID" \
  -c.directories.output="$BUILD_REL" \
  -c.mac.identity=- \
  -c.mac.hardenedRuntime=true \
  -c.mac.entitlements="assets/entitlements.mcp.local.plist" \
  -c.mac.entitlementsInherit="assets/entitlements.mcp.local.plist" \
  > "$EV/package.log" 2>&1

STEP="verify-package"
FOUND="$(find "$REPO/desktop-app/$BUILD_REL" -maxdepth 2 -type d -name 'ResponsivelyApp.app' | head -n 1)"
[ -n "$FOUND" ] || { log "FAIL: no ResponsivelyApp.app under $BUILD_REL"; exit 1; }
case "$FOUND" in
  "$RUN"/*) APP="$FOUND" ;;
  *) log "FAIL: built app is outside the run folder: $FOUND"; exit 1 ;;
esac
CLI="$APP/Contents/Resources/mcp/cli.js"
BUNDLE_ID="$(/usr/bin/defaults read "$APP/Contents/Info.plist" CFBundleIdentifier)"
log "app=$APP bundleId=$BUNDLE_ID"
[ "$BUNDLE_ID" = "$APP_ID" ] || { log "FAIL: unexpected bundle id"; exit 1; }
/usr/bin/codesign --verify --deep --strict "$APP" > "$EV/codesign.log" 2>&1
grep -q "stopped answering on its MCP port" "$CLI" || { log "FAIL: packaged bridge lacks the routing code"; exit 1; }
grep -q "is not answering on port" "$CLI" || { log "FAIL: packaged bridge lacks the log fix (#13)"; exit 1; }
grep -q "attention" "$CLI" || { log "FAIL: packaged bridge lacks the M6 attention request"; exit 1; }
log "packaged bridge contains the routing code, the log fix and the attention request"
shasum -a 256 "$APP/Contents/Resources/app.asar" "$CLI" | tee "$EV/package-hashes.txt"

STEP="driver"
STALE_PORT="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
log "bridge configured with stale port $STALE_PORT (nothing listens there)"
set +e
node "$DRIVER" --cli "$CLI" --app "$APP" --root "$DATA/sessions-root" \
  --shell-data "$DATA/shell-data" --out "$EV" --stale-port "$STALE_PORT" \
  --expected-exe "$APP/Contents/MacOS/ResponsivelyApp" 2> "$EV/driver.log"
DRIVER_EXIT=$?
set -e
grep '^\[gatec\]' "$EV/driver.log" | tee -a "$EV/steps.log" || true

STEP="result"
if [ "$DRIVER_EXIT" -eq 0 ]; then VERDICT=PASS; log "GATE C: ALL CHECKS PASSED"; else VERDICT=FAIL; log "GATE C: FAILED (see results.json)"; fi
# What gatef.sh reads: it installs only a commit whose Gate C run passed.
{
  echo "COMMIT=$HEAD_SHA"
  echo "TREE=$HEAD_TREE"
  echo "ASAR_SHA=$(shasum -a 256 "$APP/Contents/Resources/app.asar" | awk '{print $1}')"
  echo "CLI_SHA=$(shasum -a 256 "$CLI" | awk '{print $1}')"
  echo "RESULT=$VERDICT"
} | tee "$RUN/tested.env" > "$EV/tested.env"
exit "$DRIVER_EXIT"
