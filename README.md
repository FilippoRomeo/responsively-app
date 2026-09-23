# Responsively Sessions

A maintained fork of [responsively-org/responsively-app](https://github.com/responsively-org/responsively-app) focused on **persistent, isolated browser Sessions** and reliable **MCP-driven development workflows**.

This is not an official Responsively release. The original Responsively project, website and general-purpose downloads remain upstream.

## Why this fork exists

The upstream app is designed as one responsive-development browser. This fork adds a project/session layer so one installed app can safely serve several independent projects without sharing browser state or taking over each other's MCP runtime.

Each Session has its own:

- persistent browser profile and storage;
- process;
- MCP and BrowserSync runtime ports;
- device choices and browsing state;
- stable UUID and human-readable name.

A single controller owns the Session registry and lifecycle. Session identity never depends on a PID or temporary port.

## What is different from upstream

| Area | Upstream Responsively | This fork |
| --- | --- | --- |
| Project isolation | One app/browser context | Named persistent Sessions with separate profiles/processes |
| Session lifecycle | Not applicable | Create, Open, Focus, Stop, Rename, Reset and Delete |
| Launcher | Normal app launch | Native macOS menu-bar/Dock Session launcher |
| Restore | App-level state | Reopens only Sessions that were active at the last clean Quit |
| MCP lifecycle | Browser tools | Adds Session lifecycle tools alongside browser tools |
| Destructive agent actions | Not applicable | MCP cannot Reset or Delete Sessions |
| Local build | Standard app identity | Isolated `ResponsivelyMCP.app` with its own bundle ID, ports and data |
| Runtime baseline | Upstream moves independently | Intentionally frozen on Electron **43.1.1** until a concrete need justifies migration |

The current known-good source baseline is:

```text
b2cc658040a33d350cd434948012b471376753ef
```

That baseline has been validated as a packaged and installed macOS app. Upstream dependency/toolchain changes, including Electron 44, are **not automatically merged**. Useful upstream fixes are evaluated individually.

## Current product model

The intended model is one normal Mac app with multiple project Sessions:

1. Launch Responsively.
2. Previously active Sessions restore after a clean Quit.
3. Use the menu-bar icon or Dock menu to open/focus Sessions.
4. Use **Manage Sessions** to create, rename, stop, reset or delete them.
5. Agents may create/open/focus/stop Sessions through MCP, but they cannot Reset or Delete them.

Reset is intentionally stopped-only and moves the Session profile to the OS Trash while keeping the Session definition, name and starting URL. Delete also uses the Trash rather than silently destroying profile data.

See:

- [Sessions architecture and lifecycle](desktop-app/SESSIONS.md)
- [Sessions roadmap, verified issues and planned milestones](desktop-app/SESSIONS_ROADMAP.md)

## Supported build

The validated local build currently targets:

- macOS;
- Apple Silicon (`arm64`);
- Node.js `>=24.x`;
- Electron `43.1.1`;
- app version `2.0.0-beta.0`;
- bundle ID `app.responsively.mcp.local`.

The installed app lives at:

```text
~/Applications/ResponsivelyMCP.app
```

Its data is intentionally separate from the normal Responsively release:

```text
~/Library/Application Support/ResponsivelyMCP
~/Library/Application Support/ResponsivelySessions
```

## Install this fork on macOS Apple Silicon

### 1. Clone the fork

```bash
git clone https://github.com/FilippoRomeo/responsively-app.git
cd responsively-app
git checkout main
```

For a reproducible install, confirm the expected baseline before building:

```bash
git rev-parse HEAD
```

Expected stable baseline at the time of writing:

```text
b2cc658040a33d350cd434948012b471376753ef
```

### 2. Install dependencies

```bash
cd desktop-app
npx -y yarn@1.22.22 install --frozen-lockfile
```

### 3. Build and install the isolated app

```bash
npx -y yarn@1.22.22 package:mcp-local
```

The packaging script:

- requires macOS `arm64`;
- builds the app;
- packages it with bundle ID `app.responsively.mcp.local`;
- ad-hoc signs and verifies the bundle;
- installs it as `~/Applications/ResponsivelyMCP.app`.

**Important:** if `~/Applications/ResponsivelyMCP.app` already exists with the expected bundle ID, the script replaces that app bundle. It does not remove the Application Support data directories, but back up anything important before updating a working installation.

### 4. Launch it

```bash
open "$HOME/Applications/ResponsivelyMCP.app"
```

The isolated build uses these defaults:

| Setting | Value |
| --- | --- |
| App | `~/Applications/ResponsivelyMCP.app` |
| Bundle ID | `app.responsively.mcp.local` |
| MCP port | `12721` |
| BrowserSync port | `12722` |
| App data | `~/Library/Application Support/ResponsivelyMCP` |
| Session data | `~/Library/Application Support/ResponsivelySessions` |
| `responsively://` registration | disabled |
| Auto-updater | disabled |

## Connect Claude Code

The validated user-scope configuration is:

```bash
claude mcp add responsively -s user \
  -e RESPONSIVELY_APP_PATH="$HOME/Applications/ResponsivelyMCP.app" \
  -e RESPONSIVELY_MCP_PORT=12721 \
  -e RESPONSIVELY_BROWSER_SYNC_PORT=12722 \
  -e RESPONSIVELY_USER_DATA_DIR="$HOME/Library/Application Support/ResponsivelyMCP" \
  -e RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION=true \
  -e CI=true \
  -- npx -y @responsively/mcp@1.0.0
```

The explicit port and data variables keep the MCP bootstrap attached to this isolated fork instead of the normal Responsively installation.

## Connect Codex

Add this to the relevant Codex configuration:

```toml
[mcp_servers.responsively]
command = "npx"
args = ["-y", "@responsively/mcp@1.0.0"]

[mcp_servers.responsively.env]
RESPONSIVELY_APP_PATH = "/Users/YOU/Applications/ResponsivelyMCP.app"
RESPONSIVELY_MCP_PORT = "12721"
RESPONSIVELY_BROWSER_SYNC_PORT = "12722"
RESPONSIVELY_USER_DATA_DIR = "/Users/YOU/Library/Application Support/ResponsivelyMCP"
RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION = "true"
CI = "true"
```

Replace `YOU` with your macOS username.

## MCP tools

The fork keeps the normal browser-control tools and adds Session lifecycle operations.

Browser tools include:

- `get_app_state`
- `navigate`
- `list_devices`
- `set_active_devices`
- `screenshot`
- `read_page`
- `click`
- `type_text`

Session lifecycle tools include:

- `list_sessions`
- `create_session`
- `get_session`
- `open_session`
- `focus_session`
- `stop_session`

Reset and Delete are deliberately **not exposed to MCP**.

## Known limitations and roadmap

The stable baseline is intentionally frozen because it is the version proven end-to-end. There are still known UX issues; they are documented instead of being hidden behind continuous refactoring.

Current verified examples include:

- `⌘Q` from a Session window does not yet behave like whole-app Quit;
- `⌘W` / the red close button can leave a Session running without a visible window;
- a brand-new Session initially opens on the primary display rather than the display currently in use;
- some per-profile UI/migration noise remains.

The evidence, severity and planned milestones are tracked in [SESSIONS_ROADMAP.md](desktop-app/SESSIONS_ROADMAP.md).

## Development policy

The working rules for this fork are intentionally conservative:

- keep `main` on the proven Electron 43 baseline unless a concrete feature or bug requires otherwise;
- one problem per branch;
- tests before install;
- validate packaged macOS behavior, not only source-level tests;
- destructive profile actions require explicit confirmation and use the Trash;
- upstream changes are candidates, not automatic upgrades.

The branch `refactor/sessions-process-roles` is a validated structural cleanup kept on GitHub as a reference. It is not part of the current stable baseline unless explicitly merged later.

## Upstream Responsively

This work is based on [Responsively App](https://github.com/responsively-org/responsively-app). For the original project's releases, website, browser extension, community and cross-platform packages, use the upstream project:

- Website: https://responsively.app
- Upstream repository: https://github.com/responsively-org/responsively-app
- Upstream releases: https://github.com/responsively-org/responsively-app/releases

For problems specific to Sessions, the isolated MCP build or behavior introduced by this fork, use this fork's GitHub issues.