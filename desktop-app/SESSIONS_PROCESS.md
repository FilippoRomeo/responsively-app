# Responsively Sessions: execution process

This document defines the execution and validation process. It does not override current code, filesystem state, installed-app evidence, or SESSIONS_ROADMAP.md scope.

It is the canonical contract for running any Sessions milestone, whoever runs it (a person, Claude, Codex or ChatGPT). [SESSIONS_ROADMAP.md](SESSIONS_ROADMAP.md) says _what_ to build; this document says _how_ to build, validate and install it safely.

## Role

Work in gated steps and stop at every gate. Separate **VERIFIED** (checked now) from **REPORTED** (someone said it) and **ASSUMED**. Agreement is not verification.

## Sources of truth (in this order)

1. Current Git state, filesystem and the installed bundle: what actually exists.
2. `desktop-app/.work/` evidence: what was actually tested.
3. [SESSIONS_ROADMAP.md](SESSIONS_ROADMAP.md): what we intend to build, and decisions made.
4. Conversational memory or pasted summaries: hints only, never proof.

Re-derive the installed baseline from `~/Applications/ResponsivelyMCP.app` itself (bundle ID, version, `app.asar` SHA-256) plus the newest `~/ResponsivelyGateF/<install-run>/` evidence. A merged, installed and smoke-tested build is the only thing that becomes the new baseline.

## Fixed policy

- Repo: `FilippoRomeo/responsively-app`, a fork of `responsively-org/responsively-app`.
- Installed app: `~/Applications/ResponsivelyMCP.app`, bundle ID `app.responsively.mcp.local`.
- Electron is frozen at **43.1.1**. Upstream commits are candidates to cherry-pick, never a sync. Never press GitHub **Sync fork** or **Update branch**.

## Milestone scope

Each run names one milestone from the roadmap. Its scope is exactly that list; anything else goes in the report as a suggestion.

## Architecture reality rule

Milestone text describes desired behaviour, not current file or module ownership. Never create a file or module just because a plan names it. If a plan names a file that doesn't exist on current `main`, or puts a responsibility in the wrong place, report the discrepancy and work with the current architecture unless an explicit refactor is part of the milestone.

## Gate A: inspect (no edits)

- Verify branch, HEAD, `origin/main`, no tracked changes, and the milestone's preconditions.
- Read every file you will change and the tests around it. Report current behaviour vs the milestone with `file:line`. If the plan doesn't fit the real code, stop and say so.

## Gate B: implement (new branch from current `main`)

- Minimal diffs, matching surrounding style, in one or two focused commits.
- Add unit tests; prove each new test **fails** without its fix, then passes.
- Checks, from `desktop-app/`:
  - `./node_modules/.bin/tsc --noEmit`
  - `./node_modules/.bin/eslint . --ignore-pattern '.work/**' --max-warnings 0` (plain `eslint .` walks the multi-GB `.work` folder)
  - `./node_modules/.bin/vitest run`

## Gate C: packaged validation (a test package, never the installed app)

- **Script:** `bash desktop-app/scripts/gates/gatec.sh <full commit SHA> [run-name]` does the build and the packaged Sessions/MCP checks below for one pushed commit, entirely under `~/ResponsivelyGateC/<run>/`. It covers routing by UUID (also after a restart), who stopped a Session, the attention panel (focus measured; you confirm the panel, the `!` badge and the Session name), `ps` process proof and force quit, and it proves your installed app and registry were untouched. It writes `<run>/tested.env` with the commit, tree, hashes and verdict. It does **not** cover the core regression list (⌘W, ⌘Q, restore, Reset, displays): run those by hand when the change can affect them.
- **Isolation:** Gate C refuses to start while your installed Responsively or a real Session runtime is running, and lists the agents' MCP bridges that are connected (idle is fine). Every 5 s it watches your installed app, runtime list and registry: if any changes, it stops at once and records what changed and which process started it (`isolation-break.txt`); a difference found at the end is explained in `isolation-diff.txt` (Session names, last stop, leases; no URLs). The test copy logs into `data/logs/` (`RESPONSIVELY_LOG_DIR`), not into the installed app's `~/Library/Logs/ResponsivelyApp/main.log`; the run reports how many bytes that shared log gained.
- **Rerun without rebuilding:** `gatec.sh <SHA> <new-run> --reuse-build <earlier-run>` tests the app an earlier run built from the same commit (for example after a run failed only because your own app changed meanwhile, or a question was reworded). It checks that run's clone is at that commit and that its `app.asar` and bridge hash as recorded when built; data and evidence are new, and `tested.env` names the run that built it (`BUILD_RUN`).

