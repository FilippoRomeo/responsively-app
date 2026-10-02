import {app, BrowserWindow, ipcMain, webContents} from 'electron';
import {IPC_MAIN_CHANNELS} from '../common/constants';
import store from '../store';
import {sessionRequest} from './sessions/service';

/**
 * Page sound for this window. One owner per window: a Session's mute lives in
 * its registry entry (the controller pushes it here), the main window's in its
 * own store. This process mutes every page it hosts, including later ones.
 */
let muted = false;
let getWindow: () => BrowserWindow | null = () => null;

export const applyAudioMuted = (value: boolean) => {
  muted = value;
  for (const contents of webContents.getAllWebContents()) contents.setAudioMuted(value);
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send(IPC_MAIN_CHANNELS.AUDIO_MUTED_CHANGED, value);
};

export const initAudioMute = (windowGetter: () => BrowserWindow | null) => {
  getWindow = windowGetter;
  const sessionId = process.env.RESPONSIVELY_SESSION_ID;
  muted = sessionId
    ? process.env.RESPONSIVELY_SESSION_MUTED === 'true'
    : store.get('audioMuted') === true;
  app.on('web-contents-created', (_event, contents) => contents.setAudioMuted(muted));

  const fromAppWindow = (event: Electron.IpcMainInvokeEvent) => {
    const win = getWindow();
    if (!win || event.sender !== win.webContents) throw new Error('Invalid application window');
  };
  ipcMain.handle(IPC_MAIN_CHANNELS.AUDIO_MUTED_GET, (event) => {
    fromAppWindow(event);
    return muted;
  });
  ipcMain.handle(IPC_MAIN_CHANNELS.AUDIO_MUTED_SET, async (event, value: unknown) => {
    fromAppWindow(event);
    if (typeof value !== 'boolean') throw new Error('Expected a boolean');
    if (sessionId) {
      // The controller saves it and pushes it back through the runtime endpoint.
      await sessionRequest({operation: 'mute', id: sessionId, muted: value, source: 'user'});
    } else {
      store.set('audioMuted', value);
      applyAudioMuted(value);
    }
    return muted;
  });
};
