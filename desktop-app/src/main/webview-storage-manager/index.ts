import {ClearStorageDataOptions, ipcMain, Session, WebContents, webContents} from 'electron';
import {readdir, stat} from 'fs/promises';
import path from 'path';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {isRegisteredWebview} from '../webview-registry';

export interface DeleteStorageArgs {
  webContentsId: number;
  storages?: string[];
}

export interface DeleteStorageResult {
  done: boolean;
}

/** Bytes on disk (cookies also counted) of this window's profile, by kind. */
export interface WindowDataUsage {
  cache: number;
  cookies: number;
  cookieBytes: number;
  storage: number;
  serviceWorkers: number;
}

const deleteStorage = async (arg: DeleteStorageArgs): Promise<DeleteStorageResult> => {
  const {webContentsId, storages} = arg;
  if (!isRegisteredWebview(webContentsId)) {
    return {done: false};
  }
  if (storages?.length === 1 && storages[0] === 'network-cache') {
    await webContents.fromId(webContentsId)?.session.clearCache();
  } else {
    await webContents
      .fromId(webContentsId)
      ?.session.clearStorageData({storages} as ClearStorageDataOptions);
  }
  return {done: true};
};

// Cached code entries; the cache's own index files are bookkeeping, not code.
const codeCacheSize = async (dir: string): Promise<number> => {
  const entries = await readdir(dir, {withFileTypes: true}).catch(() => []);
  const sizes = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'index-dir' ? 0 : codeCacheSize(full);
      if (entry.name === 'index') return 0;
      return stat(full).then(
        (s) => s.size,
        () => 0
      );
    })
  );
  return sizes.reduce((a, b) => a + b, 0);
};

// What one page's site stores, as the site itself sees it. Disk folders are no
// use here: the databases log a deletion as new writes and only shrink later.
const PAGE_USAGE = `(async () => {
  const details = (await navigator.storage?.estimate?.())?.usageDetails ?? {};
  let local = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? '';
      local += (key.length + (localStorage.getItem(key) ?? '').length) * 2;
    }
  } catch {}
  return {
    storage: (details.indexedDB ?? 0) + (details.fileSystem ?? 0) + local,
    serviceWorkers: (details.serviceWorkerRegistrations ?? 0) + (details.caches ?? 0),
  };
})()`;

const siteUsage = async () => {
  const byOrigin = new Map<string, WebContents>();
  webContents.getAllWebContents().forEach((wc) => {
    if (wc.getType() !== 'webview' || wc.isDestroyed()) return;
    const origin = URL.parse(wc.getURL())?.origin ?? wc.getURL();
    if (!byOrigin.has(origin)) byOrigin.set(origin, wc);
  });
  const results = await Promise.all(
    [...byOrigin.values()].map((wc) =>
      Promise.race([
        wc.executeJavaScript(PAGE_USAGE) as Promise<{storage: number; serviceWorkers: number}>,
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), 1000);
        }),
      ]).catch(() => null)
    )
  );
  return {
    storage: results.reduce((a, r) => a + (r?.storage ?? 0), 0),
    serviceWorkers: results.reduce((a, r) => a + (r?.serviceWorkers ?? 0), 0),
  };
};

// Every Session window is its own process with its own profile, and previews
// use the default session, so the sender's session is exactly "this window".
// Site storage is counted for the sites open in the previews (clearing still
// empties every site's).
const usage = async (ses: Session): Promise<WindowDataUsage> => {
  const cookies = await ses.cookies.get({});
  const sites = await siteUsage();
  return {
    cache:
      (await ses.getCacheSize()) +
      (await codeCacheSize(path.join(ses.storagePath ?? '', 'Code Cache'))),
    cookies: cookies.length,
    cookieBytes: cookies.reduce((a, c) => a + c.name.length + c.value.length, 0),
    ...sites,
  };
};

const clearAll = async (ses: Session) => {
  await ses.clearCache();
  await ses.clearCodeCaches({});
  await ses.clearAuthCache();
  await ses.clearStorageData();
};

export const initWebviewStorageManagerHandlers = () => {
  ipcMain.handle(
    IPC_MAIN_CHANNELS.DELETE_STORAGE,
    async (_, arg: DeleteStorageArgs): Promise<DeleteStorageResult> => {
      return deleteStorage(arg);
    }
  );
  ipcMain.handle(IPC_MAIN_CHANNELS.WINDOW_DATA_USAGE, (event) => usage(event.sender.session));
  ipcMain.handle(IPC_MAIN_CHANNELS.WINDOW_DATA_CLEAR, async (event) => {
    await clearAll(event.sender.session);
    return usage(event.sender.session);
  });
};
