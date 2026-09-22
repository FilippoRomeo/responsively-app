import {app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions} from 'electron';
import fs from 'fs';
import {z} from 'zod';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {SessionInfo, SessionRequest} from '../../common/sessions';
import {atomicWrite, sessionName} from './registry';
import {RuntimeLease, RuntimeReply, runtimeFile, sessionRequest, sessionsRoot} from './service';
import {serve} from '../../common/session-rpc';
import store from '../../store';
import {getMcpServerStatus} from '../mcp';
import {getBrowserSyncPort, isBrowserSyncReady} from '../browser-sync';
import {normalizeUrl} from '../mcp/utils';

let name = process.env.RESPONSIVELY_SESSION_NAME;
let getWindow: () => BrowserWindow | null;
let reopen: () => Promise<void>;
let pendingShow: boolean | undefined;
export const showSessions = async (create = false) => {
  if (!getWindow()) {
    pendingShow = create;
    await reopen();
    return;
  }
  const win = getWindow();
  if (!win) return;
  win.show();
  win.focus();
  win.webContents.send(IPC_MAIN_CHANNELS.SESSIONS_SHOW, create);
};
const menuAction = (id: string, operation: 'open' | 'focus' | 'stop') => () => {
  sessionRequest({operation, id}).catch(() => showSessions());
};
let cached: SessionInfo[] = [];
export const sessionsMenu = (): MenuItemConstructorOptions => ({
  label: 'Sessions',
  submenu: [
    ...cached.map((s): MenuItemConstructorOptions => ({
      label: `${s.name.slice(0, 60)} — ${s.status}`,
      submenu: [
        {label: s.lastUrl?.slice(0, 100) || 'No project URL', enabled: false},
        {
          label: s.status === 'running' ? 'Focus' : 'Open',
          enabled: ['running', 'stopped', 'error'].includes(s.status),
          click: menuAction(s.id, s.status === 'running' ? 'focus' : 'open'),
        },
        {
          label: 'Stop',
          enabled: ['running', 'error'].includes(s.status),
          click: menuAction(s.id, 'stop'),
        },
      ],
    })),
    ...(cached.length ? [{type: 'separator' as const}] : []),
    {
      label: 'New Session…',
      accelerator: 'CmdOrCtrl+Shift+N',
      click: () => {
        void showSessions(true);
      },
    },
    {
      label: 'Manage Sessions…',
      click: () => {
        void showSessions();
      },
    },
  ],
});

export const initSessions = (getter: () => BrowserWindow | null, create: () => Promise<void>) => {
  getWindow = getter;
  reopen = create;
  ipcMain.handle(IPC_MAIN_CHANNELS.SESSIONS_READY, (event) => {
    if (event.sender !== getWindow()?.webContents) throw new Error('Invalid application window');
    const value = pendingShow;
    pendingShow = undefined;
    return value ?? null;
  });
  ipcMain.handle(IPC_MAIN_CHANNELS.SESSIONS_REQUEST, async (event, request: SessionRequest) => {
    if (
      event.sender !== getWindow()?.webContents ||
      event.senderFrame !== getWindow()?.webContents.mainFrame
    )
      throw new Error('Sessions requests must come from the application window');
    return sessionRequest(request);
  });
  ipcMain.handle(
    IPC_MAIN_CHANNELS.SESSION_CONTEXT,
    (event, value?: {url: string; title: string}) => {
      if (event.sender !== getWindow()?.webContents) throw new Error('Invalid application window');
      if (value && typeof value.url === 'string' && typeof value.title === 'string') {
        const title = [name || 'Responsively', value.title.slice(0, 200)]
          .filter(Boolean)
          .join(' — ');
        getWindow()?.setTitle(title);
        if (process.env.RESPONSIVELY_SESSION_ID && value.url) {
          try {
            store.set('homepage', normalizeUrl(value.url));
          } catch {
            /* transient blank page */
          }
        }
      }
      return {id: process.env.RESPONSIVELY_SESSION_ID, name};
    }
  );
  // Refresh menus only if the controller has been used. Ordinary legacy windows
  // don't need a controller until a human or MCP asks for session management.
  let refreshing = false;
  const timer = setInterval(async () => {
    if (refreshing || !fs.existsSync(`${sessionsRoot()}/controller.json`)) return;
    refreshing = true;
    try {
      const next = (await sessionRequest({operation: 'list'})) as SessionInfo[];
      if (JSON.stringify(next) === JSON.stringify(cached)) return;
      cached = next;
      const menu = Menu.getApplicationMenu();
      const item = menu?.items.find((m) => m.label === 'Sessions');
      if (item)
        item.submenu = Menu.buildFromTemplate(
          sessionsMenu().submenu as MenuItemConstructorOptions[]
        );
    } catch {
      /* manager UI reports actionable errors */
    } finally {
      refreshing = false;
    }
  }, 2000);
  app.on('will-quit', () => clearInterval(timer));
};

export const startSessionRuntime = async () => {
  const id = process.env.RESPONSIVELY_SESSION_ID;
  const token = process.env.RESPONSIVELY_SESSION_TOKEN;
  if (!id || !token) return;
  // Only manager-created launches receive the capability and lease.
  const file = runtimeFile(id);
  // The parent can only publish the PID lease after spawn returns.
  for (let attempt = 0; !fs.existsSync(file) && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const lease = JSON.parse(fs.readFileSync(file, 'utf8')) as RuntimeLease;
  if (
    lease.id !== id ||
    lease.pid !== process.pid ||
    lease.token !== token ||
    lease.userDataDir !== app.getPath('userData')
  )
    throw new Error('Invalid session launch identity');
  const schema = z
    .object({
      operation: z.enum(['status', 'focus', 'stop', 'rename']),
      name: sessionName.optional(),
    })
    .strict();
  const {server, endpoint} = await serve(token, async (body) => {
    const req = schema.parse(body);
    if (req.operation === 'focus') {
      if (!getWindow()) await reopen();
      const win = getWindow();
      win?.restore();
      win?.show();
      win?.focus();
    }
    if (req.operation === 'rename') {
      if (!req.name) throw new Error('Name is required');
      name = req.name;
      getWindow()?.setTitle(name);
    }
    if (req.operation === 'stop') setTimeout(() => app.quit(), 50);
    const mcp = getMcpServerStatus();
    const suites = store.get('deviceManager.previewSuites') as {id: string; devices: string[]}[];
    const devices = (
      suites.find((s) => s.id === store.get('deviceManager.activeSuiteId')) ?? suites[0]
    )?.devices;
    const runtime: RuntimeReply = {
      id,
      pid: process.pid,
      userDataDir: app.getPath('userData'),
      startedAt: lease.startedAt,
      mcpPort: mcp.running ? mcp.port : null,
      browserSyncPort: getBrowserSyncPort(),
      ready: isBrowserSyncReady() && (!mcp.enabled || mcp.running),
      url: store.get('homepage'),
      devices: devices ?? [],
    };
    return runtime;
  });
  atomicWrite(file, {...lease, ...endpoint});
  app.on('will-quit', () => server.close());
};
