import fs from 'fs';
import os from 'os';
import path from 'path';
import {ipcMain} from 'electron';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {clampSize, HostMessage, TerminalInfo} from '../../common/terminal';
import {
  parseSshHosts,
  validateTunnel,
  type PortInfo,
  type TunnelDef,
  type TunnelInfo,
} from '../../common/tunnel';
import store from '../../store';
import {sessionRequest} from '../sessions/service';
import type {GetMainWindow} from '../mcp/bridge';
import {HostConnection, type HostEndpoint} from './client';
import {setEnvApi} from './env-api';
import {getSandbox, sandboxMode} from '../sandbox';
import {isOurTmux} from '../../common/sandbox';
import {terminalEndpoint} from './supervisor';

/**
 * This window's side of the terminals: one connection to the terminal host,
 * opened on first use and again if it drops, with the host's output forwarded to
 * the page. The host (not this process) owns the shells, so closing the window
 * or the panel leaves them running.
 */
const session = () => process.env.RESPONSIVELY_SESSION_ID || 'main';

const endpoint = async (): Promise<HostEndpoint> =>
  process.env.RESPONSIVELY_SESSION_ID
    ? ((await sessionRequest({operation: 'terminal-host'})) as unknown as HostEndpoint)
    : terminalEndpoint();

