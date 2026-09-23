import {IPC_MAIN_CHANNELS} from 'common/constants';
import {createRoot} from 'react-dom/client';

const container = document.getElementById('root')!;
const root = createRoot(container);

interface AppMeta {
  webviewPreloadPath: string;
  appVersion?: string;
  isE2E?: boolean;
  platform?: NodeJS.Platform;
}

if (new URLSearchParams(window.location.search).has('sessionsPanel')) {
  void import('./sessions-panel');
} else {
  void (async () => {
    try {
      const arg = await window.electron.ipcRenderer.invoke<unknown, AppMeta>(
        IPC_MAIN_CHANNELS.APP_META,
        []
      );
      window.responsively = {
        webviewPreloadPath: arg.webviewPreloadPath,
        appVersion: arg.appVersion ?? '0.0.0',
        isE2E: Boolean(arg.isE2E),
        platform: arg.platform ?? 'darwin',
      };
      const {default: App} = await import('./AppContent');
      root.render(<App />);
    } catch (err) {
      console.error(err);
    }
  })();
}
