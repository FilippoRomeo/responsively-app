#!/usr/bin/env bash
# Gate C: build an isolated test copy of the app from one exact commit, then
# check it through its packaged MCP bridge and its own controller: Session
# routing by UUID (also after a restart), who stopped a Session, the attention
# panel (focus measured; you confirm what you see), the Session name in its
# tab and ⋮ › Manage Sessions…, and force quit of a hung Session.
#
# Writes only under $HOME/ResponsivelyGateC/<run>/ (clone, build, caches, data,
# evidence), except what macOS and Electron key by the test bundle ID or app
# name; those are recorded in evidence/outside-tree.txt, never deleted.
# Reads (never writes) ~/Applications/ResponsivelyMCP.app and your real
# Sessions registry, to prove they are unchanged. Refuses to reuse a run folder.
# On completion it writes <run>/tested.env (commit, tree, hashes, verdict: PASS
# only if every check and the isolation check passed),
# which gatef.sh requires before it installs that commit.
#
# Usage: bash gatec.sh <full-commit-sha> [run-name] [--reuse-build <earlier-run>]
#   (default run-name: c-<sha7>-001)
# --reuse-build skips clone, install, build and package: it tests the app an
# earlier run built from the same commit, after checking that run's clone is at
# that commit and its app.asar and bridge still hash as recorded when built.
# Data and evidence are new; the earlier run is only read.
# Quit the installed Responsively first. Run it in a normal Terminal window and
# stay there: part-way through it asks you 3 yes/no questions.
set -euo pipefail

EXPECTED_SHA="${1:-}"
if ! printf '%s' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Usage: bash gatec.sh <full 40-character commit SHA> [run-name] [--reuse-build <earlier-run>]"
  exit 2
fi
RUN_NAME="${2:-c-${EXPECTED_SHA:0:7}-001}"
REUSE_RUN=""
if [ "${3:-}" = "--reuse-build" ]; then
  REUSE_RUN="${4:-}"
  [ -n "$REUSE_RUN" ] && [ "$REUSE_RUN" != "$RUN_NAME" ] || {
    echo "--reuse-build needs the name of an earlier run, different from this one"
    exit 2
  }
elif [ -n "${3:-}" ]; then
  echo "Unknown option: $3"
  exit 2
fi
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
ISOLATION="not run"
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

# pgrep/pkill take a regex; escape a path so it matches literally.
literal() { printf '%s' "$1" | sed 's/[][\.*^$()+?{}|]/\\&/g'; }
test_app_pattern() { literal "$APP/Contents/"; }

