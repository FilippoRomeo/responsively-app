import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  screen,
  Tray,
} from 'electron';
import path from 'path';
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
import {resolveHtmlPath} from '../util';

let name = process.env.RESPONSIVELY_SESSION_NAME;
let getWindow: () => BrowserWindow | null;
let reopen: () => Promise<void>;
let panel: BrowserWindow | null = null;
let tray: Tray | null = null;
let panelCreate = false;
let panelError = '';
let panelAttention = '';
/** A marker beside the menu-bar icon while a Session an agent could not use awaits you. */
const setAttentionBadge = (on: boolean) => {
  if (tray && !tray.isDestroyed()) tray.setTitle(on ? ' !' : '');
};
/** Attention never takes focus: shown inactive, floating so it is not hidden behind your app. */
const present = (win: BrowserWindow, inactive: boolean) => {
  win.setAlwaysOnTop(inactive, 'floating');
  if (inactive) {
    win.showInactive();
  } else {
    win.show();
    win.focus();
  }
};
/** A Session window manages Sessions in its own toolbar manager; only the shell uses the panel. */
const showInSessionWindow = (create: boolean, error: string) => {
  const win = process.env.RESPONSIVELY_SESSION_ID ? getWindow() : null;
  if (!win || win.isDestroyed()) return false;
  win.show();
  win.focus();
  win.webContents.send(IPC_MAIN_CHANNELS.SESSIONS_SHOW, {create, error});
  return true;
};
export const showSessions = (
  create = false,
  error = '',
  keyboard = false,
  anchor?: Electron.Rectangle,
  attention = ''
) => {
  if (showInSessionWindow(create, error)) return;
  const inactive = Boolean(attention);
  setAttentionBadge(inactive);
  // In the shell, management always appears under the menu-bar icon, never beside the Dock.
  if (!anchor && tray && !tray.isDestroyed()) anchor = tray.getBounds();
  const owner = getWindow();
  const cursor = screen.getCursorScreenPoint();
  const display = anchor
    ? screen.getDisplayMatching(anchor)
    : keyboard
      ? owner && !owner.isDestroyed()
        ? screen.getDisplayMatching(owner.getBounds())
        : screen.getPrimaryDisplay()
      : screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;
  const width = Math.min(420, area.width - 16);
  const height = Math.min(560, area.height - 16);
  const x = Math.max(
    area.x + 8,
    Math.min(
      anchor ? anchor.x + anchor.width / 2 - width / 2 : keyboard ? area.x + 24 : cursor.x - 28,
      area.x + area.width - width - 8
    )
  );
  const y = Math.max(area.y + 8, anchor ? anchor.y + anchor.height + 8 : area.y + 8);
  panelCreate = create;
  panelError = error;
  panelAttention = attention;
  if (panel && !panel.isDestroyed()) {
    panel.setBounds({x, y, width, height: Math.min(panel.getBounds().height, height)});
    present(panel, inactive);
    panel.webContents.send(IPC_MAIN_CHANNELS.SESSIONS_PANEL_SHOW, {
      create,
      error,
      attention,
      darkMode: Boolean(store.get('ui.darkMode')),
    });
    return;
  }
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: store.get('ui.darkMode') ? '#0d1420' : '#ffffff',
    webPreferences: {
      preload:
        app.isPackaged || process.env.E2E_TEST === 'true'
          ? path.join(__dirname, 'preload-sessions.js')
          : path.join(__dirname, '../../.erb/dll/preload-sessions.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  panel = win;
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.on('ready-to-show', () => {
    if (!win.isDestroyed()) present(win, inactive);
  });
  // Once you have used the panel it behaves normally again.
  win.on('focus', () => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
    setAttentionBadge(false);
  });
  win.on('blur', () => {
    if (!win.isDestroyed()) win.hide();
  });
  win.on('closed', () => {
    if (panel === win) panel = null;
  });
  void win.loadURL(`${resolveHtmlPath('index.html')}?sessionsPanel=1`);
};
/** Shows you a Session an agent could not use, without taking focus from your work. */
export const showAttention = (id: string) => showSessions(false, '', false, undefined, id);
/** The menu-bar menu is the launcher; without a menu-bar icon, fall back to the manager. */
export const showLauncher = async () => {
  setAttentionBadge(false);
  if (!tray || tray.isDestroyed()) {
    showSessions(false, '', true);
    return;
  }
  // A fresh list when the controller answers quickly; otherwise the last refresh.
  const items = await Promise.race([
    sessionRequest({operation: 'list'}).then(
      (value) => value as SessionInfo[],
      () => cached
    ),
    new Promise<SessionInfo[]>((resolve) => {
      setTimeout(() => resolve(cached), 1500);
    }),
  ]);
  if (tray && !tray.isDestroyed()) tray.popUpContextMenu(statusMenu(items));
};
export const initSessionsTray = () => {
  if (
    process.platform !== 'darwin' ||
    process.env.RESPONSIVELY_SESSION_ID ||
    process.env.RESPONSIVELY_SESSION_CONTROLLER === 'true' ||
    tray
  )
    return tray;
  const assets = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');
  tray = new Tray(path.join(assets, 'sessionsTemplate.png'));
  tray.setToolTip('Responsively Sessions');
  tray.on('click', () => void showLauncher());
  tray.on('right-click', () => void showLauncher());
  app.on('will-quit', () => tray?.destroy());
  return tray;
};
const menuAction = (id: string, operation: 'open' | 'focus' | 'stop') => () => {
  sessionRequest({operation, id, source: 'user'}).catch((cause) =>
    showSessions(false, cause instanceof Error ? cause.message : String(cause))
  );
};
let cached: SessionInfo[] = [];
/** The menu-bar launcher: Sessions to open or focus, then management and Quit. */
const statusMenu = (items: SessionInfo[]) =>
  Menu.buildFromTemplate([
    ...(items.length
      ? [...items]
          .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running'))
          .map((s): MenuItemConstructorOptions => ({
            label: `${s.status === 'running' ? '●' : '○'}  ${s.name.slice(0, 60)}`,
            enabled: ['running', 'stopped', 'error'].includes(s.status),
            click: menuAction(s.id, s.status === 'running' ? 'focus' : 'open'),
          }))
      : [{label: 'No Sessions', enabled: false}]),
    {type: 'separator'},
    {label: 'New Session…', click: () => showSessions(true)},
    {label: 'Manage Sessions…', click: () => showSessions()},
    {type: 'separator'},
    {label: 'Quit Responsively', click: () => app.quit()},
  ]);
const dockLabel = (s: SessionInfo) => {
  let site = '';
  try {
    site = s.lastUrl ? new URL(s.lastUrl).host : '';
  } catch {
    /* A saved URL may predate URL normalization. */
  }
  return `${s.name.slice(0, 60)}${site ? ` — ${site.slice(0, 60)}` : ''}`;
};
const updateDockMenu = () => {
  if (process.platform !== 'darwin' || process.env.RESPONSIVELY_SESSION_ID) return;
  app.dock?.setMenu(
    Menu.buildFromTemplate([
      ...cached
        .filter((s) => s.status === 'running')
        .map((s): MenuItemConstructorOptions => ({
          label: dockLabel(s),
          click: menuAction(s.id, 'focus'),
        })),
      ...(cached.some((s) => s.status === 'running') ? [{type: 'separator' as const}] : []),
      {label: 'New Session…', click: () => showSessions(true)},
      {label: 'Manage Sessions…', click: () => showSessions()},
    ])
  );
};
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
      click: (_item, _window, event) => {
        showSessions(true, '', Boolean(event.triggeredByAccelerator));
      },
    },
    {
      label: 'Manage Sessions…',
      accelerator: 'CmdOrCtrl+Shift+M',
      click: (_item, _window, event) => {
        showSessions(false, '', Boolean(event.triggeredByAccelerator));
      },
    },
  ],
});

