import {app, shell} from 'electron';
import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import {SessionInfo, SessionRuntime, SessionStopSource} from '../../common/sessions';
import {SessionRegistry, atomicWrite, requestSchema} from './registry';
import {Endpoint, call, serve, secret, PortLeases} from '../../common/session-rpc';
import {normalizeUrl} from '../mcp/utils';
import {provesRuntime, readProcess} from './process-proof';
import {z} from 'zod';
import {
  controllerClient,
  controllerRoot,
  reopenSessions,
  stopAllSessions,
} from '../../common/session-controller';

export const sessionsRoot = () => controllerRoot(app.getPath('appData'));
export const runtimeFile = (id: string) => path.join(sessionsRoot(), 'runtimes', `${id}.json`);
const shellFile = () => path.join(sessionsRoot(), 'shell.json');
// Sessions active at the last clean Quit; consumed by the next user launch.
const restoreFile = () => path.join(sessionsRoot(), 'restore.json');
const runningIds = () => {
  const dir = path.join(sessionsRoot(), 'runtimes');
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
    : [];
};
export interface RuntimeLease extends Endpoint {
  id: string;
  pid: number;
  userDataDir: string;
  mcpPort: number;
  browserSyncPort: number;
  startedAt: string;
}
export interface RuntimeReply extends SessionRuntime {
  id: string;
  ready: boolean;
  url?: string;
  devices: string[];
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** At most one attention dialog per Session in this interval. */
export const ATTENTION_INTERVAL_MS = 5 * 60_000;
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8'));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

export const launchRuntime = (env: NodeJS.ProcessEnv) => {
  const executable = process.env.APPIMAGE || process.execPath;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  const child = spawn(executable, args, {env, detached: true, stdio: 'ignore'});
  child.unref();
  return child;
};
const childEnv = (): NodeJS.ProcessEnv => {
  const env = {...process.env};
  for (const key of [
    'RESPONSIVELY_SESSION_ID',
    'RESPONSIVELY_SESSION_TOKEN',
    'RESPONSIVELY_SESSION_NAME',
    'RESPONSIVELY_SESSION_URL',
    'RESPONSIVELY_SESSION_CONTROLLER',
    'RESPONSIVELY_MCP_PORT',
    'RESPONSIVELY_BROWSER_SYNC_PORT',
    'RESPONSIVELY_USER_DATA_DIR',
    'RESPONSIVELY_SHELL_SPAWNED',
    'ELECTRON_RUN_AS_NODE',
  ])
    delete env[key];
  return {
    ...env,
    RESPONSIVELY_SESSIONS_ROOT: sessionsRoot(),
    RESPONSIVELY_SHELL_USER_DATA_DIR:
      process.env.RESPONSIVELY_SHELL_USER_DATA_DIR ||
      (!process.env.RESPONSIVELY_SESSION_ID && !process.env.RESPONSIVELY_SESSION_CONTROLLER
        ? app.getPath('userData')
        : undefined),
    RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION: 'true',
  };
};

// A capability-protected presence beacon, not a second Sessions authority.
const shellRequest = z
  .object({operation: z.enum(['status', 'quit', 'attention']), id: z.string().uuid().optional()})
  .strict();
export const startShellOwner = async (
  onQuitBlocked: (message: string) => void,
  onAttention: (id: string) => void = () => {}
) => {
  const {server, endpoint} = await serve(secret(), async (body) => {
    const req = shellRequest.parse(body);
    // A Session window's ⌘Q asks the shell to quit the whole app (stop, remember, exit).
    if (req.operation === 'quit') setTimeout(() => app.quit(), 50);
    // The controller asks the shell to show you a Session an agent could not use.
    if (req.operation === 'attention' && req.id) onAttention(req.id);
    return {userDataDir: app.getPath('userData')};
  });
  atomicWrite(shellFile(), endpoint);
  // Quit means the whole app. It completes only when every Session has stopped
  // (data kept); otherwise the controller would relaunch this shell to own them.
  let stopping = false;
  let saved = false;
  // Kept across a blocked Quit, so Sessions stopped by the first attempt are still restored.
  const active = new Set<string>();
  app.on('before-quit', (event) => {
    if (runningIds().length === 0) {
      // A clean Quit with nothing running leaves nothing to restore.
      if (!saved) fs.rmSync(restoreFile(), {force: true});
      return;
    }
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    // ponytail: 30s cap only guards a hung controller; its own stop is bounded (~20s).
    void (async () => {
      const result = await stopAllSessions(sessionRequest, runningIds, 30_000);
      const {blocked} = result;
      for (const id of result.active) active.add(id);
      stopping = false;
      if (blocked.length === 0) {
        atomicWrite(restoreFile(), {version: 1, ids: [...active]});
        saved = true;
        app.quit();
        return;
      }
      const list = blocked
        .map(({id, name}) => {
          try {
            return `${name} (process ${read<RuntimeLease>(runtimeFile(id)).pid})`;
          } catch {
            return name;
          }
        })
        .join(', ');
      onQuitBlocked(
        `Quit cancelled: ${list} did not stop. No data was deleted. Stop it here, or end that process in Activity Monitor, then quit again.`
      );
    })();
  });
  app.on('will-quit', () => {
    server.close();
    try {
      if (read<Endpoint>(shellFile()).token === endpoint.token) fs.unlinkSync(shellFile());
    } catch {
      /* A newer shell may own the beacon. */
    }
  });
};

/** A user launch reopens what was active at the last clean Quit, once. */
export const restoreSessions = async () => {
  let ids: string[];
  try {
    ids = z
      .object({version: z.literal(1), ids: z.array(z.string().uuid())})
      .parse(read(restoreFile())).ids;
  } catch {
    return;
  }
  fs.rmSync(restoreFile(), {force: true});
  await reopenSessions(sessionRequest, ids);
};

/** Ask the shell to quit the whole app; false when no shell is running (agent-only Sessions). */
export const requestShellQuit = async () => {
  try {
    await call(read<Endpoint>(shellFile()), {operation: 'quit'}, 2000);
    return true;
  } catch {
    return false;
  }
};

let shellStarting: Promise<void> | undefined;
const ensureShellOwner = () => {
  shellStarting ??= (async () => {
    const alive = async () => {
      try {
        const endpoint = read<Endpoint>(shellFile());
        const response = await call<{userDataDir: string}>(endpoint, {operation: 'status'}, 1000);
        return Boolean(response.userDataDir);
      } catch {
        return false;
      }
    };
    if (await alive()) return;
    const child = launchRuntime({
      ...childEnv(),
      RESPONSIVELY_USER_DATA_DIR: process.env.RESPONSIVELY_SHELL_USER_DATA_DIR,
      // An agent opening one Session must not also reopen the user's previous ones.
      RESPONSIVELY_SHELL_SPAWNED: 'true',
    });
    if (!child.pid) throw new Error('Could not start the Responsively shell');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await alive()) return;
      await pause(100);
    }
    throw new Error('Responsively shell did not become ready');
  })().finally(() => {
    shellStarting = undefined;
  });
  return shellStarting;
};

