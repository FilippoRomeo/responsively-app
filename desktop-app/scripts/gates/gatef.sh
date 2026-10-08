#!/usr/bin/env bash
# Gate F: install a commit that passed Gate C as ~/Applications/ResponsivelyMCP.app,
# backup first. Three phases, each run separately and in order:
#
#   bash gatef.sh prepare --auto <full-commit-sha> <install-run>
#       the whole check in one step, no Terminal and no questions: builds the
#       commit once, packages it with the installed app's bundle ID, then packages
#       the same build again with a test bundle ID and runs Gate C's automated
#       checks on that copy (gatec.sh --from-repo --no-questions: isolation,
#       Session routing, stop, force quit; the 3 questions that need your eyes are
#       skipped). Needs Responsively quit, which backup needs anyway. Refuses unless
#       those checks pass and both packages hold the same app.asar and bridge.
#   bash gatef.sh prepare <gatec-run> <install-run>
#       builds the commit that Gate C run tested, with the installed app's
#       bundle ID, and verifies it (safe while the app runs). Refuses unless
#       ~/ResponsivelyGateC/<gatec-run>/tested.env says RESULT=PASS, and unless
#       the new bridge is byte-identical to the one Gate C tested.
#   bash gatef.sh backup <install-run>
#       requires the app fully quit and unchanged since prepare; keeps the app
#       as a zip and copies both data folders, verifying every file and link.
#   bash gatef.sh replace <install-run>
#       stages, swaps, verifies; then moves the old app and the build output to
#       the Trash (the zip in the backup is the rollback copy).
#
# No unpacked copy of the app is left behind: macOS launches any bundle with
# the same ID, so a backup could open instead of the installed app. Nothing
# else is deleted. Everything lives under $HOME/ResponsivelyGateF/<install-run>/.
set -euo pipefail

usage() {
  echo "Usage: bash gatef.sh prepare --auto <sha> <install-run> | prepare <gatec-run> <install-run> | backup <install-run> | replace <install-run>"
  exit 2
}
PHASE="${1:-}"
case "$PHASE" in
  prepare)
    AUTO=""
    if [ "${2:-}" = "--auto" ]; then AUTO=1; AUTO_SHA="${3:-}"; RUN_NAME="${4:-}"; GATEC_RUN="auto"
    else GATEC_RUN="${2:-}"; RUN_NAME="${3:-}"; [ -n "$GATEC_RUN" ] || usage; fi ;;
  backup | replace) RUN_NAME="${2:-}" ;;
  *) usage ;;
esac
[ -n "$RUN_NAME" ] || usage
# An interrupted phase must be logged as a failure, never as exit code 0.
trap 'exit 130' INT TERM
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
if [ "$PHASE" = prepare ] && [ -n "$AUTO" ]; then
  # The automated Gate C run happens inside prepare; its result is read then.
  printf '%s' "$AUTO_SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo "--auto needs the full 40-character commit SHA"; exit 2; }
  TESTED=""
  SOURCE=""
elif [ "$PHASE" = prepare ]; then
  TESTED="$HOME/ResponsivelyGateC/$GATEC_RUN/tested.env"
  [ -f "$TESTED" ] || { echo "No Gate C result at $TESTED"; exit 2; }
  [ "$(val "$TESTED" RESULT)" = PASS ] || { echo "Gate C run $GATEC_RUN did not pass; refusing to install it"; exit 2; }
  SOURCE="$TESTED"
else
  [ -f "$TARGET" ] || { echo "Run prepare first."; exit 2; }
  SOURCE="$TARGET"
fi
if [ -n "${AUTO:-}" ] && [ "$PHASE" = prepare ]; then
  EXPECTED_SHA="$AUTO_SHA"; EXPECTED_TREE=""; TESTED_CLI_SHA=""; GATEC_ASAR_SHA=""
else
  EXPECTED_SHA="$(val "$SOURCE" COMMIT)"
  EXPECTED_TREE="$(val "$SOURCE" TREE)"
  TESTED_CLI_SHA="$(val "$SOURCE" CLI_SHA)"
  # Gate C builds with its own appId; app.asar is recorded, not enforced.
  GATEC_ASAR_SHA="$(val "$SOURCE" ASAR_SHA)"
