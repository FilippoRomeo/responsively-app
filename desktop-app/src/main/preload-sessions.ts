import {contextBridge, ipcRenderer} from 'electron';
import {IPC_MAIN_CHANNELS} from '../common/constants';
import {SessionRequest} from '../common/sessions';

// The utility renderer receives only Session management, theme and dismissal.
contextBridge.exposeInMainWorld('sessionsPanel', {
  context: () => ipcRenderer.sendSync(IPC_MAIN_CHANNELS.SESSIONS_PANEL_CONTEXT),
  request: (value: SessionRequest) => ipcRenderer.invoke(IPC_MAIN_CHANNELS.SESSIONS_REQUEST, value),
  dismiss: () => ipcRenderer.send(IPC_MAIN_CHANNELS.SESSIONS_PANEL_DISMISS),
  resize: (height: number) => ipcRenderer.send(IPC_MAIN_CHANNELS.SESSIONS_PANEL_RESIZE, height),
  onShow: (
    callback: (value: {
      create: boolean;
      error: string;
      attention?: string;
      darkMode: boolean;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: {create: boolean; error: string; attention?: string; darkMode: boolean}
    ) => callback(value);
    ipcRenderer.on(IPC_MAIN_CHANNELS.SESSIONS_PANEL_SHOW, listener);
    return () => ipcRenderer.removeListener(IPC_MAIN_CHANNELS.SESSIONS_PANEL_SHOW, listener);
  },
});