/** A dedicated controller is the single writer; app windows and MCP are clients. */
export class SessionManager {
  readonly registry = new SessionRegistry(sessionsRoot());
  private leases = new PortLeases();
  private pending = new Map<string, 'starting' | 'stopping'>();
  private errors = new Map<string, string>();
  private locks = new Map<string, Promise<unknown>>();
  private attentionAt = new Map<string, number>();
  private readLease(id: string): RuntimeLease | undefined {
    const file = runtimeFile(id);
    if (!fs.existsSync(file)) return undefined;
    const lease = read<RuntimeLease>(file);
    if (
      lease.id !== id ||
      lease.userDataDir !== this.registry.dataDir(id) ||
      !Number.isInteger(lease.pid) ||
      lease.pid < 1 ||
      typeof lease.token !== 'string'
    )
      throw new Error('Invalid session runtime lease');
    return lease;
  }
  async inspect(id: string): Promise<SessionInfo> {
    let item = this.registry.get(id);
    const lease = this.readLease(id);
    const pending = this.pending.get(id);
    if (lease) {
      try {
        const runtime = await call<RuntimeReply>(lease, {operation: 'status'}, 1500);
        if (
          runtime.id !== id ||
          runtime.pid !== lease.pid ||
          runtime.userDataDir !== lease.userDataDir
        )
          throw new Error('Session runtime identity mismatch');
        this.leases.adopt(lease.mcpPort);
        this.leases.adopt(lease.browserSyncPort);
        if (runtime.url && runtime.url !== item.lastUrl)
          item = this.registry.update(id, {lastUrl: normalizeUrl(runtime.url)});
        return {
          ...item,
          status: pending ?? (runtime.ready ? 'running' : 'starting'),
          runtime,
          devices: runtime.devices,
        };
      } catch (e) {
        // While opening, the lease exists before the runtime serves it; that is startup, not a hang.
        if (alive(lease.pid))
          return {
            ...item,
            status: pending ?? 'error',
            error: pending
              ? undefined
              : 'Runtime is not responding. Persistent data is protected; no unverified process will be stopped.',
            hung: !pending,
          };
        if (fs.existsSync(runtimeFile(id))) fs.unlinkSync(runtimeFile(id));
        if (!pending) {
          this.errors.set(id, 'Session process exited unexpectedly. Open to restart it.');
          item = this.registry.update(id, {lastStop: {by: 'crash', at: new Date().toISOString()}});
        }
        this.leases.release(lease.mcpPort);
        this.leases.release(lease.browserSyncPort);
      }
    }
    return {
      ...item,
      status: pending ?? (this.errors.has(id) ? 'error' : 'stopped'),
      error: this.errors.get(id),
    };
  }
  async list() {
    return Promise.all(this.registry.list().map((s) => this.inspect(s.id)));
  }
  private async control(id: string, operation: 'focus' | 'stop' | 'rename', name?: string) {
    const lease = this.readLease(id);
    if (!lease) throw new Error('Session is stopped');
    // An authenticated endpoint inside the target runtime performs its own actions.
    // Never signal a persisted PID: it may have been reused after a crash.
    const proof = await call<RuntimeReply>(lease, {operation: 'status'});
    if (proof.id !== id || proof.pid !== lease.pid) throw new Error('Session identity mismatch');
    return call(lease, {operation, name});
  }
  private async open(id: string) {
    if (process.platform === 'darwin') await ensureShellOwner();
    const current = await this.inspect(id);
    if (current.status === 'running') {
      await this.control(id, 'focus');
      return current;
    }
    if (this.readLease(id))
      throw new Error('Existing runtime has not stopped; refusing a duplicate launch');
    this.pending.set(id, 'starting');
    this.errors.delete(id);
    const reservations: Awaited<ReturnType<PortLeases['reserve']>>[] = [];
    let child: ReturnType<typeof launchRuntime> | undefined;
    try {
      reservations.push(await this.leases.reserve());
      reservations.push(await this.leases.reserve());
      const [mcp, bs] = reservations;
      const dir = this.registry.dataDir(id);
      fs.mkdirSync(dir, {recursive: true, mode: 0o700});
      const env = {
        ...childEnv(),
        RESPONSIVELY_SESSION_ID: id,
        RESPONSIVELY_SESSION_TOKEN: secret(),
        RESPONSIVELY_SESSION_NAME: current.name,
        RESPONSIVELY_SESSION_URL: fs.existsSync(path.join(dir, 'config.json'))
          ? ''
          : (current.lastUrl ?? ''),
        RESPONSIVELY_USER_DATA_DIR: dir,
        RESPONSIVELY_MCP_PORT: String(mcp.port),
        RESPONSIVELY_BROWSER_SYNC_PORT: String(bs.port),
      };
      // OS sockets are held until handoff; logical leases prevent concurrent starts
      // from reusing them. External bind races fail readiness, never false-success.
      await Promise.all(reservations.map((r) => r.handoff()));
      child = launchRuntime(env);
      let spawnError: Error | undefined;
      child.on('error', (error) => {
        spawnError = error;
      });
      if (!child.pid) throw new Error('Could not start session process');
      atomicWrite(runtimeFile(id), {
        id,
        pid: child.pid,
        port: 0,
        token: env.RESPONSIVELY_SESSION_TOKEN,
        userDataDir: dir,
        mcpPort: mcp.port,
        browserSyncPort: bs.port,
        startedAt: new Date().toISOString(),
      });
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error('Session process exited during startup');
        const state = await this.inspect(id);
        if (state.runtime && state.runtime.mcpPort !== null && state.runtime.mcpPort !== mcp.port)
          throw new Error('MCP port ownership mismatch');
        if (state.runtime && state.runtime.browserSyncPort !== bs.port)
          throw new Error('BrowserSync port ownership mismatch');
        // status is starting while pending, so use the authenticated ready proof.
        const lease = this.readLease(id);
        if (lease && lease.port > 0) {
          const proof = await call<RuntimeReply>(lease, {operation: 'status'});
          if (proof.ready) {
            this.pending.delete(id);
            this.registry.update(id, {lastOpenedAt: new Date().toISOString()});
            return this.inspect(id);
          }
        }
        await pause(200);
      }
      throw new Error('Session startup timed out');
    } catch (error) {
      // Only this freshly spawned ChildProcess handle is eligible for cleanup.
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      this.errors.set(id, error instanceof Error ? error.message : 'Session launch failed');
      throw error;
    } finally {
      this.pending.delete(id);
      if (this.errors.has(id))
        for (const r of reservations) {
          this.leases.release(r.port);
          try {
            await r.handoff();
          } catch {
            /* already handed off */
          }
        }
    }
  }
  private async stop(id: string, source: SessionStopSource) {
    await this.inspect(id);
    if (!this.readLease(id)) {
      this.errors.delete(id);
      return this.inspect(id);
    }
    this.pending.set(id, 'stopping');
    try {
      await this.control(id, 'stop');
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        await pause(100);
        await this.inspect(id);
        if (!this.readLease(id)) {
          this.errors.delete(id);
          this.pending.delete(id);
          this.registry.update(id, {lastStop: {by: source, at: new Date().toISOString()}});
          return this.inspect(id);
        }
      }
      throw new Error('Session did not stop; its data has been preserved');
    } finally {
      this.pending.delete(id);
    }
  }
  /** An agent could not use this Session: show it to you, at most once per interval. */
  private async attention(id: string) {
    const info = await this.inspect(id);
    if (info.status !== 'stopped' && info.status !== 'error') return info;
    const now = Date.now();
    if (now - (this.attentionAt.get(id) ?? -Infinity) < ATTENTION_INTERVAL_MS) return info;
    this.attentionAt.set(id, now);
    try {
      await call(read<Endpoint>(shellFile()), {operation: 'attention', id}, 2000);
    } catch {
      /* No shell (agent-only): the agent still receives its error. */
    }
    return info;
  }
  /** Only a hung process that is provably this Session's runtime is signalled. */
  private async forceStop(id: string, confirmed: boolean | undefined) {
    if (confirmed !== true) throw new Error('Explicit force-quit confirmation is required');
    const info = await this.inspect(id);
    const lease = this.readLease(id);
    if (!info.hung || !lease)
      throw new Error('Only a Session whose process is alive but not responding can be force quit');
    const proof = provesRuntime(
      lease,
      readProcess(lease.pid),
      process.env.APPIMAGE || process.execPath
    );
    if (!proof.ok)
      throw new Error(`Refusing to force quit: ${proof.reason}. No process was signalled.`);
    process.kill(lease.pid, 'SIGTERM');
    for (let i = 0; i < 50 && alive(lease.pid); i += 1) await pause(100);
    if (alive(lease.pid)) {
      process.kill(lease.pid, 'SIGKILL');
      for (let i = 0; i < 20 && alive(lease.pid); i += 1) await pause(100);
    }
    if (alive(lease.pid)) throw new Error('The process did not exit; its data has been preserved');
    if (fs.existsSync(runtimeFile(id))) fs.unlinkSync(runtimeFile(id));
    this.leases.release(lease.mcpPort);
    this.leases.release(lease.browserSyncPort);
    this.errors.delete(id);
    this.registry.update(id, {lastStop: {by: 'user', at: new Date().toISOString()}});
    return this.inspect(id);
  }
  async request(input: unknown): Promise<SessionInfo | SessionInfo[]> {
    const req = requestSchema.parse(input);
    if (req.operation === 'list') return this.list();
    if (req.operation === 'create') {
      if (!req.name) throw new Error('Name is required');
      const item = this.registry.create(req.name, req.url ? normalizeUrl(req.url) : undefined);
      return req.open === false
        ? this.inspect(item.id)
        : this.request({operation: 'open', id: item.id});
    }
    const id = req.id;
    if (!id) throw new Error('Session ID is required');
    if (req.operation === 'get') return this.inspect(id);
    const previous = this.locks.get(id) ?? Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        this.registry.get(id);
        switch (req.operation) {
          case 'open':
            return this.open(id);
          case 'focus':
            await this.control(id, 'focus');
            return this.inspect(id);
          case 'stop':
            return this.stop(id, req.source ?? 'user');
          case 'attention':
            return this.attention(id);
          case 'force-stop':
            return this.forceStop(id, req.confirmed);
          case 'rename': {
            if (!req.name) throw new Error('Name is required');
            this.registry.update(id, {name: req.name});
            if ((await this.inspect(id)).status === 'running')
              await this.control(id, 'rename', req.name);
            return this.inspect(id);
          }
          case 'delete': {
            if (req.confirmed !== true) throw new Error('Explicit delete confirmation is required');
            await this.inspect(id);
            if (this.readLease(id)) throw new Error('Stop the session before deleting it');
            const old = this.registry.get(id);
            const dir = this.registry.dataDir(id);
            // Native Trash is recoverable. Stop never touches persistent data.
            if (fs.existsSync(dir)) await shell.trashItem(dir);
            this.registry.remove(id);
            return {...old, status: 'stopped' as const};
          }
          case 'reset': {
            // The profile is the unit of isolation: move it whole to Trash, keep the definition.
            if (req.confirmed !== true) throw new Error('Explicit reset confirmation is required');
            await this.inspect(id);
            if (this.readLease(id)) throw new Error('Stop the session before resetting its data');
            const dir = this.registry.dataDir(id);
            if (fs.existsSync(dir)) await shell.trashItem(dir);
            this.errors.delete(id);
            return this.inspect(id);
          }
          default:
            throw new Error('Unsupported operation');
        }
      });
    this.locks.set(id, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(id) === task) this.locks.delete(id);
    }
  }
}