fi
printf '%s' "$EXPECTED_SHA" | grep -Eq '^[0-9a-f]{40}$' || { echo "Invalid COMMIT in ${SOURCE:-the arguments}"; exit 2; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# Every file's SHA-256 and every symlink's target (app frameworks are full of links).
manifest() {
  (cd "$1" && {
    find . -type f -print0 | xargs -0 shasum -a 256
    find . -type l | while IFS= read -r link; do printf 'link:%s  %s\n' "$(readlink "$link")" "$link"; done
  } | sort -k2)
}

# To Finder's Trash (recoverable), never rm.
to_trash() {
  /usr/bin/osascript -e 'on run argv' -e 'tell application "Finder"' -e 'repeat with p in argv' \
    -e 'delete (POSIX file (p as text) as alias)' -e 'end repeat' -e 'end tell' -e 'end run' "$@" > /dev/null
}

copy_verified() { # src dest-name
  local dest="$BACKUP/$2"
  /usr/bin/ditto "$1" "$dest"
  manifest "$1" > "$EV/backup-$2.source.sha256"
  manifest "$dest" > "$EV/backup-$2.copy.sha256"
  cmp -s "$EV/backup-$2.source.sha256" "$EV/backup-$2.copy.sha256" || fail "backup of $1 does not match its source"
  log "backed up and verified $(wc -l < "$EV/backup-$2.source.sha256" | tr -d ' ') files: $1 -> $dest"
}

zip_verified() { # app dest-zip-name: a zip macOS can't launch, checked by unpacking it
  local zip="$BACKUP/$2" check="$RUN/.zip-check"
  /usr/bin/ditto -c -k --keepParent "$1" "$zip"
  rm -rf "$check" && mkdir -p "$check"
  /usr/bin/ditto -x -k "$zip" "$check"
  manifest "$1" > "$EV/backup-$2.source.sha256"
  manifest "$check/$(basename "$1")" > "$EV/backup-$2.copy.sha256"
  rm -rf "$check"
  cmp -s "$EV/backup-$2.source.sha256" "$EV/backup-$2.copy.sha256" || fail "zip of $1 does not match its source"
  log "backed up and verified $(wc -l < "$EV/backup-$2.source.sha256" | tr -d ' ') files and links: $1 -> $zip"
}

case "$PHASE" in
  prepare)
    [ -e "$RUN" ] && { echo "Refusing to reuse $RUN. Pass a new install-run name."; exit 2; }
    mkdir -p "$EV" "$CACHES"
    [ -z "$TESTED" ] || cp "$TESTED" "$EV/gatec-tested.env"
    trap pack EXIT
    if [ -n "$AUTO" ] && pgrep -f "$(esc "$INSTALL/Contents/")" > /dev/null; then
      fail "Responsively is running. Quit it from its menu-bar icon first: the automated checks need it quit (and the backup after them does too)."
    fi
    export npm_config_cache="$CACHES/npm" YARN_CACHE_FOLDER="$CACHES/yarn"
    export electron_config_cache="$CACHES/electron" ELECTRON_BUILDER_CACHE="$CACHES/electron-builder"
    export npm_config_devdir="$CACHES/node-gyp"
    [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] || fail "macOS arm64 required"
    [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || fail "Node >= 24 required"
    if [ -n "$AUTO" ]; then log "node $(node --version); installing $EXPECTED_SHA after its own automated checks"
    else log "node $(node --version); installing $EXPECTED_SHA, which Gate C run $GATEC_RUN passed"; fi
    shasum -a 256 "${BASH_SOURCE[0]}" | tee "$EV/script.sha256"
    git clone "$REPO_URL" "$REPO" > "$EV/clone.log" 2>&1
    git -C "$REPO" checkout --detach "$EXPECTED_SHA" >> "$EV/clone.log" 2>&1
    if [ -n "$AUTO" ]; then
      EXPECTED_TREE="$(git -C "$REPO" rev-parse HEAD^{tree})"
      log "HEAD=$(git -C "$REPO" rev-parse HEAD) tree=$EXPECTED_TREE"
    else
      [ "$(git -C "$REPO" rev-parse HEAD^{tree})" = "$EXPECTED_TREE" ] || fail "tree differs from the Gate C tested tree"
      log "HEAD=$(git -C "$REPO" rev-parse HEAD) tree=$EXPECTED_TREE (same tree Gate C tested)"
    fi
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
    if [ -n "$AUTO" ]; then
      GC="c-auto-${RUN_NAME}"
      log "automated checks on a test copy of this exact build (keep Responsively quit; about 2 minutes)"
      bash "$SCRIPT_DIR/gatec.sh" "$EXPECTED_SHA" "$GC" --from-repo "$REPO" --no-questions > "$EV/gatec-auto.out" 2>&1 || true
      TESTED="$HOME/ResponsivelyGateC/$GC/tested.env"
      if [ ! -f "$TESTED" ] || [ "$(val "$TESTED" RESULT)" != PASS ]; then
        sed -n '/\[gatec\] FAIL/p;/STOPPED EARLY/p;/FAIL:/p;/ISOLATION/p' "$HOME/ResponsivelyGateC/$GC/evidence/steps.log" 2>/dev/null | tail -8 | tee -a "$EV/steps.log"
        fail "the automated checks did not pass: $HOME/ResponsivelyGateC/$GC/evidence"
      fi
      cp "$TESTED" "$EV/gatec-tested.env"
      TESTED_CLI_SHA="$(val "$TESTED" CLI_SHA)"
      GATEC_ASAR_SHA="$(val "$TESTED" ASAR_SHA)"
      GATEC_RUN="$GC"
      log "automated checks passed ($(grep -c '^\[gatec\] PASS' "$HOME/ResponsivelyGateC/$GC/evidence/steps.log") checks, isolation intact; the 3 questions skipped)"
    fi
    CLI_SHA="$(sha "$NEW/Contents/Resources/mcp/cli.js")"
    [ "$CLI_SHA" = "$TESTED_CLI_SHA" ] || fail "cli.js $CLI_SHA is not the bridge Gate C tested"
    log "version $(/usr/bin/defaults read "$NEW/Contents/Info.plist" CFBundleShortVersionString); cli.js = Gate C tested bridge"
    if [ "$(sha "$NEW/Contents/Resources/app.asar")" = "$GATEC_ASAR_SHA" ]; then
      log "app.asar is byte-identical to Gate C run $GATEC_RUN"
    elif [ -n "$AUTO" ]; then
      fail "app.asar differs between the test copy and the install package of the same build"
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
    zip_verified "$INSTALL" ResponsivelyMCP.app.zip
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
    # Only the app the backup zipped may be moved aside (and then trashed).
    [ "$(sha "$INSTALL/Contents/Resources/app.asar")" = "$(val "$TARGET" INSTALLED_ASAR)" ] || fail "the installed app changed since backup"
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
    # Unpacked copies with the same bundle ID could be launched instead of the new app.
    if to_trash "$BACKUP/ResponsivelyMCP.app.replaced" "$NEW"; then
      log "moved the old app and the build output to the Trash"
    else
      log "WARNING: move these to the Trash before opening Responsively: $BACKUP/ResponsivelyMCP.app.replaced $NEW"
    fi
    log "REPLACE PASS. Old app kept as a verified zip: $BACKUP/ResponsivelyMCP.app.zip"
    log "Rollback, if ever needed (quit the app first):"
    log "  osascript -e 'tell application \"Finder\" to delete POSIX file \"$INSTALL\"' && ditto -x -k \"$BACKUP/ResponsivelyMCP.app.zip\" \"$(dirname "$INSTALL")\""
    log "Next: restart Claude Desktop (loads the new bridge), open Responsively, then run the smoke test"
    ;;

  *)
    usage
    ;;
esac
