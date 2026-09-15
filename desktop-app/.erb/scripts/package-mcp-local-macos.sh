#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$APP_DIR/release/build/mcp-local"

APP_ID="app.responsively.mcp.local"
BUILT_NAME="ResponsivelyApp.app"

INSTALL_DIR="$HOME/Applications"
INSTALL_APP="$INSTALL_DIR/ResponsivelyMCP.app"
INSTALL_TMP="$INSTALL_DIR/.ResponsivelyMCP.app.new"

cd "$APP_DIR"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This package target is macOS-only."
  exit 1
fi

if [ "$(uname -m)" != "arm64" ]; then
  echo "This package target currently expects Apple Silicon arm64."
  exit 1
fi

echo '=== BUILD APPLICATION ==='

npx -y yarn@1.22.22 build

echo '=== PACKAGE ISOLATED MCP APP ==='

rm -rf "$OUT"

CI=false \
CSC_IDENTITY_AUTO_DISCOVERY=false \
./node_modules/.bin/electron-builder \
  --mac \
  --arm64 \
  --dir \
  --publish never \
  -c.appId="$APP_ID" \
  -c.directories.output="release/build/mcp-local" \
  -c.mac.identity=- \
  -c.mac.hardenedRuntime=true \
  -c.mac.entitlements="assets/entitlements.mcp.local.plist" \
  -c.mac.entitlementsInherit="assets/entitlements.mcp.local.plist"

BUILT_COUNT="$(
  find "$OUT" \
    -maxdepth 2 \
    -type d \
    -name "$BUILT_NAME" \
    -print \
    | wc -l \
    | tr -d ' '
)"

if [ "$BUILT_COUNT" -ne 1 ]; then
  printf 'Expected exactly one %s, found %s\n' \
    "$BUILT_NAME" \
    "$BUILT_COUNT"
  exit 1
fi

BUILT_APP="$(
  find "$OUT" \
    -maxdepth 2 \
    -type d \
    -name "$BUILT_NAME" \
    -print \
    | head -n 1
)"
EXEC="$BUILT_APP/Contents/MacOS/ResponsivelyApp"

echo '=== VERIFY BUILT APP ==='

test -x "$EXEC"

BUNDLE_ID="$(
  /usr/bin/defaults read \
    "$BUILT_APP/Contents/Info.plist" \
    CFBundleIdentifier
)"

BUNDLE_EXEC="$(
  /usr/bin/defaults read \
    "$BUILT_APP/Contents/Info.plist" \
    CFBundleExecutable
)"

printf 'BUNDLE_ID=%s\n' "$BUNDLE_ID"
printf 'BUNDLE_EXECUTABLE=%s\n' "$BUNDLE_EXEC"

test "$BUNDLE_ID" = "$APP_ID"
test "$BUNDLE_EXEC" = "ResponsivelyApp"

/usr/bin/file "$EXEC" | grep -q 'arm64'

/usr/bin/codesign \
  --verify \
  --deep \
  --strict \
  --verbose=2 \
  "$BUILT_APP"

ENTITLEMENTS="$(
  /usr/bin/codesign \
    -d \
    --entitlements :- \
    "$BUILT_APP" \
    2>&1
)"

printf '%s\n' "$ENTITLEMENTS" \
  | grep -q 'com.apple.security.cs.disable-library-validation'

echo '=== INSTALL TO USER APPLICATIONS ==='

mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_TMP"

/usr/bin/ditto "$BUILT_APP" "$INSTALL_TMP"

TMP_ID="$(
  /usr/bin/defaults read \
    "$INSTALL_TMP/Contents/Info.plist" \
    CFBundleIdentifier
)"

test "$TMP_ID" = "$APP_ID"

/usr/bin/codesign \
  --verify \
  --deep \
  --strict \
  "$INSTALL_TMP"

if [ -e "$INSTALL_APP" ]; then
  EXISTING_ID="$(
    /usr/bin/defaults read \
      "$INSTALL_APP/Contents/Info.plist" \
      CFBundleIdentifier \
      2>/dev/null \
      || true
  )"

  if [ "$EXISTING_ID" != "$APP_ID" ]; then
    echo "Refusing to replace unexpected app at:"
    echo "$INSTALL_APP"
    echo "Existing bundle ID: $EXISTING_ID"
    exit 1
  fi

  rm -rf "$INSTALL_APP"
fi

mv "$INSTALL_TMP" "$INSTALL_APP"

echo '=== FINAL INSTALLED APP ==='

FINAL_ID="$(
  /usr/bin/defaults read \
    "$INSTALL_APP/Contents/Info.plist" \
    CFBundleIdentifier
)"

FINAL_EXEC="$(
  /usr/bin/defaults read \
    "$INSTALL_APP/Contents/Info.plist" \
    CFBundleExecutable
)"

test "$FINAL_ID" = "$APP_ID"
test "$FINAL_EXEC" = "ResponsivelyApp"
test -x "$INSTALL_APP/Contents/MacOS/ResponsivelyApp"

/usr/bin/codesign \
  --verify \
  --deep \
  --strict \
  "$INSTALL_APP"

printf 'INSTALLED_APP=%s\n' "$INSTALL_APP"
printf 'BUNDLE_ID=%s\n' "$FINAL_ID"
printf 'EXECUTABLE=%s\n' "$FINAL_EXEC"

echo 'MCP_LOCAL_PACKAGE=PASS'
