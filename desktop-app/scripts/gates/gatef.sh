#!/usr/bin/env bash
# Gate F: install a commit that passed Gate C as ~/Applications/ResponsivelyMCP.app,
# backup first. Three phases, each run separately and in order:
#
#   bash gatef.sh prepare <gatec-run> <install-run>
#       builds the commit that Gate C run tested, with the installed app's
#       bundle ID, and verifies it (safe while the app runs). Refuses unless
#       ~/ResponsivelyGateC/<gatec-run>/tested.env says RESULT=PASS, and unless
#       the new bridge is byte-identical to the one Gate C tested.
#   bash gatef.sh backup <install-run>
#       requires the app fully quit and unchanged since prepare; copies the app
#       and both data folders and verifies every file by SHA-256.
#   bash gatef.sh replace <install-run>
#       stages, swaps, verifies; the old app is kept in the backup as .replaced.
#
# Nothing is ever deleted. Everything lives under $HOME/ResponsivelyGateF/<install-run>/.
set -euo pipefail

usage() {
  echo "Usage: bash gatef.sh prepare <gatec-run> <install-run> | backup <install-run> | replace <install-run>"
  exit 2
}
PHASE="${1:-}"
case "$PHASE" in
  prepare) GATEC_RUN="${2:-}"; RUN_NAME="${3:-}"; [ -n "$GATEC_RUN" ] || usage ;;
  backup | replace) RUN_NAME="${2:-}" ;;
  *) usage ;;
esac
[ -n "$RUN_NAME" ] || usage
REPO_URL="https://github.com/FilippoRomeo/responsively-app.git"
APP_ID="app.responsively.mcp.local"
# Reads KEY=value from a file this workflow wrote; never sources it.
val() { sed -n "s/^$2=//p" "$1" | head -n 1; }

RUN="$HOME/ResponsivelyGateF/$RUN_NAME"
EV="$RUN/evidence"
REPO="$RUN/repo"
CACHES="$RUN/caches"
TARGET="$RUN/target.env"

# The commit and hashes come from the Gate C run at prepare, then from target.env.
if [ "$PHASE" = prepare ]; then
  TESTED="$HOME/ResponsivelyGateC/$GATEC_RUN/tested.env"
  [ -f "$TESTED" ] || { echo "No Gate C result at $TESTED"; exit 2; }
  [ "$(val "$TESTED" RESULT)" = PASS ] || { echo "Gate C run $GATEC_RUN did not pass; refusing to install it"; exit 2; }
  SOURCE="$TESTED"
else
  [ -f "$TARGET" ] || { echo "Run prepare first."; exit 2; }
  SOURCE="$TARGET"
fi
EXPECTED_SHA="$(val "$SOURCE" COMMIT)"
EXPECTED_TREE="$(val "$SOURCE" TREE)"
TESTED_CLI_SHA="$(val "$SOURCE" CLI_SHA)"
# Gate C builds with its own appId; app.asar is recorded, not enforced.
GATEC_ASAR_SHA="$(val "$SOURCE" ASAR_SHA)"
printf '%s' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo "Invalid COMMIT in $SOURCE"; exit 2; }
BUILD_REL=".work/install-main-${EXPECTED_SHA:0:7}/build"

INSTALL="$HOME/Applications/ResponsivelyMCP.app"
STAGE="$HOME/Applications/.ResponsivelyMCP.app.new"
DATA_MCP="$HOME/Library/Application Support/ResponsivelyMCP"
DATA_SESSIONS="$HOME/Library/Application Support/ResponsivelySessions"

STEP="$PHASE"
log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STEP" "$*" | tee -a "$EV/steps.log"; }
fail() { log "FAIL: $*"; exit 1; }
esc() { printf '%s' "$1" | sed 's/[][\.*^$()+?{}|]/\\&/g'; }
sha() { shasum -a 256 "$1" | awk '{print $1}'; }

