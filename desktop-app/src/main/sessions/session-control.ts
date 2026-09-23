import {app, BrowserWindow, ipcMain} from 'electron';
import fs from 'fs';
import {z} from 'zod';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {atomicWrite, sessionName} from './registry';
import {RuntimeLease, RuntimeReply, runtimeFile} from './service';
import {serve} from '../../common/session-rpc';
import store from '../../store';
import {getMcpServerStatus} from '../mcp';
import {getBrowserSyncPort, isBrowserSyncReady} from '../browser-sync';
import {normalizeUrl} from '../mcp/utils';
import {processRole} from '../process-role';
import {currentPanel, ownerWindow as getWindow, showSessions} from './panel';

/** A Session process's own identity, window context and authenticated control endpoint. */
let name = process.env.RESPONSIVELY_SESSION_NAME;
let reopen: () => Promise<void>;

export const setReopen = (create: () => Promise<void>) => {
  reopen = create;
};

export const registerSessionContext = () => {
  ipcMain.handle(
    IPC_MAIN_CHANNELS.SESSION_CONTEXT,
    (event, value?: {url: string; title: string}) => {
      if (event.sender !== getWindow()?.webContents) throw new Error('Invalid application window');
      if (value && typeof value.url === 'string' && typeof value.title === 'string') {
        const title = [name || 'Responsively', value.title.slice(0, 200)]
          .filter(Boolean)
          .join(' — ');
        getWindow()?.setTitle(title);
        if (processRole() === 'session' && value.url) {
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
      const panel = currentPanel();
      return {
        visible: Boolean(panel?.isVisible()),
        content: panel?.isDestroyed()
          ? ''
          : await panel?.webContents.executeJavaScript('document.body?.innerText ?? ""'),
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