export const initSessions = (
  getter: () => BrowserWindow | null,
  create: () => Promise<void>,
  rebuildMenu: () => void
) => {
  getWindow = getter;
  reopen = create;
  updateDockMenu();
  const isPanel = (sender: Electron.WebContents, frame: Electron.WebFrameMain | null) =>
    panel && !panel.isDestroyed() && sender === panel.webContents && frame === sender.mainFrame;
  ipcMain.on(IPC_MAIN_CHANNELS.SESSIONS_PANEL_CONTEXT, (event) => {
    if (!isPanel(event.sender, event.senderFrame)) return;
    event.returnValue = {
      create: panelCreate,
      error: panelError,
      attention: panelAttention,
      darkMode: Boolean(store.get('ui.darkMode')),
    };
  });
  ipcMain.on(IPC_MAIN_CHANNELS.SESSIONS_PANEL_DISMISS, (event) => {
    if (isPanel(event.sender, event.senderFrame)) {
      panel?.setAlwaysOnTop(false);
      panel?.hide();
      setAttentionBadge(false);
      const owner = getWindow();
      if (owner && !owner.isDestroyed()) owner.focus();
    }
  });
  ipcMain.on(IPC_MAIN_CHANNELS.SESSIONS_PANEL_RESIZE, (event, height: number) => {
    if (!isPanel(event.sender, event.senderFrame) || !Number.isFinite(height)) return;
    const area = screen.getDisplayMatching(panel!.getBounds()).workArea;
    const target = Math.min(Math.max(Math.ceil(height), 190), area.height - 16);
    if (panel!.getBounds().height !== target) panel!.setSize(panel!.getBounds().width, target);
  });
  ipcMain.handle(IPC_MAIN_CHANNELS.SESSIONS_REQUEST, async (event, request: SessionRequest) => {
    const main = getWindow()?.webContents;
    if (
      !isPanel(event.sender, event.senderFrame) &&
      (event.sender !== main || event.senderFrame !== main?.mainFrame)
    )
      throw new Error('Sessions requests must come from the application window');
    // Requests from the Sessions UI are yours; the renderer cannot claim another origin.
    return sessionRequest({...request, source: 'user'});
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
  // macOS Session processes are accessory apps: no menu bar, Dock menu or menu-bar icon to refresh.
  if (process.platform === 'darwin' && process.env.RESPONSIVELY_SESSION_ID) return;
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
      // Electron application menus cannot add or remove items in place.
      rebuildMenu();
      updateDockMenu();
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
      operation: z.enum(['status', 'focus', 'stop', 'rename', 'e2e-show-panel', 'e2e-panel-state']),
      name: sessionName.optional(),
    })
    .strict();
  const {server, endpoint} = await serve(token, async (body) => {
    const req = schema.parse(body);
    if (req.operation === 'e2e-show-panel' || req.operation === 'e2e-panel-state') {
      if (process.env.E2E_TEST !== 'true') throw new Error('Test operation unavailable');
      if (req.operation === 'e2e-show-panel') {
        showSessions();
        return {visible: true};
      }
      const win = getWindow();
      return {
        visible: Boolean(panel?.isVisible()),
        content: panel?.isDestroyed()
          ? ''
          : await panel?.webContents.executeJavaScript('document.body?.innerText ?? ""'),
        inWindow:
          win && !win.isDestroyed()
            ? await win.webContents.executeJavaScript(
                'document.querySelector("[data-testid=sessions-manager]")?.innerText ?? ""'
              )
            : '',
        hosts: BrowserWindow.getAllWindows().filter((w) =>
          w.webContents.getURL().includes('sessionsPanel=1')
        ).length,
      };
    }
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
      getWindow()?.webContents.send(IPC_MAIN_CHANNELS.SESSION_RENAMED, name);
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
