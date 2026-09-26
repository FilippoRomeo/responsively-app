# Responsively Sessions: master plan

This is the working product roadmap for the Sessions fork. Every item is tagged with how solid it is:

- **✅ verified:** tested in a running app or proven in code;
- **🔍 code-read:** seen in the code but not observed running;
- **❓ open:** not known yet.

## 0. Goal

**One normal Mac app in which each project gets its own separate browser Session.** You and your agents can open, switch, stop, reset and quit Sessions without surprises, and it picks up where you left off.

**Principles** (these decide every trade-off):

1. **Your data is sacred.** Nothing is ever deleted without confirmation, and deletes go to the Trash.
2. **One app, standard Mac behaviour.** ⌘W, ⌘Q, the Dock, the menu bar and monitors behave like in Chrome.
3. **Stay on the proven build.** Electron 43, no upstream syncs, no refactors unless a feature needs them.
4. **Small steps, each proven.** One problem per branch: tests, then a test package, then CI, then install, each gated on your OK.
5. **Agents are guests.** MCP can create, open, focus and stop Sessions, but never Reset or Delete, and never reopen your Sessions.

## 1. Baseline (✅ verified)

- **App-code baseline:** `ab639bd2a2966d0d9e7d9241b2b73d5f14796280` (merge of PR #9, milestone M5), on Electron 43.1.1. Later docs-only commits on `main` don't change the installed application baseline, so the tip of `main` can be newer.
- **Installed:** `~/Applications/ResponsivelyMCP.app`, built from `ab639bd2`: `app.asar` SHA-256 `11ab5180b8f04eeadbc57015a954d21d0cc5b028c9e7139a5ed965c4121a5137` (unchanged since M1: M5 changed only the bridge), `mcp/cli.js` SHA-256 `eb1d3b76c0d63fc4540f8cd8cb43fbc93da897f758fb3f6b3b61c0794c07a3d1` (the bridge Gate C tested); installed and smoke-tested 2026-09-26.
- **Rollback:** `~/ResponsivelyGateF/install-ab639bd-001/backup-20260926T131759Z/` (the previous `e484db9e` app as `ResponsivelyMCP.app.replaced`, plus hash-verified copies of the app and both data folders). The older `.work/install-backup-20260923-122449/` still holds the `b2cc6580` app.
- **Gate C evidence (M5):** `~/ResponsivelyGateC/archive/gatec-m5-001-evidence.tgz`, SHA-256 `bc7384181ddd4d19304f289d13ec816fe2305a29fd03614b88cdbf93c91467e3`.
- **Parked:** `refactor/sessions-process-roles` (validated, on GitHub, not merged).

How milestones are executed, validated and installed: [SESSIONS_PROCESS.md](SESSIONS_PROCESS.md).

## 2. How the product should behave (the spec)

| Area                                       | Behaviour                                                                                              | Today                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **Launch**                                 | Last-active Sessions reopen; nothing else pops up                                                      | ✅                                                              |
| **Launcher** (menu-bar icon or Dock click) | Sessions (● running, click to focus; ○ stopped, click to open), then New…, Manage…, Quit               | ✅                                                              |
| **Manager**                                | Opens under the menu-bar icon on the monitor you're using. Create, Rename, Stop, Reset, Delete, Search | ✅                                                              |
| **Session window**                         | A normal window; copy, paste and undo work                                                             | ✅                                                              |
| **Toolbar in a Session**                   | Shows **which Session** you're in; opens the same manager                                              | ❌ shows only "Sessions"                                        |
| **⌘W / red close button**                  | Closes the window and **stops that Session** (data kept, status "stopped")                             | ✅ M1 (package 011)                                             |
| **⌘Q in a Session window**                 | First press shows a notice; a second press within 2.5 s quits the **whole app**                        | ✅ M1 (package 011)                                             |
| **Quit** (menu-bar menu)                   | Stops everything and remembers what was open; nothing relaunches                                       | ✅                                                              |
| **New Session window**                     | Opens **on your current monitor**, then remembers its own position                                     | ✅ M1 (package 011)                                             |
| **Reset**                                  | Stopped Sessions only; profile to the Trash; name and URL kept                                         | ✅                                                              |
| **Agents (MCP)**                           | Create/open/focus/stop only; an agent-started shell doesn't reopen your Sessions                       | ✅                                                              |
| **Noise**                                  | No "What's new" card in Sessions; no error logs on new profiles                                        | ⚠️ card gone (M1); migration errors on every new profile remain |
| **Settings (later)**                       | "Start clean every time" per Session; "Reset everything"                                               | ❌ not built                                                    |

## 3. Known problems, with evidence

| ID     | Problem                                                                                                           | Evidence                                                                                   | Severity |
| ------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| **B1** | ⌘Q in a Session window quits only that Session and shows it as "error"                                            | ✅ tested on 009; **fixed in M1**                                                          | High     |
| **B2** | ⌘W or the red button leaves an invisible Session running, in front                                                | ✅ tested; **fixed in M1**                                                                 | High     |
| **B3** | New Session windows open on the laptop screen, not your current one                                               | ✅ tested; **fixed in M1**                                                                 | Medium   |
| **B4** | "What's new" card in every new Session                                                                            | ✅ seen in screenshots; **fixed in M1**                                                    | Low      |
| **B5** | Migration error logs on every new profile                                                                         | ✅ seen in logs; upstream has a small fix                                                  | Low      |
| **U1** | Two different managers inside a Session window (toolbar popover and ⌘⇧M floating panel)                           | 🔍 code-read                                                                               | Medium   |
| **U2** | Toolbar doesn't show the current Session's name                                                                   | 🔍 code-read                                                                               | Low      |
| **U3** | Busy rows, search always shown, Sessions menu with submenus, success message lingers, custom devices shown as IDs | 🔍 code-read + screenshots                                                                 | Low      |
| **P1** | Hidden panel keeps polling; Session processes refresh a menu bar they never show                                  | 🔍 code-read, cost not measured                                                            | Low      |
| **Q1** | "Odd behaviour switching between Responsively and iTerm"                                                          | ❓ probably B2 (the invisible app stays in front); M1 is installed, so observe in real use | ?        |
| **R1** | Browser MCP tools use one fixed port, not the Session UUID; after a restart they miss the Session and wait 60 s   | ✅ Gate C 14/14 + installed smoke test; **fixed in M5**                                    | High     |

## 4. Roadmap (each milestone = one branch, one test package, one PR, one install)

### M1: "Windows and Quit behave like a Mac app" (fixes B1, B2, B3, B4) — ✅ done: merged (PR #6, `e484db9e`), installed and smoke-tested

- ⌘W / red close button → stops that Session cleanly, with correct status and nothing left in front.
- ⌘Q in a Session window → a notice, then a second ⌘Q quits the whole app through the existing safe Quit (stop all, remember, no relaunch). If no shell is running (agent-only), ⌘Q closes just that Session. The menu-bar **Quit Responsively** still quits immediately.
- New Session windows open on the monitor under your mouse.
- No "What's new" card in Sessions.
- **Done when:** a package passes today's exact tests (⌘W, red button, single and double ⌘Q, a new window on display 2, restore after Quit) plus the existing checks; then CI is green, your go-ahead, install and smoke test.

### M2: "One manager, and you know where you are" (U1, U2, P1)

- ⌘⇧M in a Session window opens the same in-window manager as the toolbar button; no per-Session floating panel.
- The toolbar button shows the Session's name.
- The panel polls only while visible; Session processes stop the unnecessary menu refresh.

### M3: "Calmer UI" (U3, B5), optional

- Clicking a row opens or focuses it, with "⋯" for Rename/Reset/Delete.
- Search only above 6 Sessions.
- The Sessions menu becomes a plain list.
- Success messages clear.
- Custom devices show their names.
- Cherry-pick upstream's small migration fix (the fix only, no upgrade).

### M4: "Settings", optional

- "Start clean every time" per Session.
- "Reset everything" (all Sessions to the Trash, with a double confirmation).

### M5: "Agents address Sessions by UUID" (R1) — ✅ done: merged (PR #9, `ab639bd2`), installed and smoke-tested 2026-09-26

- Browser tools take an optional `session` UUID; the bridge resolves its current MCP port through the controller on every call. No port in the agent's config, no implicit Open.
- Gate C: 14/14 on a packaged test app with a stale configured port; stop and reopen changed the PID and port (`62169 → 62395`) and the same UUID still reached the Session. A stopped Session failed in 2 ms instead of the old 60 s wait.
- Installed smoke test: `smoke-m5` stop and reopen changed the PID `36485 → 36627` and the port `65304 → 65426`; `get_app_state` with the same UUID returned the same page before and after.
- Design: [SESSIONS_MCP_DESIGN.md](SESSIONS_MCP_DESIGN.md), part R.

### M6: "Session attention dialog", design only

- When an agent addresses a Session that isn't usable, the Sessions panel shows you why, with Open/Restart, Reset, Delete and a warned Force quit. Only you click.
- Open questions and the proposed D4 are in [SESSIONS_MCP_DESIGN.md](SESSIONS_MCP_DESIGN.md), part D.

### Not planned

Only if a real need appears: Electron 44 or an upstream merge, merging the refactor branch, restructuring `service.ts`, Windows/Linux work.

## 5. How every milestone runs

Follow [SESSIONS_PROCESS.md](SESSIONS_PROCESS.md). It is the single canonical process (gates A–F, test packages, backup-first install, hard rules); this roadmap intentionally doesn't repeat it, so the two can't drift apart.

## 6. Decisions

- **D1, ⌘Q style:** press ⌘Q twice, with a notice after the first press. ✅ decided
- **D2, closing a window:** ⌘W stops that Session. ✅ decided
- **D3, scope:** M1 only; M2 is decided after using M1. ✅ decided
- **D4, agents asking for attention:** MCP may ask the app to show you a Session's problem; Reset, Delete and Force quit stay human-only clicks. ❓ proposed (M6)