export const startController = async () => {
  const manager = new SessionManager();
  let lastRequest = Date.now();
  let requests = 0;
  const {server, endpoint} = await serve(secret(), async (body) => {
    requests += 1;
    lastRequest = Date.now();
    try {
      return await manager.request(body);
    } finally {
      requests -= 1;
      lastRequest = Date.now();
    }
  });
  const idle = setInterval(() => {
    const dir = path.join(sessionsRoot(), 'runtimes');
    if (process.platform === 'darwin' && fs.existsSync(dir) && fs.readdirSync(dir).length > 0)
      void ensureShellOwner().catch(() => {});
    if (
      requests === 0 &&
      Date.now() - lastRequest > 15_000 &&
      (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0)
    )
      app.quit();
  }, 5000);
  app.on('will-quit', () => clearInterval(idle));
  atomicWrite(path.join(sessionsRoot(), 'controller.json'), {...endpoint, pid: process.pid});
  app.on('will-quit', () => server.close());
  // Runtime leases are authenticated on discovery; controller crashes do not
  // delete profiles or make stale persisted PIDs authoritative.
};
let client: ReturnType<typeof controllerClient> | undefined;
export const sessionRequest = (request: import('../../common/sessions').SessionRequest) => {
  client ??= controllerClient(
    sessionsRoot(),
    () =>
      new Promise<void>((resolve, reject) => {
        const child = launchRuntime({
          ...childEnv(),
          RESPONSIVELY_SESSION_CONTROLLER: 'true',
          RESPONSIVELY_USER_DATA_DIR: path.join(sessionsRoot(), 'controller'),
        });
        child.once('spawn', resolve);
        child.once('error', reject);
      })
  );
  return client(request);
};
