# Sessions and MCP: design

Status: **R (routing)** is merged (PR #9), packaged-validated and installed (M5). **D (attention dialog)** is implemented (M6); packaged validation is pending.

## Problem (verified in code)

Session management and page control route differently.

- Lifecycle tools (`list_sessions`, `open_session`, …) take a Session UUID and go through the controller (`src/common/session-controller.ts`).
- Browser tools (`navigate`, `click`, `screenshot`, …) go to one MCP port, chosen once when the bridge starts: `RESPONSIVELY_MCP_PORT` → beacon → `12720` (`src/mcp-cli/server.ts`, `src/mcp-cli/beacon.ts`).

A Session's MCP port is OS-assigned on every Open (`src/main/sessions/service.ts`, `open()`), so after a restart the fixed port points at nothing, or at the shell app. When nothing answers, `ensure()` in `src/mcp-cli/backend.ts` launches the app and polls for 60 s: that's the long timeout.

The controller already knows the answer: `get(id)` verifies the runtime through its authenticated endpoint and returns `runtime.mcpPort`.

## R: route browser tools by Session UUID

### Contract

Every browser tool (`get_app_state`, `navigate`, `list_devices`, `set_active_devices`, `read_page`, `click`, `type_text`, `screenshot`) accepts an optional `session` argument: a Session UUID.

- **With `session`:** on every call, the bridge asks the controller for that Session, takes its current verified `runtime.mcpPort`, connects, runs the tool and closes the connection. The port is never cached and never taken from the agent.
- **Without `session`:** unchanged. The bridge's configured port is used and the app is launched on demand, exactly as before.

### Components

| Component                                        | Input                                      | Output                                                             | Authority                                              |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Bridge schema (`src/mcp-cli/session-routing.ts`) | Tool list (live runtime or build manifest) | The same list with an optional `session` property on browser tools | None; description only                                 |
| Resolver (same file)                             | `session` UUID                             | A verified MCP port, or an actionable error                        | The controller's `get`; the bridge adds no state       |
| Transport (existing `createBackend`)             | Port and tool call                         | Tool result                                                        | The runtime; the launcher is disabled for routed calls |
| Runtime (unchanged)                              | Tool call without `session`                | Result                                                             | The runtime executes; it never sees `session`          |

The runtime's tool definitions (`src/main/mcp/toolDefs.ts`) are not changed, so older runtimes keep working and the manifest stays byte-identical to what a runtime emits. The bridge removes `session` before forwarding.

### Resolution table

| Controller state for the UUID          | Result                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `running`, `runtime.mcpPort` is a port | Route the call to that port                                                         |
| `running`, `runtime.mcpPort` is `null` | Error: MCP is turned off in that Session                                            |
| `starting` / `stopping`                | Error: retry shortly                                                                |
| `stopped`                              | Error: call `open_session` first                                                    |
| `error`                                | Error with the controller's own message, e.g. "Session process exited unexpectedly" |
| Unknown or invalid UUID                | The controller's error is relayed                                                   |
| Routed port refuses the connection     | Error: the Session stopped during the call; no launch, no 60 s wait                 |

Errors are returned as tool results with `isError: true` and carry the Session name, state and next step, so the agent can explain the problem to you.

### Failure modes and limits

- **Residual race (unknown likelihood, believed very low):** between the controller's answer and the connection, the runtime could exit and another process could take its port. The bridge still checks that the server identifies itself as `responsively`. Closing this gap completely needs the runtime to prove its Session identity over MCP, a runtime change left for later.
- **Controller unreachable:** the existing controller discovery starts it, as for lifecycle tools.
- **No auto-open:** a routed call never starts a Session (decision: agents don't open Sessions implicitly).

### Validation

- Unit (`src/mcp-cli/session-routing.test.ts`): schema augmentation; `session` removed before forwarding; one test per row of the resolution table; the port is resolved again on every call (a restarted Session with a new port is reached); no launcher runs for a routed call.
- Existing bridge tests stay green: sessionless behaviour is unchanged.
- Packaged (Gate C, on macOS): two running Sessions, `navigate` + `screenshot` against each by UUID; stop and reopen one, then call again with the same UUID and no config change.

## D: Session attention dialog (M6)

### Goal

When an agent addresses a Session that isn't usable, **you** see why, in the app, and choose what happens. The agent still gets only an error; it never picks an option.

### UI (reuses the existing Sessions UI system)

- **Surface:** the existing native Sessions panel (`src/renderer/sessions-panel.tsx` → `SessionsManager`). It already accepts `showRequest {create, error}`; this adds an attention target. No new window type.
- **View:** a new "attention" state built like the existing Reset/Delete confirmation view: `h3` "“Name” needs attention", the reason as the existing red `role="alert"` text, then buttons in the existing `actionClass` style, in the existing light/dark theme and keyboard focus behaviour.
- **Reason line:** the Session's state and the controller's message, plus who asked (e.g. "An agent tried to use this Session").

### Options (you click; never the agent)

| Option             | Shown when                                                                                                                   | Behaviour                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open / Restart** | `stopped`, or `error` with the process gone, and the registry entry and profile pass the existing checks ("not compromised") | The existing Open                                                                                                                                                                           |
| **Reset**          | Stopped                                                                                                                      | The existing Reset confirmation (profile to the Trash)                                                                                                                                      |
| **Delete**         | Stopped                                                                                                                      | The existing Delete confirmation (profile to the Trash)                                                                                                                                     |
| **Force quit**     | `error` with the process still alive and not responding                                                                      | A second warning view ("Force quitting can lose unsaved page state in this Session"), then an explicit button. Only a process proven to be that Session's is signalled (see open questions) |
| **Dismiss**        | Always                                                                                                                       | Closes the view; the agent keeps its error                                                                                                                                                  |

### Flow and authority

1. A routed browser call resolves to a non-usable state (table above).
2. The bridge returns the error to the agent and sends the controller an `attention` request with the UUID only.
3. The controller forwards it to the macOS shell's authenticated endpoint (`shell.json`: `status`, `quit`, `attention`). With no shell running (agent-only), nothing is shown.
4. The shell opens the Sessions panel in the attention view, at most once per Session every 5 minutes (`ATTENTION_INTERVAL_MS`), so an agent's retry loop can't spam you. It never takes focus: the panel is shown inactive and floating, and the menu-bar icon gets a `!` until you use or dismiss the panel.

This amends roadmap principle 5 as **decision D4**: MCP may _ask for your attention_; Reset, Delete and Force quit stay human-only actions in the UI.

### Decisions (answered 2026-09-26)

1. **Who stopped it: stored in the registry** as `lastStop {by, at}`. The origin is set by the component that stops the Session, never taken from the caller's arguments: Sessions UI requests are forced to `user` in the main process, bridge and runtime MCP lifecycle calls to `agent`, ⌘W sends `window`, Quit sends `quit`, and the controller records `crash` when a runtime vanishes without a stop. A caller cannot claim `crash`. Older app versions ignore the field, so rollback stays safe.
2. **Force quit proof: PID + start time + executable.** `force-stop` needs `confirmed: true` and a hung Session (process alive, endpoint silent). The process's macOS `ps` start time must match the lease's `startedAt` (±10 s) and its executable must be the app binary; otherwise nothing is signalled. Then SIGTERM, and SIGKILL after 5 s. On other platforms nothing can be proven, so force quit is refused.
3. **Intrusion: once per Session per 5 minutes, no focus steal** (above).
4. **Non-macOS:** unchanged. The attention panel needs the macOS shell; elsewhere the agent only receives its error.

## Implementation order

1. R: bridge-only change, unit tests, docs. ✅ (PR #9)
2. R: packaged validation and install through `SESSIONS_PROCESS.md` gates C–F. ✅
3. D: implemented as M6 with unit tests; packaged validation (a real attention panel, and force quit of a hung runtime) pending.
