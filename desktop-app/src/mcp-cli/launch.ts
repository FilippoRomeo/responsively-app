import {execFile, spawn} from 'child_process';
import fs from 'fs';
import path from 'path';
import {DEFAULT_MCP_PORT, MCP_PORT_ENV_VAR, McpBeacon} from '../common/mcp';
const BROWSER_SYNC_PORT_ENV_VAR = 'RESPONSIVELY_BROWSER_SYNC_PORT';
const USER_DATA_DIR_ENV_VAR = 'RESPONSIVELY_USER_DATA_DIR';
const DISABLE_PROTOCOL_REGISTRATION_ENV_VAR = 'RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION';
import {readBeacon} from './beacon';
import {log} from './log';

export interface LaunchDeps {
  spawnFn: typeof spawn;
  execFileFn: typeof execFile;
  existsFn: (p: string) => boolean;
  platform: NodeJS.Platform;
  beacon: () => McpBeacon | null;
  bridgeDir: string;
}

const defaultDeps: LaunchDeps = {
  spawnFn: spawn,
  execFileFn: execFile,
  existsFn: fs.existsSync,
  platform: process.platform,
  beacon: readBeacon,
  bridgeDir: __dirname,
};

const MAC_BUNDLE_ID = 'app.responsively';

/**
 * cli.js ships at <resources>/mcp on mac/win, so walking up from __dirname
 * finds the exact install this bridge belongs to — even for relocated apps.
 */
const derivedDarwinAppDir = (deps: LaunchDeps): string | null => {
  const resourcesDir = path.dirname(deps.bridgeDir);
  const appDir = path.dirname(path.dirname(resourcesDir));
  return appDir.endsWith('.app') && deps.existsFn(appDir) ? appDir : null;
};

const derivedBinary = (deps: LaunchDeps): string | null => {
  if (deps.platform === 'darwin') {
    const appDir = derivedDarwinAppDir(deps);
    if (appDir === null) {
      return null;
    }
    const binary = path.join(appDir, 'Contents', 'MacOS', 'ResponsivelyApp');
    return deps.existsFn(binary) ? binary : null;
  }
  const resourcesDir = path.dirname(deps.bridgeDir);
  const binaryName = deps.platform === 'win32' ? 'ResponsivelyApp.exe' : 'responsively';
  const binary = path.join(path.dirname(resourcesDir), binaryName);
  return deps.existsFn(binary) ? binary : null;
};

const spawnDetached = (deps: LaunchDeps, command: string, env: NodeJS.ProcessEnv) => {
  // The app must outlive this agent session.
  const child = deps.spawnFn(command, [], {detached: true, stdio: 'ignore', env});
  child.unref();
};

const openViaLaunchServices = (deps: LaunchDeps, args: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    deps.execFileFn('open', args, (error) => resolve(error === null));
  });

export const launchApp = async (port: number, deps: LaunchDeps = defaultDeps): Promise<void> => {
  const env: NodeJS.ProcessEnv = {...process.env, [MCP_PORT_ENV_VAR]: String(port)};

  // Parallel sessions are isolated by a tuple supplied by the MCP client:
  // MCP port + BrowserSync port + userData. Preserve all three when launching
  // the packaged binary directly; Electron's single-instance lock is keyed by
  // userData, so distinct directories intentionally allow concurrent sessions.
  for (const key of [
    BROWSER_SYNC_PORT_ENV_VAR,
    USER_DATA_DIR_ENV_VAR,
    DISABLE_PROTOCOL_REGISTRATION_ENV_VAR,
  ]) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  const beacon = deps.beacon();

  if (deps.platform === 'darwin') {
    // `open` cannot forward env vars — for a non-default port, spawn the
    // binary directly so the app inherits RESPONSIVELY_MCP_PORT.
    if (port !== DEFAULT_MCP_PORT) {
      const binary = [derivedBinary(deps), beacon?.binaryPath].find(
        (p): p is string => p !== null && p !== undefined && deps.existsFn(p)
      );
      if (binary !== undefined) {
        spawnDetached(deps, binary, env);
        return;
      }
    }
    if (await openViaLaunchServices(deps, ['-b', MAC_BUNDLE_ID])) {
      return;
    }
    const appDir = derivedDarwinAppDir(deps);
    if (appDir !== null && (await openViaLaunchServices(deps, [appDir]))) {
      return;
    }
    throw new Error(
      'Could not launch Responsively App. Install it from https://responsively.app and launch it once.'
    );
  }

  const windowsDefault =
    deps.platform === 'win32' && process.env.LOCALAPPDATA !== undefined
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'ResponsivelyApp', 'ResponsivelyApp.exe')
      : null;
  // Linux ships as an AppImage with no conventional install path — the
  // beacon (written by the app on startup) is the only reliable pointer.
  const binary = [derivedBinary(deps), beacon?.binaryPath, windowsDefault].find(
    (p): p is string => p !== null && p !== undefined && deps.existsFn(p)
  );
  if (binary === undefined) {
    throw new Error(
      'Responsively App binary not found. Launch the app manually once (it records its ' +
        'location for this bridge), or set RESPONSIVELY_APP_PATH to the install location.'
    );
  }
  log(`launching ${binary}`);
  spawnDetached(deps, binary, env);
};

/** Lifecycle tools bootstrap the controller, independently of any browser Session. */
export const launchController = async (
  root: string,
  deps: LaunchDeps = defaultDeps
): Promise<void> => {
  const binary = derivedBinary(deps) ?? deps.beacon()?.binaryPath;
  if (!binary || !deps.existsFn(binary))
    throw new Error('Responsively binary not found; install or launch the app once');
  const env: NodeJS.ProcessEnv = {...process.env};
  for (const key of [
    'RESPONSIVELY_SESSION_ID',
    'RESPONSIVELY_SESSION_TOKEN',
    'RESPONSIVELY_SESSION_URL',
    'RESPONSIVELY_SESSION_NAME',
    'RESPONSIVELY_MCP_PORT',
    'RESPONSIVELY_BROWSER_SYNC_PORT',
    'ELECTRON_RUN_AS_NODE',
  ])
    delete env[key];
  Object.assign(env, {
    RESPONSIVELY_SESSION_CONTROLLER: 'true',
    RESPONSIVELY_SESSIONS_ROOT: root,
    RESPONSIVELY_SHELL_USER_DATA_DIR: process.env.RESPONSIVELY_USER_DATA_DIR,
    RESPONSIVELY_USER_DATA_DIR: path.join(root, 'controller'),
    RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION: 'true',
  });
  spawnDetached(deps, binary, env);
};
