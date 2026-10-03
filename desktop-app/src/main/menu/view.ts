import {BrowserWindow, MenuItemConstructorOptions} from 'electron';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {SHORTCUT_CHANNEL} from '../../common/shortcuts';

const isMac = process.platform === 'darwin';
const isDev = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

const getToggleFullScreen = (mainWindow: BrowserWindow): MenuItemConstructorOptions => ({
  label: 'Toggle &Full Screen',
  accelerator: isMac ? 'Ctrl+CommandOrControl+F' : 'F11',
  click: () => {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  },
});

const getToggleDevTools = (mainWindow: BrowserWindow): MenuItemConstructorOptions => ({
  label: 'Toggle &Developer Tools',
  accelerator: isMac ? 'Alt+CommandOrControl+I' : 'Alt+Ctrl+I',
  click: () => {
    mainWindow.webContents.toggleDevTools();
  },
});

// The window's own shortcuts handle ⌘R / ⌘⇧R everywhere, including Session
// windows that have no menu; the menu only shows them and runs the same path.
const getReloadMenu = (mainWindow: BrowserWindow): MenuItemConstructorOptions => ({
  label: '&Reload',
  accelerator: 'CommandOrControl+R',
  registerAccelerator: isDev,
  click: () => {
    if (isDev) {
      mainWindow.webContents.reload();
      return;
    }
    mainWindow.webContents.send(IPC_MAIN_CHANNELS.SHORTCUT_TRIGGERED, SHORTCUT_CHANNEL.RELOAD);
  },
});

const getReloadIgnoringCacheMenu = (mainWindow: BrowserWindow): MenuItemConstructorOptions => ({
  label: 'Reload and Clear Cache',
  accelerator: 'CommandOrControl+Shift+R',
  registerAccelerator: false,
  click: () => {
    mainWindow.webContents.send(
      IPC_MAIN_CHANNELS.SHORTCUT_TRIGGERED,
      SHORTCUT_CHANNEL.RELOAD_CLEAR_CACHE
    );
  },
});

const getViewMenuProd = (mainWindow: BrowserWindow): MenuItemConstructorOptions => ({
  label: '&View',
  submenu: [
    getReloadMenu(mainWindow),
    getReloadIgnoringCacheMenu(mainWindow),
    getToggleFullScreen(mainWindow),
  ],
});

const getViewMenuDev = (mainWindow: BrowserWindow): MenuItemConstructorOptions => ({
  label: '&View',
  submenu: [
    getReloadMenu(mainWindow),
    getToggleDevTools(mainWindow),
    getToggleFullScreen(mainWindow),
  ],
});

export const getViewMenu = isDev ? getViewMenuDev : getViewMenuProd;
