import {app, BrowserWindow, Menu, MenuItemConstructorOptions, Tray} from 'electron';
import path from 'path';
import fs from 'fs';
import {SessionInfo} from '../../common/sessions';
import {sessionRequest, sessionsRoot} from './service';
import {processRole} from '../process-role';
import {registerPanelIpc, setDefaultAnchor, setOwnerWindow, showSessions} from './panel';
import {registerSessionContext, setReopen} from './session-control';

/** Shell entry points: menu-bar launcher, Dock menu and app Sessions menu, kept fresh. */
let tray: Tray | null = null;
let cached: SessionInfo[] = [];

/** The menu-bar menu is the launcher; without a menu-bar icon, fall back to the manager. */
export const showLauncher = async () => {
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
  if (process.platform !== 'darwin' || processRole() !== 'shell' || tray) return tray;
  const assets = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');
  tray = new Tray(path.join(assets, 'sessionsTemplate.png'));
  tray.setToolTip('Responsively Sessions');
  tray.on('click', () => void showLauncher());
  tray.on('right-click', () => void showLauncher());
  setDefaultAnchor(() => (tray && !tray.isDestroyed() ? tray.getBounds() : undefined));
  app.on('will-quit', () => tray?.destroy());
  return tray;
};
const menuAction = (id: string, operation: 'open' | 'focus' | 'stop') => () => {
  sessionRequest({operation, id}).catch((cause) =>
    showSessions(false, cause instanceof Error ? cause.message : String(cause))
  );
};
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
  if (process.platform !== 'darwin' || processRole() === 'session') return;
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

/** Wires the Sessions UI for the shell and Session processes, in a fixed order. */
export const initSessions = (
  getter: () => BrowserWindow | null,
  create: () => Promise<void>,
  rebuildMenu: () => void
) => {
  setOwnerWindow(getter);
  setReopen(create);
  updateDockMenu();
  registerPanelIpc();
  registerSessionContext();
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
