/* eslint-disable @typescript-eslint/ban-ts-comment */
import BrowserSync, {BrowserSyncInstance} from 'browser-sync';
import fs from 'fs-extra';
import {resolveBrowserSyncPort} from './runtime-isolation';

const resolvedPort = resolveBrowserSyncPort();

export function getBrowserSyncPort(): number {
  return resolvedPort;
}

export function getBrowserSyncHost(): string {
  return `localhost:${resolvedPort}`;
}

const browserSyncEmbed: BrowserSyncInstance = BrowserSync.create('embed');

let created = false;
let ready = false;
export const isBrowserSyncReady = () => ready;
let filesWatcher: ReturnType<BrowserSyncInstance['watch']> | null = null;
let cssWatcher: ReturnType<BrowserSyncInstance['watch']> | null = null;

export async function initInstance(): Promise<BrowserSyncInstance> {
  if (created) {
    return browserSyncEmbed;
  }
  created = true;
  return new Promise((resolve, reject) => {
    browserSyncEmbed.init(
      {
        open: false,
        localOnly: true,
        listen: '127.0.0.1',
        https: true,
        notify: false,
        ui: false,
        port: resolvedPort,
        logLevel: 'silent',
        logSnippet: false,
      },
      (err: Error, bs: BrowserSyncInstance) => {
        if (err) {
          return reject(err);
        }
        if (Number(bs.getOption('port')) !== resolvedPort)
          return reject(new Error('BrowserSync did not bind its assigned port'));
        ready = true;
        return resolve(bs);
      }
    );
  });
}

export function watchFiles(filePath: string) {
  if (filePath && fs.existsSync(filePath)) {
    const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));

    filesWatcher = browserSyncEmbed
      // @ts-expect-error
      .watch([filePath, `${fileDir}/**/**.js`])
      .on('change', browserSyncEmbed.reload);

    cssWatcher = browserSyncEmbed.watch(
      `${fileDir}/**/**.css`,
      // @ts-expect-error
      (event: string, file: string) => {
        if (event === 'change') {
          browserSyncEmbed.reload(file);
        }
      }
    );
  }
}

export async function stopWatchFiles() {
  if (filesWatcher) {
    // @ts-expect-error
    await filesWatcher.close();
  }
  if (cssWatcher) {
    // @ts-expect-error
    await cssWatcher.close();
  }
}