- **Build:** clear `release/app/dist`, run `npx -y yarn@1.22.22 build`, then `electron-builder --mac --arm64 --dir --publish never` with a unique `-c.appId` (`…validation-NNN`) and output under `desktop-app/.work/<name>-NNN/`. Do not use `yarn package:mcp-local` here: its install step deletes and replaces the installed app.
- **Launch** with its own `RESPONSIVELY_USER_DATA_DIR`, `RESPONSIVELY_SESSIONS_ROOT` and ports. On a fresh data folder, open the launcher once so the controller starts.
- **Interaction:** prefer the existing validated method for each layer: unit or Playwright tests for renderer logic, and PID-targeted native events for packaged-app behaviour. Use CoreGraphics input only where real native interaction is itself being asserted. Before any keystroke, verify the target PID is the front app, and abort otherwise. Save the clipboard first and restore it afterwards.
- **Displays:** enumerate the connected displays first, record the count, and capture every connected display. Don't assume a historical count.
- **Core regression**, required when the milestone touches the Sessions runtime, window lifecycle, shell/controller lifecycle, menus/launcher, profile handling or process roles:
  - launcher: a running Session focuses, a stopped one opens;
  - Manage Sessions opens under the menu-bar icon;
  - ⌘W stops the Session;
  - ⌘Q once shows the hint; ⌘Q twice quits and the active Sessions restore;
  - Reset is refused while running and moves the profile to the Trash when stopped;
  - an MCP-started shell doesn't restore the user's Sessions;
  - the user's existing Sessions stay untouched;
  - process, profile and port isolation hold.
- **Milestone-specific:** every scenario directly affected by the changed code.
- Don't rerun unrelated expensive scenarios for ritual coverage. List any omitted regression and why the changed files can't affect it.
- Shut the test package down at the end.

**Stop.** Report the diff stat, each test as PASS/FAIL with evidence, and what was not verified.

## Gate D: pull request (after approval)

- If `main` moved, merge current `origin/main` into the branch (no rebase) and rerun the checks.
- Update `README.md`, `SESSIONS.md` and `SESSIONS_ROADMAP.md` when behaviour changes.
- Push and open a PR with a truthful description: what CI proves, what the package proves, what is untested. Wait for all CI; report any flaky test with its exact first error.

## Gate E: merge (after approval)

- `gh pr merge <N> --merge --match-head-commit <exact head SHA>`.
- Verify the merge commit's tree equals the tested head's tree; sync local `main` with `--ff-only`; wait for `main` CI.

## Gate F: install (after approval)

- **One-step prepare (default):** `bash desktop-app/scripts/gates/gatef.sh prepare --auto <full commit SHA> <install-run>` replaces the separate Gate C run for an install. It builds the commit once and packages it twice (the installed app's bundle ID, and a test copy with a test ID), runs Gate C's automated checks on the test copy (`gatec.sh --from-repo --no-questions`: isolation, Session routing, stop, force quit, with the same preflight and 5 s watch), and refuses unless they pass and both packages hold the identical `app.asar` and bridge. It needs no Terminal and no questions, but Responsively must be quit during it (the backup step needs that anyway). The three questions that need your eyes (menu-bar badge, attention panel, the tab and Manage Sessions) are recorded as skipped (`QUESTIONS=skipped`); run Gate C by hand when a change touches the attention panel or the Session tabs.
- **Script:** `bash desktop-app/scripts/gates/gatef.sh prepare <gatec-run> <install-run>`, then `backup <install-run>`, then `replace <install-run>`, each only after approval. Prepare refuses unless that Gate C run passed and the new bridge is byte-identical to the one it tested; backup refuses unless the app is fully quit and unchanged since prepare. Everything, including the backup, lives under `~/ResponsivelyGateF/<install-run>/`. The steps below describe what the script does.

- **Build** from clean `main` with `-c.appId=app.responsively.mcp.local` (the script builds in `~/ResponsivelyGateF/<install-run>/repo/`). Verify bundle ID, version, arm64, `codesign --verify --deep --strict`, the MCP CLI and manifest, and that the new code is present in `app.asar`. Record the hashes.
- **Quit** the installed app fully, from the menu-bar icon (**Quit Responsively**). Confirm 0 processes from the bundle, no live runtime leases or endpoints belonging to running processes (tell stale files apart from live state), and no open files in the data folders.
- **Back up** the app as a zip (`ditto -c -k`) and both data folders (`~/Library/Application Support/ResponsivelyMCP` and `~/Library/Application Support/ResponsivelySessions`) as copies into `~/ResponsivelyGateF/<install-run>/backup-<timestamp>/`. Verify every file with SHA-256 and every symlink's target (the zip by unpacking it). The app is never kept unpacked: macOS launches any bundle with the same ID, and has opened a backup instead of the installed app. **Stop for approval.**
- **Replace:** check the installed app is still the one backed up; stage to `~/Applications/.ResponsivelyMCP.app.new` and verify it; move the old app aside, move the new app into place and verify its hash; then move the old app and the build output to the Trash (the zip is the rollback copy).
- **Smoke test** with one disposable Session: the user's data is unchanged, the user's own Sessions are untouched (Sessions that were open at the last Quit reopen), and MCP `list_sessions` matches.
- **Roll back** only on a material regression: capture evidence first, move the new bundle to the Trash, unzip `ResponsivelyMCP.app.zip` into `~/Applications` (the replace log prints the command), and restore data only if data was actually damaged.
- **Record** the new baseline (source SHA, installed hashes, backup path) in [SESSIONS_ROADMAP.md](SESSIONS_ROADMAP.md).

## Hard rules

- Protect data: never delete (use the Trash); never overwrite without a verified backup.
- No destructive Git (reset, force-push, rebasing shared branches). Protect uncommitted work.
- Never send keystrokes or clicks to an app you haven't verified is the test app.
- Only one app on the Mac may use bundle ID `app.responsively.mcp.local`.
- Do not merge, push or install without explicit approval for that gate.

## Output per gate

Terse: **VERIFIED / NOT VERIFIED / DISCREPANCIES**, exact SHAs and hashes, and the one next action waiting for approval.
