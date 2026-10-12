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

  handle(IPC_MAIN_CHANNELS.TERMINAL_LIST, async (c) => {
    const m = await c.request({op: 'list', session: session()});
    return m.type === 'list' ? m.terminals : ([] as TerminalInfo[]);
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
    if (conn && !conn.closed && typeof id === 'string' && typeof data === 'string')
      conn.post({op: 'input', id, data});
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
  ipcMain.handle(IPC_MAIN_CHANNELS.PORTS_LIST, async (): Promise<PortInfo[]> => {
    const m = await (await connection()).request({op: 'ports', session: session()});
    return m.type === 'ports' ? m.ports : [];
  });

  // Tunnels marked "start with the Session" come up when its window does.
  const auto = saved().filter((d) => d.autoStart);
  if (auto.length > 0)
    setTimeout(() => {
      auto.forEach((d) => startTunnel(d).catch(() => {}));
    }, 1500);
};