export const initTerminals = (getMainWindow: GetMainWindow) => {
  let conn: HostConnection | null = null;
  let opening: Promise<HostConnection> | null = null;
  /** What this window's page is showing, to attach again if the connection is remade. */
  const attached = new Set<string>();

  const emit = (m: HostMessage) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    // Tunnel changes go to their own channel, and only for this Session's tunnels.
    if (m.type === 'tunnel') {
      if (m.session === session()) win.webContents.send(IPC_MAIN_CHANNELS.TUNNEL_EVENT, m.tunnel);
    } else win.webContents.send(IPC_MAIN_CHANNELS.TERMINAL_EVENT, m);
  };

  const connection = (): Promise<HostConnection> => {
    if (conn && !conn.closed) return Promise.resolve(conn);
    opening ??= (async () => {
      const c = new HostConnection(emit, () => {
        if (conn === c) conn = null;
      });
      await c.open(await endpoint());
      conn = c;
      for (const id of attached) c.post({op: 'attach', id});
      return c;
    })().finally(() => {
      opening = null;
    });
    return opening;
  };

  const handle = <A extends unknown[], R>(
    channel: string,
    fn: (c: HostConnection, ...a: A) => Promise<R>
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_e, ...args) => fn(await connection(), ...(args as A)));
  };

  /** The sandbox must be running to open a terminal in it: nothing is started behind your back. */
  const sandboxTarget = () => {
    const sandbox = getSandbox();
    if (!sandbox.isRunning())
      throw new Error('The sandbox is not running. Start it in the Environment view.');
    return sandbox.target();
  };

  handle(IPC_MAIN_CHANNELS.TERMINAL_LIST, async (c) => {
    const m = await c.request({op: 'list', session: session()});
    const all = m.type === 'list' ? m.terminals : ([] as TerminalInfo[]);
    if (sandboxMode() !== 'sandbox') return all.filter((t) => !t.sandbox);
    const sandbox = getSandbox();
    if (!sandbox.isRunning()) return [];
    // After the app was quit, the sandbox's tmux sessions are still there: attach tabs to them again.
    const mine = all.filter((t) => t.sandbox);
    for (const name of await sandbox.tmuxSessions()) {
      if (mine.some((t) => t.tmux === name) || !isOurTmux(name)) continue;

      const made = await c.request({
        op: 'create',
        session: session(),
        cols: 100,
        rows: 16,
        sandbox: {...sandbox.target(), tmux: name},
      });
      if (made.type === 'created') mine.push(made.terminal);
    }
    return mine;
  });
  handle(
    IPC_MAIN_CHANNELS.TERMINAL_CREATE,
    async (c, size: {cols?: number; rows?: number; cwd?: string} = {}) => {
      const s = clampSize(size?.cols, size?.rows);
      const m = await c.request({
        op: 'create',
        session: session(),
        cwd: typeof size?.cwd === 'string' ? size.cwd : undefined,
        ...s,
        ...(sandboxMode() === 'sandbox' ? {sandbox: sandboxTarget()} : {}),
      });
      if (m.type !== 'created') throw new Error('Could not start a terminal.');
      return m.terminal;
    }
  );
  handle(IPC_MAIN_CHANNELS.TERMINAL_ATTACH, async (c, id: string) => {
    attached.add(String(id));
    await c.request({op: 'attach', id: String(id)});
    return true;
  });
  handle(IPC_MAIN_CHANNELS.TERMINAL_DETACH, async (c, id: string) => {
    attached.delete(String(id));
    await c.request({op: 'detach', id: String(id)});
    return true;
  });
  handle(IPC_MAIN_CHANNELS.TERMINAL_CLOSE, async (c, id: string) => {
    attached.delete(String(id));
    await c.request({op: 'close', id: String(id)});
    return true;
  });
  // Keystrokes and resizes: no answer wanted.
  ipcMain.removeAllListeners(IPC_MAIN_CHANNELS.TERMINAL_INPUT);
  ipcMain.on(IPC_MAIN_CHANNELS.TERMINAL_INPUT, (_e, args: unknown[]) => {
    const [id, data] = Array.isArray(args) ? args : [];
    if (conn && !conn.closed && typeof id === 'string' && typeof data === 'string') {
      conn.post({op: 'input', id, data});
      // Typing in a sandbox terminal counts as using the sandbox.
      if (sandboxMode() === 'sandbox') getSandbox().touch();
    }
  });
  ipcMain.removeAllListeners(IPC_MAIN_CHANNELS.TERMINAL_RESIZE);
  ipcMain.on(IPC_MAIN_CHANNELS.TERMINAL_RESIZE, (_e, args: unknown[]) => {
    const [id, cols, rows] = Array.isArray(args) ? args : [];
    if (conn && !conn.closed && typeof id === 'string')
      conn.post({op: 'resize', id, ...clampSize(cols, rows)});
  });

  // ---- Tunnels: definitions live in this Session's own store; the host runs them. ----
  const saved = () => (store.get('sessionTunnels') as TunnelDef[] | undefined) ?? [];
  const stopped = (def: TunnelDef): TunnelInfo => ({
    def,
    state: 'stopped',
    localPort: def.localPort,
    attempts: 0,
  });
  const live = async (): Promise<Map<string, TunnelInfo>> => {
    try {
      const c = await connection();
      const m = await c.request({op: 'tunnel-list', session: session()});
      return new Map(
        (m.type === 'tunnels' ? m.tunnels : []).map((t) => [t.def.id, t] as [string, TunnelInfo])
      );
    } catch {
      return new Map();
    }
  };
  const startTunnel = async (def: TunnelDef) => {
    const c = await connection();
    const m = await c.request({op: 'tunnel-start', session: session(), def}, 15_000);
    return m.type === 'tunnels' ? m.tunnels[0] : stopped(def);
  };

  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TUNNELS_LIST);
  ipcMain.handle(IPC_MAIN_CHANNELS.TUNNELS_LIST, async (): Promise<TunnelInfo[]> => {
    const defs = saved();
    if (defs.length === 0) return [];
    const running = await live();
    return defs.map((d) => running.get(d.id) ?? stopped(d));
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TUNNEL_SAVE);
  ipcMain.handle(IPC_MAIN_CHANNELS.TUNNEL_SAVE, (_e, input: Partial<TunnelDef>) => {
    const def: TunnelDef = {
      id: typeof input?.id === 'string' && input.id ? input.id : `t-${Date.now().toString(36)}`,
      name: String(input?.name ?? '').trim(),
      host: String(input?.host ?? '').trim(),
      remote: String(input?.remote ?? '').trim(),
      localPort: Number(input?.localPort),
      anyPort: input?.anyPort !== false,
      autoStart: input?.autoStart === true,
    };
    const problem = validateTunnel(def);
    if (problem) throw new Error(problem);
    store.set('sessionTunnels', [...saved().filter((d) => d.id !== def.id), def]);
    return def;
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TUNNEL_DELETE);
  ipcMain.handle(IPC_MAIN_CHANNELS.TUNNEL_DELETE, async (_e, id: string) => {
    try {
      (await connection()).post({op: 'tunnel-stop', id: String(id)});
    } catch {
      /* the host is not running: nothing to stop */
    }
    store.set(
      'sessionTunnels',
      saved().filter((d) => d.id !== id)
    );
    return true;
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TUNNEL_START);
  ipcMain.handle(IPC_MAIN_CHANNELS.TUNNEL_START, async (_e, id: string) => {
    const def = saved().find((d) => d.id === id);
    if (!def) throw new Error('That tunnel is gone.');
    return startTunnel(def);
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TUNNEL_STOP);
  ipcMain.handle(IPC_MAIN_CHANNELS.TUNNEL_STOP, async (_e, id: string) => {
    (await connection()).post({op: 'tunnel-stop', id: String(id)});
    return true;
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.SSH_HOSTS);
  ipcMain.handle(IPC_MAIN_CHANNELS.SSH_HOSTS, (): string[] => {
    try {
      return parseSshHosts(fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8'));
    } catch {
      return [];
    }
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.PORTS_LIST);
  const SBX_PORT = 'sbx-port-';
  const sandboxPortDef = (port: number): TunnelDef => {
    const t = getSandbox().target();
    return {
      id: `${SBX_PORT}${port}`,
      name: `Sandbox port ${port}`,
      host: t.host,
      sshConfig: t.config,
      remote: `127.0.0.1:${port}`,
      localPort: port,
      anyPort: true,
      autoStart: false,
    };
  };
  const publishPort = async (port: number) => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Not a usable port.');
    const m = await (
      await connection()
    ).request({op: 'tunnel-start', session: session(), def: sandboxPortDef(port)}, 15_000);
    return m.type === 'tunnels' ? m.tunnels[0] : undefined;
  };
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.PORT_PUBLISH);
  ipcMain.handle(IPC_MAIN_CHANNELS.PORT_PUBLISH, (_e, port: number) => publishPort(Number(port)));
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.PORT_UNPUBLISH);
  ipcMain.handle(IPC_MAIN_CHANNELS.PORT_UNPUBLISH, async (_e, port: number) => {
    (await connection()).post({op: 'tunnel-stop', id: `${SBX_PORT}${Number(port)}`});
    return true;
  });
  /** Ports now: the Mac's, for this Session's terminals (Local), or the sandbox's, named by container. */
  const portsNow = async (): Promise<PortInfo[]> => {
    const c = await connection();
    if (sandboxMode() !== 'sandbox') {
      const m = await c.request({op: 'ports', session: session()});
      return m.type === 'ports' ? m.ports : [];
    }
    const sandbox = getSandbox();
    if (!sandbox.isRunning()) return [];
    const [guest, containers] = await Promise.all([
      sandbox.listeningPorts(),
      sandbox.dockerContainers(),
    ]);
    const published = new Map<number, number>();
    (await live()).forEach((t) => {
      if (t.def.id.startsWith(SBX_PORT) && t.state === 'connected')
        published.set(Number(t.def.id.slice(SBX_PORT.length)), t.localPort);
    });
    // "Publish at once": a new port is forwarded to this Mac as soon as it is seen.
    if (sandbox.state().settings.publish === 'auto')
      for (const p of guest)
        if (!published.has(p) && p >= 1024) await publishPort(p).catch(() => {});
    return guest.map((port) => {
      const owner = containers.find((k) => k.ports.includes(port));
      return {
        port,
        pid: 0,
        process: 'sandbox',
        source: 'sandbox' as const,
        ...(owner ? {container: `${owner.name} · ${owner.image}`} : {}),
        ...(published.has(port) ? {publishedAt: published.get(port) as number} : {}),
      };
    });
  };
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.PORTS_LIST);
  ipcMain.handle(IPC_MAIN_CHANNELS.PORTS_LIST, portsNow);

  // What agents may ask of this environment (the MCP tools check permission first).
  const settled = ['connected', 'auth-required', 'port-conflict', 'failed', 'stopped'];
  setEnvApi({
    terminalCount: async () => {
      const m = await (await connection()).request({op: 'list', session: session()});
      return m.type === 'list' ? m.terminals.length : 0;
    },
    ports: portsNow,
    tunnels: async () => {
      const running = await live();
      return saved().map((d) => running.get(d.id) ?? stopped(d));
    },
    savedTunnel: (nameOrId) =>
      saved().find((d) => d.id === nameOrId || d.name.toLowerCase() === nameOrId.toLowerCase()),
    savedNames: () => saved().map((d) => d.name),
    startTunnel: async (def) => {
      let info = await startTunnel(def);
      for (let i = 0; i < 50 && !settled.includes(info.state); i += 1) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 400);
        });

        info = (await live()).get(def.id) ?? info;
      }
      return info;
    },
    stopTunnel: async (id) => {
      (await connection()).post({op: 'tunnel-stop', id});
    },
  });

  // Tunnels marked "start with the Session" come up when its window does.
  const auto = saved().filter((d) => d.autoStart);
  if (auto.length > 0)
    setTimeout(() => {
      auto.forEach((d) => startTunnel(d).catch(() => {}));
    }, 1500);
};
