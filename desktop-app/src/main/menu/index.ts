import {app, Menu, BrowserWindow, MenuItemConstructorOptions} from 'electron';
import {subMenuHelp} from './help';
import {getViewMenu} from './view';
import {AppUpdater} from '../app-updater';
import {sessionsMenu} from '../sessions/runtime';
import {quitFromSessionWindow} from '../sessions/window-lifecycle';

interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
  selector?: string;
  submenu?: DarwinMenuItemConstructorOptions[] | Menu;
}

export interface ReloadArgs {
  ignoreCache?: boolean;
}

export default class MenuBuilder {
  mainWindow: BrowserWindow | null;

  appUpdater: AppUpdater;

  constructor(mainWindow: BrowserWindow | null, appUpdater: AppUpdater) {
    this.mainWindow = mainWindow;
    this.appUpdater = appUpdater;
  }

  buildMenu(): Menu {
    if (
      this.mainWindow &&
      (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true')
    ) {
      this.setupDevelopmentEnvironment();
    }

    const template =
      process.platform === 'darwin' ? this.buildDarwinTemplate() : this.buildDefaultTemplate();

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    return menu;
  }

  setupDevelopmentEnvironment(): void {
    const mainWindow = this.mainWindow;
    if (!mainWindow) return;
    mainWindow.webContents.on('context-menu', (_, props) => {
      const {x, y} = props;

      Menu.buildFromTemplate([
        {
          label: 'Inspect element',
          click: () => {
            mainWindow.webContents.inspectElement(x, y);
          },
        },
      ]).popup({window: mainWindow});
    });
  }

  buildDarwinTemplate(): MenuItemConstructorOptions[] {
    const subMenuAbout: DarwinMenuItemConstructorOptions = {
      label: 'ResponsivelyApp',
      submenu: [
        {
          label: 'About ResponsivelyApp',
          selector: 'orderFrontStandardAboutPanel:',
        },
        {type: 'separator'},
        {
          label: 'Hide ResponsivelyApp',
          accelerator: 'Command+H',
          selector: 'hide:',
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          selector: 'hideOtherApplications:',
        },
        {label: 'Show All', selector: 'unhideAllApplications:'},
        {type: 'separator'},
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => {
            // In a Session window ⌘Q quits the whole app, after a second press.
            if (process.env.RESPONSIVELY_SESSION_ID) void quitFromSessionWindow(this.mainWindow);
            else app.quit();
          },
        },
      ],
    };
    const subMenuEdit: DarwinMenuItemConstructorOptions = {
      label: 'Edit',
      submenu: [
        {label: 'Undo', accelerator: 'Command+Z', selector: 'undo:'},
        {label: 'Redo', accelerator: 'Shift+Command+Z', selector: 'redo:'},
        {type: 'separator'},
        {label: 'Cut', accelerator: 'Command+X', selector: 'cut:'},
        {label: 'Copy', accelerator: 'Command+C', selector: 'copy:'},
        {label: 'Paste', accelerator: 'Command+V', selector: 'paste:'},
        {
          label: 'Select All',
          accelerator: 'Command+A',
          selector: 'selectAll:',
        },
      ],
    };

    const subMenuWindow: DarwinMenuItemConstructorOptions = {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'Command+M',
          selector: 'performMiniaturize:',
        },
        {label: 'Close', accelerator: 'Command+W', selector: 'performClose:'},
        {type: 'separator'},
        {label: 'Bring All to Front', selector: 'arrangeInFront:'},
      ],
    };

    return [
      subMenuAbout,
      subMenuEdit,
      ...(this.mainWindow ? [getViewMenu(this.mainWindow)] : []),
      subMenuWindow,
      sessionsMenu(),
      subMenuHelp(this.mainWindow, this.appUpdater),
    ];
  }

  buildDefaultTemplate(): MenuItemConstructorOptions[] {
    return [
      {
        label: '&File',
        submenu: [
          {
            label: '&Open',
            accelerator: 'Ctrl+O',
          },
          {
            label: '&Close',
            accelerator: 'Ctrl+W',
            click: () => {
              this.mainWindow?.close();
            },
          },
        ],
      },
      ...(this.mainWindow ? [getViewMenu(this.mainWindow)] : []),
      sessionsMenu(),
      subMenuHelp(this.mainWindow, this.appUpdater),
    ];
  }
}
