# Sessions

Use **Sessions → New Session…** or the toolbar's **Sessions** button. A Session is a saved project context with an immutable UUID, a name, its own browser data and device suites. Duplicate names are allowed. Ports and processes are temporary resources, not identities.

- **Open** starts a stopped Session; opening a running Session focuses it.
- **Focus** restores its window, including after closing the window on macOS.
- **Stop** quits that Session's process and preserves its data.
- **Close Window** retains the running Session on macOS, matching the existing app behavior. Other platforms retain quit-on-last-window behavior.
- **Rename** changes the display name without changing identity or data paths.
- **Delete** is available only when stopped and requires confirmation. Its profile moves to the OS Trash; its registry entry is removed. Stop never deletes data.

The manager supports light/dark themes, keyboard navigation, visible focus, search and a bounded scrollable list. The native macOS Sessions menu sits between Window and Help. Session names appear in custom/native window titles.

Existing unmanaged windows and their data remain unchanged; this version does not automatically migrate them into named Sessions.

## MCP

The npm bootstrap is unchanged. Its bundled bridge adds `list_sessions`, `create_session`, `get_session`, `open_session`, `focus_session` and `stop_session`. `create_session` takes `name`, optional `url`, and optional `open` (default true). Other lifecycle calls use the stable `id`. No request accepts paths, PIDs or ports. Delete through MCP is intentionally not exposed.

Lifecycle calls work with no browser runtime running: the bridge starts/discovers the controller directly. Existing `get_app_state`, `navigate`, `list_devices`, `set_active_devices`, `read_page`, `click`, `type_text` and `screenshot` retain their existing per-runtime behavior. To attach those browser tools to a new Session, use its verified `runtime.mcpPort` in the existing `RESPONSIVELY_MCP_PORT` bridge configuration; obtain it again after reopening. A Session can run with its MCP toggle off (`runtime.mcpPort` is null); human management still works.

A direct HTTP client must not synchronously stop the runtime serving its own reply. Use the stdio bridge or Sessions UI for that operation. Lifecycle calls through stdio remain independent of the selected browser endpoint.

## Ownership and recovery

A dedicated headless instance of the same app is the registry's single writer, protected by an Electron single-instance lock. Both UI and MCP use its authenticated loopback control service. A runtime's own private control endpoint verifies its identity and performs its own focus/stop; a persisted PID never authorizes a kill.

The root is `app.getPath('appData')/ResponsivelySessions` (macOS: `~/Library/Application Support/ResponsivelySessions`). It contains:

- `sessions-registry.json`: versioned definitions, atomically replaced with fsync + rename.
- `controller/`: controller data, independent of every Session's electron-store.
- `profiles/<UUID>/`: persistent per-session userData, store, browser storage and logs.
- `runtimes/<UUID>.json`: private runtime leases, verified against a live authenticated endpoint before use.
- `controller.json`: private controller discovery information.

No Session-specific state is stored in the global registry's ordinary electron-store. UUIDs are validated and profile symlinks refused. Corrupt metadata fails closed rather than being silently replaced. Runtime failures retain persistent data; stale live/reused PIDs produce an error rather than an unverified stop. Controller restart adopts runtimes only after verifying their endpoints. An idle controller exits after all runtime leases are gone and no clients have called it for 15 seconds. It is recreated on demand.

The manager reserves real loopback sockets using OS-assigned ports and retains logical leases across launch handoff. Different Sessions may start concurrently; duplicate mutations for one UUID are serialized. BrowserSync fallback to a different port is rejected. An unrelated process could race the socket handoff, so startup checks authenticated readiness and exact assigned ports; failure never becomes a false running result. There is no hard-coded Session count or A/B port mapping.

Managed runtimes do not register protocols or check for app updates; they write separate logs. Updating a shared installed binary while Sessions are active is outside this feature. UI screenshot exports still follow the existing user-selected/default directory, which may be shared. This is project isolation within one OS user, not a security sandbox against that user or hostile local programs.

## Verification

Unit coverage includes registry reload/rename identity, malformed input, path traversal/symlinks, concurrent port reservations, capability checks and refusing to stop/delete an unverified live PID. `e2e/tests/sessions.spec.ts` exercises the native menu order and human create/rename/open/focus/stop/delete-confirmation flow. Existing MCP and menu/titlebar regressions remain in the suite.

Implementation evidence and official-documentation rationale: `.work/session-ui-implementation-001/`. macOS arm64 live checks additionally exercised concurrent starts, duplicate Open, browser/device/cookie/localStorage isolation, stop/reopen, 20+ item light/dark UI, cold npm bootstrap startup, three concurrent packaged runtimes, controller crash recovery and MCP-disabled lifecycle. Cross-platform packaging and large-N stress remain separate validation work.
