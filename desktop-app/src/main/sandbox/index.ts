import path from 'path';
import {app, dialog, ipcMain, type BrowserWindow} from 'electron';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {
  sanitizeSandbox,
  validFolder,
  type SandboxSettings,
  type SandboxState,
} from '../../common/sandbox';
import store from '../../store';
import type {GetMainWindow} from '../mcp/bridge';
import {listSandboxProfiles, Sandbox} from './manager';

/** This window's Sandbox, and the IPC the Environment view uses to drive it. */
let current: Sandbox | null = null;
export const getSandbox = (): Sandbox => {
  if (!current) throw new Error('Sandboxes are not available in this window.');
  return current;
};
export const sandboxMode = () => sanitizeSandbox(store.get('sandbox')).mode;

export const initSandbox = (getMainWindow: GetMainWindow) => {
  const sessionId = process.env.RESPONSIVELY_SESSION_ID || 'main';
  const emit = (state: SandboxState) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(IPC_MAIN_CHANNELS.SANDBOX_EVENT, state);
  };
  current = new Sandbox({
    sessionId,
    sessionName: () => process.env.RESPONSIVELY_SESSION_NAME || 'Responsively',
    root: path.join(app.getPath('userData'), 'sandbox'),
    load: () => store.get('sandbox'),
    save: (settings: SandboxSettings) => store.set('sandbox', settings),
    emit,
  });
  const sandbox = current;

  ipcMain.removeHandler(IPC_MAIN_CHANNELS.SANDBOX_STATE);
  ipcMain.handle(IPC_MAIN_CHANNELS.SANDBOX_STATE, () => sandbox.refresh());
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.SANDBOX_SET);
  ipcMain.handle(IPC_MAIN_CHANNELS.SANDBOX_SET, (_e, patch: Partial<SandboxSettings>) =>
    sandbox.setSettings(patch ?? {})
  );
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.SANDBOX_ACTION);
  ipcMain.handle(IPC_MAIN_CHANNELS.SANDBOX_ACTION, (_e, action: unknown, arg: unknown) => {
    // Long actions answer with their final state; the window follows progress through events.
    switch (action) {
      case 'create':
        return sandbox.create();
      case 'start':
        return sandbox.start();
      case 'stop':
        return sandbox.stop();
      case 'restart':
        return sandbox.restart();
      case 'destroy':
        return sandbox.destroy(String(arg ?? ''));
      default:
        throw new Error('Unknown sandbox action');
    }
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.SANDBOX_DOCKER);
  ipcMain.handle(IPC_MAIN_CHANNELS.SANDBOX_DOCKER, () => sandbox.dockerContainers());
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.SANDBOX_LIST);
  ipcMain.handle(IPC_MAIN_CHANNELS.SANDBOX_LIST, () => listSandboxProfiles());
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.SANDBOX_PICK_FOLDER);
  ipcMain.handle(IPC_MAIN_CHANNELS.SANDBOX_PICK_FOLDER, async () => {
    const win: BrowserWindow | null = getMainWindow();
    const result = await (win
      ? dialog.showOpenDialog(win, {
          properties: ['openDirectory'],
          title: 'A folder to show inside the sandbox',
        })
      : dialog.showOpenDialog({properties: ['openDirectory']}));
    const folder = result.filePaths[0];
    if (result.canceled || !folder) return null;
    if (!validFolder(folder)) throw new Error('That folder cannot be shown inside a sandbox.');
    return folder;
  });
  app.on('will-quit', () => sandbox.dispose());
  // Know its state from the start, so the toolbar and the terminal are right.
  void sandbox.refresh();
};