# Your installed app's processes (never the test copy, which lives in the run folder).
real_app_pids() { pgrep -f "$(literal "$REAL_APP/Contents/")" | tr '\n' ' ' || true; }
# Real Session runtimes whose process is alive.
live_real_leases() {
  for f in "$REAL_SESSIONS"/runtimes/*.json; do
    [ -f "$f" ] || continue
    pid="$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$f" | head -n 1)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && printf '%s (pid %s) ' "$(basename "$f" .json)" "$pid"
  done
  return 0
}
# Who started a process: the process, then up to 3 ancestors (names the agent's app).
describe_pids() {
  for p in $1; do
    ps -o pid=,lstart=,command= -p "$p" 2>/dev/null | cut -c1-200 | sed 's/^/  /'
    pp="$p"
    for _ in 1 2 3; do
      pp="$(ps -o ppid= -p "$pp" 2>/dev/null | tr -d ' ')"
      [ -n "$pp" ] && [ "$pp" != 1 ] || break
      ps -o pid=,command= -p "$pp" 2>/dev/null | cut -c1-160 | sed 's/^/    from: /'
    done
  done
}
# Agents' bridges to Responsively: node running the npm bootstrap (responsively-mcp) or an app's mcp/cli.js.
bridge_pids() {
  ps -axo pid=,command= | awk '$2 ~ /(^|\/)node$/ && $3 ~ /responsively-mcp$|Resources\/mcp\/cli\.js$/ {print $1}' | tr '\n' ' '
}
# Ends this gate's own processes (never its parent's): descendants first, then the gate.
stop_gate() {
  local me="${BASHPID:-}" kids
  kill_tree() { for c in $(pgrep -P "$1"); do kill_tree "$c"; done; [ "$1" = "$me" ] || kill -TERM "$1" 2>/dev/null; }
  for c in $(pgrep -P $$); do [ "$c" = "$me" ] || kill_tree "$c"; done
  kill -TERM $$ 2>/dev/null
}
# Names, last stop and last open of your Sessions: enough to explain a change, no URLs.
registry_summary() {
  node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const s of r.sessions??r)console.log(JSON.stringify({id:s.id,name:s.name,lastStop:s.lastStop,lastOpenedAt:s.lastOpenedAt}))}catch(e){console.log("unreadable: "+e.message)}' "$REAL_SESSIONS/sessions-registry.json"
}

# Every 5 s: if your installed app starts, a real runtime appears or your registry
# is written, stop the run now and record who did it, instead of failing 10 minutes later.
watch_real() {
  local reg_before leases_before reason pids
  reg_before="$(stat -f %m "$REAL_SESSIONS/sessions-registry.json" 2>/dev/null || echo none)"
  leases_before="$(ls -1 "$REAL_SESSIONS/runtimes" 2>/dev/null | sort | tr '\n' ' ')"
  while sleep 5; do
    reason=""
    pids="$(real_app_pids)"
    [ -z "${pids// /}" ] || reason="your installed Responsively started (PIDs $pids)"
    [ -n "$reason" ] || [ "$(ls -1 "$REAL_SESSIONS/runtimes" 2>/dev/null | sort | tr '\n' ' ')" = "$leases_before" ] ||
      reason="your Sessions' runtime list changed"
    [ -n "$reason" ] || [ "$(stat -f %m "$REAL_SESSIONS/sessions-registry.json" 2>/dev/null || echo none)" = "$reg_before" ] ||
      reason="your Sessions registry was written"
    if [ -n "$reason" ]; then
      { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $reason"; describe_pids "$pids"; } > "$EV/isolation-break.txt"
      # The build or the driver; the test app runs detached and finish stops it.
      stop_gate
      return
    fi
  done
}

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
  [ -z "${WATCH_PID:-}" ] || kill "$WATCH_PID" 2>/dev/null
  if [ -f "$EV/isolation-break.txt" ]; then
    log "STOPPED EARLY, ISOLATION BROKEN: $(head -n 1 "$EV/isolation-break.txt")"
    sed -n '2,$p' "$EV/isolation-break.txt" | tee -a "$EV/steps.log"
  fi
  stop_test_processes

  snapshot_real after
  if [ ! -f "$EV/real-before.txt" ]; then
    log "ISOLATION CHECK: not run (stopped before the first snapshot)"
  elif [ -f "$EV/isolation-break.txt" ] && cmp -s "$EV/real-before.txt" "$EV/real-after.txt"; then
    log "ISOLATION CHECK: NOT PROVEN (your app was active during the run; your files ended unchanged)"
  elif cmp -s "$EV/real-before.txt" "$EV/real-after.txt"; then
    ISOLATION=PASS
    log "ISOLATION PASS: installed app, your Sessions registry and runtime leases unchanged"
  else
    log "ISOLATION CHECK: DIFFERS (compare real-before.txt and real-after.txt)"
    # Say what changed, so the cause can be found without digging through logs.
    registry_summary > "$EV/real-registry-after.txt"
    {
      diff "$EV/real-before.txt" "$EV/real-after.txt"
      echo "Sessions changed (before → after):"
      diff "$EV/real-registry-before.txt" "$EV/real-registry-after.txt"
    } > "$EV/isolation-diff.txt" 2>&1
    sed 's/^/  /' "$EV/isolation-diff.txt" | tee -a "$EV/steps.log"
  fi
  [ -f "$EV/isolation-break.txt" ] && ISOLATION="broken"

  # The verdict comes after the isolation check: a run that changed your real
  # app, registry or leases fails even if every driver check passed.
  if [ "$DRIVER_EXIT" != "not run" ]; then
    STEP="result"
    if [ "$DRIVER_EXIT" -eq 0 ] && [ "$ISOLATION" = PASS ]; then
      VERDICT=PASS; log "GATE C: ALL CHECKS PASSED"
    elif [ "$DRIVER_EXIT" -eq 0 ]; then
      VERDICT=FAIL; log "GATE C: FAILED (isolation check did not pass)"
    else
      VERDICT=FAIL; log "GATE C: FAILED (see results.json)"
    fi
    # What gatef.sh reads: it installs only a commit whose Gate C run passed.
    {
      echo "COMMIT=$HEAD_SHA"
      echo "TREE=$HEAD_TREE"
      echo "ASAR_SHA=$(shasum -a 256 "$APP/Contents/Resources/app.asar" | awk '{print $1}')"
      echo "CLI_SHA=$(shasum -a 256 "$CLI" | awk '{print $1}')"
      echo "RESULT=$VERDICT"
      [ -z "$REUSE_RUN" ] || echo "BUILD_RUN=$REUSE_RUN"
    } | tee "$RUN/tested.env" > "$EV/tested.env"
    STEP="finish"
  fi

  # Lines the test controller/shell appended to the shared app-name log.
  log_sizes after
  if [ -f "$EV/shared-log-sizes-before.txt" ]; then
    added="$(paste "$EV/shared-log-sizes-before.txt" "$EV/shared-log-sizes-after.txt" | awk -F '\t' '{s+=$3-$1} END {print s+0}')"
    log "installed app's shared log: $added bytes written during this run (the test copy logs to data/logs; 0 expected unless your app or an older build wrote)"
  fi
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
  [ "${VERDICT:-}" = FAIL ] && [ "$code" -eq 0 ] && exit 1
  exit "$code"
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

# Isolation can only be proven if your app stays untouched for the whole run.
PIDS="$(real_app_pids)"
if [ -n "${PIDS// /}" ]; then
  log "FAIL: your installed Responsively is running. Quit it from its menu-bar icon, then run Gate C again:"
  describe_pids "$PIDS" | tee -a "$EV/steps.log"
  exit 1
fi
LIVE="$(live_real_leases)"
[ -z "$LIVE" ] || { log "FAIL: a real Session runtime is still alive: $LIVE. Quit Responsively, then run Gate C again."; exit 1; }
BRIDGES="$(bridge_pids)"
if [ -n "${BRIDGES// /}" ]; then
  log "note: agent bridges to Responsively are connected (idle is fine; one used meanwhile would start your app and stop this run):"
  describe_pids "$BRIDGES" | tee -a "$EV/steps.log"
fi
snapshot_real before
registry_summary > "$EV/real-registry-before.txt"
log_sizes before
watch_real &
WATCH_PID=$!

if [ -n "$REUSE_RUN" ]; then
  STEP="reuse"
  PREV="$HOME/ResponsivelyGateC/$REUSE_RUN"
  [ -f "$PREV/evidence/package-hashes.txt" ] || { log "FAIL: $PREV has no evidence/package-hashes.txt"; exit 1; }
  HEAD_SHA="$(git -C "$PREV/repo" rev-parse HEAD)"
  HEAD_TREE="$(git -C "$PREV/repo" rev-parse HEAD^{tree})"
  log "reusing the build of $REUSE_RUN: HEAD=$HEAD_SHA tree=$HEAD_TREE"
  [ "$HEAD_SHA" = "$EXPECTED_SHA" ] || { log "FAIL: $REUSE_RUN was built from another commit"; exit 1; }
  FOUND="$(find "$PREV/repo/desktop-app/.work/gatec-${REUSE_RUN}/build" -maxdepth 2 -type d -name 'ResponsivelyApp.app' 2>/dev/null | head -n 1 || true)"
  [ -n "$FOUND" ] || { log "FAIL: no ResponsivelyApp.app in $REUSE_RUN"; exit 1; }
  APP="$FOUND"
  # Same files in the same order: their hashes must match what that run recorded when it built them.
  shasum -a 256 "$APP/Contents/Resources/app.asar" "$APP/Contents/Resources/mcp/cli.js" > "$EV/package-hashes.txt"
  [ "$(awk '{print $1}' "$EV/package-hashes.txt")" = "$(awk '{print $1}' "$PREV/evidence/package-hashes.txt")" ] || {
    log "FAIL: the app in $REUSE_RUN changed since it was built"
    exit 1
  }
  # The reused app keeps the bundle ID it was built with.
  APP_ID="app.responsively.validation-${REUSE_RUN}"
  log "app.asar and bridge unchanged since $REUSE_RUN built them"
else
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
fi
CLI="$APP/Contents/Resources/mcp/cli.js"
BUNDLE_ID="$(/usr/bin/defaults read "$APP/Contents/Info.plist" CFBundleIdentifier)"
log "app=$APP bundleId=$BUNDLE_ID"
[ "$BUNDLE_ID" = "$APP_ID" ] || { log "FAIL: unexpected bundle id"; exit 1; }
/usr/bin/codesign --verify --deep --strict "$APP" > "$EV/codesign.log" 2>&1
grep -q "stopped answering on its MCP port" "$CLI" || { log "FAIL: packaged bridge lacks the routing code"; exit 1; }
grep -q "is not answering on port" "$CLI" || { log "FAIL: packaged bridge lacks the log fix (#13)"; exit 1; }
grep -q "attention" "$CLI" || { log "FAIL: packaged bridge lacks the M6 attention request"; exit 1; }
log "packaged bridge contains the routing code, the log fix and the attention request"
[ -n "$REUSE_RUN" ] || shasum -a 256 "$APP/Contents/Resources/app.asar" "$CLI" > "$EV/package-hashes.txt"
cat "$EV/package-hashes.txt"

STEP="driver"
STALE_PORT="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
log "bridge configured with stale port $STALE_PORT (nothing listens there)"
set +e
mkdir -p "$DATA/logs"
node "$DRIVER" --cli "$CLI" --app "$APP" --root "$DATA/sessions-root" \
  --shell-data "$DATA/shell-data" --out "$EV" --stale-port "$STALE_PORT" \
  --expected-exe "$APP/Contents/MacOS/ResponsivelyApp" --log-dir "$DATA/logs" 2> "$EV/driver.log"
DRIVER_EXIT=$?
set -e
grep '^\[gatec\]' "$EV/driver.log" | tee -a "$EV/steps.log" || true

exit "$DRIVER_EXIT"