pack() {
  local code=$?
  set +e
  log "phase $PHASE exit code: $code"
  local out="$RUN/gatef-$RUN_NAME-$PHASE-$(date -u +%Y%m%dT%H%M%SZ)-evidence.tgz"
  tar -czf "$out" -C "$RUN" evidence
  log "evidence: $out $(sha "$out")"
}

# The installed app must be fully quit: no Electron process from the bundle,
# no live Session runtime, no open files in either data folder.
quit_check() {
  local busy=0 lease pid
  if pgrep -fl "$(esc "$INSTALL/Contents/MacOS/")|$(esc "$INSTALL/Contents/Frameworks/")" \
    > "$EV/$1-app-processes.txt"; then busy=1; fi
  pgrep -fl "$(esc "$INSTALL/Contents/Resources/mcp/cli.js")" > "$EV/$1-bridge-processes.txt" || true
  : > "$EV/$1-live-leases.txt"
  for lease in "$DATA_SESSIONS"/runtimes/*.json; do
    if [ ! -f "$lease" ]; then continue; fi
    pid="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pid' "$lease" 2>/dev/null || echo "")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "$pid $lease" >> "$EV/$1-live-leases.txt"; busy=1; fi
  done
  : > "$EV/$1-open-files.txt"
  for d in "$DATA_MCP" "$DATA_SESSIONS"; do
    if [ -d "$d" ]; then lsof -nP +D "$d" >> "$EV/$1-open-files.txt" 2>/dev/null || true; fi
  done
  if [ -s "$EV/$1-open-files.txt" ]; then busy=1; fi
  if [ "$busy" -ne 0 ]; then
    log "the app is still running (see $1-app-processes.txt, $1-live-leases.txt, $1-open-files.txt)"
    fail "quit Responsively fully from the menu-bar icon (Quit Responsively), wait 20 s, then rerun: bash gatef.sh $PHASE $RUN_NAME"
  fi
  if [ -s "$EV/$1-bridge-processes.txt" ]; then
    log "note: Claude Desktop's MCP bridge still has the old cli.js loaded; restart Claude Desktop after replace"
  fi
  log "app fully quit: no app processes, no live leases, no open files in the data folders"
}

manifest() { (cd "$1" && find . -type f -print0 | xargs -0 shasum -a 256 | sort -k2); }

copy_verified() { # src dest-name
  local dest="$BACKUP/$2"
  /usr/bin/ditto "$1" "$dest"
  manifest "$1" > "$EV/backup-$2.source.sha256"
  manifest "$dest" > "$EV/backup-$2.copy.sha256"
  cmp -s "$EV/backup-$2.source.sha256" "$EV/backup-$2.copy.sha256" || fail "backup of $1 does not match its source"
  log "backed up and verified $(wc -l < "$EV/backup-$2.source.sha256" | tr -d ' ') files: $1 -> $dest"
}

case "$PHASE" in
  prepare)
    [ -e "$RUN" ] && { echo "Refusing to reuse $RUN. Pass a new install-run name."; exit 2; }
    mkdir -p "$EV" "$CACHES"
    cp "$TESTED" "$EV/gatec-tested.env"
    trap pack EXIT
    export npm_config_cache="$CACHES/npm" YARN_CACHE_FOLDER="$CACHES/yarn"
    export electron_config_cache="$CACHES/electron" ELECTRON_BUILDER_CACHE="$CACHES/electron-builder"
    export npm_config_devdir="$CACHES/node-gyp"
    [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] || fail "macOS arm64 required"
    [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || fail "Node >= 24 required"
    log "node $(node --version); installing $EXPECTED_SHA, which Gate C run $GATEC_RUN passed"
    shasum -a 256 "${BASH_SOURCE[0]}" | tee "$EV/script.sha256"
    git clone "$REPO_URL" "$REPO" > "$EV/clone.log" 2>&1
    git -C "$REPO" checkout --detach "$EXPECTED_SHA" >> "$EV/clone.log" 2>&1
    [ "$(git -C "$REPO" rev-parse HEAD^{tree})" = "$EXPECTED_TREE" ] || fail "tree differs from the Gate C tested tree"
    log "HEAD=$(git -C "$REPO" rev-parse HEAD) tree=$EXPECTED_TREE (same tree Gate C tested)"
    cd "$REPO/desktop-app"
    log "yarn install"
    npx -y yarn@1.22.22 install --frozen-lockfile > "$EV/install.log" 2>&1
    log "yarn build"
    rm -rf "$REPO/desktop-app/release/app/dist"
    npx -y yarn@1.22.22 build > "$EV/build.log" 2>&1
    log "electron-builder, appId $APP_ID"
    CI=false CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder \
      --mac --arm64 --dir --publish never \
      -c.appId="$APP_ID" \
      -c.directories.output="$BUILD_REL" \
      -c.mac.identity=- \
      -c.mac.hardenedRuntime=true \
      -c.mac.entitlements="assets/entitlements.mcp.local.plist" \
      -c.mac.entitlementsInherit="assets/entitlements.mcp.local.plist" \
      > "$EV/package.log" 2>&1
    NEW="$(find "$REPO/desktop-app/$BUILD_REL" -maxdepth 2 -type d -name 'ResponsivelyApp.app' | head -n 1)"
    case "$NEW" in "$RUN"/*) ;; *) fail "built app not found inside the run folder" ;; esac
    [ "$(/usr/bin/defaults read "$NEW/Contents/Info.plist" CFBundleIdentifier)" = "$APP_ID" ] || fail "bundle id"
    [ "$(/usr/bin/defaults read "$NEW/Contents/Info.plist" CFBundleExecutable)" = "ResponsivelyApp" ] || fail "executable name"
    /usr/bin/file "$NEW/Contents/MacOS/ResponsivelyApp" | grep -q arm64 || fail "not arm64"
    /usr/bin/codesign --verify --deep --strict "$NEW" > "$EV/codesign.log" 2>&1 || fail "codesign"
    /usr/bin/codesign -d --entitlements :- "$NEW" 2>&1 | grep -q disable-library-validation || fail "entitlements"
    [ -f "$NEW/Contents/Resources/mcp/manifest.json" ] || fail "MCP manifest missing"
    CLI_SHA="$(sha "$NEW/Contents/Resources/mcp/cli.js")"
    [ "$CLI_SHA" = "$TESTED_CLI_SHA" ] || fail "cli.js $CLI_SHA is not the bridge Gate C tested"
    log "version $(/usr/bin/defaults read "$NEW/Contents/Info.plist" CFBundleShortVersionString); cli.js = Gate C tested bridge"
    if [ "$(sha "$NEW/Contents/Resources/app.asar")" = "$GATEC_ASAR_SHA" ]; then
      log "app.asar is byte-identical to Gate C run $GATEC_RUN"
    else
      log "note: app.asar differs from Gate C run $GATEC_RUN ($GATEC_ASAR_SHA); same commit, different appId build"
    fi
    {
      echo "new_asar $(sha "$NEW/Contents/Resources/app.asar")"
      echo "new_cli $CLI_SHA"
      [ -f "$INSTALL/Contents/Resources/app.asar" ] && echo "installed_asar $(sha "$INSTALL/Contents/Resources/app.asar")"
      [ -f "$INSTALL/Contents/Resources/mcp/cli.js" ] && echo "installed_cli $(sha "$INSTALL/Contents/Resources/mcp/cli.js")"
      true
    } | tee "$EV/hashes.txt"
    INSTALLED_ASAR=none
    [ -f "$INSTALL/Contents/Resources/app.asar" ] && INSTALLED_ASAR="$(sha "$INSTALL/Contents/Resources/app.asar")"
    {
      echo "COMMIT=$EXPECTED_SHA"
      echo "TREE=$EXPECTED_TREE"
      echo "CLI_SHA=$TESTED_CLI_SHA"
      echo "ASAR_SHA=$GATEC_ASAR_SHA"
      echo "INSTALLED_ASAR=$INSTALLED_ASAR"
    } > "$TARGET"
    cp "$TARGET" "$EV/target.env"
    echo "$NEW" > "$RUN/prepare.ok"
    log "PREPARE PASS. Next: quit Responsively from its menu-bar icon, then: bash gatef.sh backup $RUN_NAME"
    ;;

  backup)
    [ -f "$RUN/prepare.ok" ] || { echo "Run prepare first."; exit 2; }
    [ -f "$RUN/backup.ok" ] && { echo "Backup already done: $(cat "$RUN/backup.ok")"; exit 2; }
    trap pack EXIT
    BACKUP="$RUN/backup-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$BACKUP"
    quit_check backup
    [ -d "$INSTALL" ] || fail "no installed app at $INSTALL"
    # The backup must be of the app prepare saw, not one swapped in since.
    [ "$(sha "$INSTALL/Contents/Resources/app.asar")" = "$(val "$TARGET" INSTALLED_ASAR)" ] || fail "the installed app changed since prepare"
    copy_verified "$INSTALL" ResponsivelyMCP.app
    if [ -d "$DATA_MCP" ]; then copy_verified "$DATA_MCP" ResponsivelyMCP; else log "no $DATA_MCP"; fi
    if [ -d "$DATA_SESSIONS" ]; then copy_verified "$DATA_SESSIONS" ResponsivelySessions; else log "no $DATA_SESSIONS"; fi
    echo "$BACKUP" > "$RUN/backup.ok"
    log "BACKUP PASS: $BACKUP. Next: bash gatef.sh replace $RUN_NAME"
    ;;

  replace)
    [ -f "$RUN/backup.ok" ] || { echo "Run backup first."; exit 2; }
    [ -f "$RUN/replace.ok" ] && { echo "Replace already done."; exit 2; }
    trap pack EXIT
    NEW="$(cat "$RUN/prepare.ok")"
    BACKUP="$(cat "$RUN/backup.ok")"
    quit_check replace
    [ -e "$STAGE" ] && fail "$STAGE already exists; inspect it, then move it aside"
    [ -e "$BACKUP/ResponsivelyMCP.app.replaced" ] && fail "old app already moved aside"
    /usr/bin/ditto "$NEW" "$STAGE"
    [ "$(/usr/bin/defaults read "$STAGE/Contents/Info.plist" CFBundleIdentifier)" = "$APP_ID" ] || fail "staged bundle id"
    /usr/bin/codesign --verify --deep --strict "$STAGE" || fail "staged codesign"
    [ "$(sha "$STAGE/Contents/Resources/mcp/cli.js")" = "$TESTED_CLI_SHA" ] || fail "staged cli.js"
    log "staged and verified $STAGE"
    mv "$INSTALL" "$BACKUP/ResponsivelyMCP.app.replaced"
    mv "$STAGE" "$INSTALL"
    [ "$(sha "$INSTALL/Contents/Resources/mcp/cli.js")" = "$TESTED_CLI_SHA" ] || fail "installed cli.js"
    [ "$(sha "$INSTALL/Contents/Resources/app.asar")" = "$(sha "$NEW/Contents/Resources/app.asar")" ] || fail "installed app.asar"
    /usr/bin/codesign --verify --deep --strict "$INSTALL" || fail "installed codesign"
    echo "done" > "$RUN/replace.ok"
    log "REPLACE PASS. Old app kept at $BACKUP/ResponsivelyMCP.app.replaced"
    log "Rollback, if ever needed (quit the app first):"
    log "  mv \"$INSTALL\" \"$RUN/rolled-back-${EXPECTED_SHA:0:7}.app\" && mv \"$BACKUP/ResponsivelyMCP.app.replaced\" \"$INSTALL\""
    log "Next: restart Claude Desktop (loads the new bridge), open Responsively, then run the smoke test"
    ;;

  *)
    usage
    ;;
esac
