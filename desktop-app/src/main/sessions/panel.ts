import {app, BrowserWindow, ipcMain, screen} from 'electron';
import path from 'path';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {SessionRequest} from '../../common/sessions';
import {sessionRequest} from './service';
import store from '../../store';
import {resolveHtmlPath} from '../util';

/** The Sessions manager window: one reusable host per process, plus its IPC. */
let getWindow: () => BrowserWindow | null;
let panel: BrowserWindow | null = null;
let panelCreate = false;
let panelError = '';
// The shell registers the menu-bar icon here, so the manager can appear under it.
let defaultAnchor: () => Electron.Rectangle | undefined = () => undefined;

export const setOwnerWindow = (getter: () => BrowserWindow | null) => {
  getWindow = getter;
};
export const ownerWindow = () => getWindow();
export const currentPanel = () => panel;
export const setDefaultAnchor = (anchor: () => Electron.Rectangle | undefined) => {
  defaultAnchor = anchor;
};

export const showSessions = (
  create = false,
  error = '',
  keyboard = false,
  anchor?: Electron.Rectangle
) => {
  // In the shell, management always appears under the menu-bar icon, never beside the Dock.
  if (!anchor) anchor = defaultAnchor();
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
  if (panel && !panel.isDestroyed()) {
    panel.setBounds({x, y, width, height: Math.min(panel.getBounds().height, height)});
    panel.show();
    panel.focus();
    panel.webContents.send(IPC_MAIN_CHANNELS.SESSIONS_PANEL_SHOW, {
      create,
      error,
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
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  win.on('blur', () => {
    if (!win.isDestroyed()) win.hide();
  });
  win.on('closed', () => {
    if (panel === win) panel = null;
  });
  void win.loadURL(`${resolveHtmlPath('index.html')}?sessionsPanel=1`);
};

export const registerPanelIpc = () => {
  const isPanel = (sender: Electron.WebContents, frame: Electron.WebFrameMain | null) =>
    panel && !panel.isDestroyed() && sender === panel.webContents && frame === sender.mainFrame;
  ipcMain.on(IPC_MAIN_CHANNELS.SESSIONS_PANEL_CONTEXT, (event) => {
    if (!isPanel(event.sender, event.senderFrame)) return;
    event.returnValue = {
      create: panelCreate,
      error: panelError,
      darkMode: Boolean(store.get('ui.darkMode')),
    };
  });
  ipcMain.on(IPC_MAIN_CHANNELS.SESSIONS_PANEL_DISMISS, (event) => {
    if (isPanel(event.sender, event.senderFrame)) {
      panel?.hide();
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
    return sessionRequest(request);
  });
};
