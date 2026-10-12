import {ipcMain} from 'electron';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {clampSize, HostMessage, TerminalInfo} from '../../common/terminal';
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
    if (win && !win.isDestroyed()) win.webContents.send(IPC_MAIN_CHANNELS.TERMINAL_EVENT, m);
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
};
