/* eslint-disable @typescript-eslint/no-explicit-any -- CDP payloads and Electron's console-message event vary by version */
import type {WebContents} from 'electron';
import {acquireDebugger, holdsDebugger, releaseDebugger} from './cdp';

/**
 * What an agent can read from a preview the way DevTools shows it: the console
 * (collected from the moment a preview attaches, so nothing is missed) and the
 * network (collected from the first request for it, then until the preview goes).
 */
const MAX = 300;

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warning' | 'error' | 'debug';
  text: string;
  source: string;
  line: number;
  at: string;
}
const consoles = new Map<number, ConsoleEntry[]>();

const LEVELS = ['debug', 'info', 'warning', 'error'] as const;
const levelOf = (raw: unknown): ConsoleEntry['level'] => {
  if (typeof raw === 'number')
    return raw === 3 ? 'error' : raw === 2 ? 'warning' : raw === 1 ? 'info' : 'log';
  return (LEVELS as readonly unknown[]).includes(raw) ? (raw as ConsoleEntry['level']) : 'log';
};

export const captureConsole = (guest: WebContents) => {
  const id = guest.id;
  consoles.set(id, []);
  guest.on('console-message', (...args: any[]) => {
    // Electron passes one details event now; older builds passed positional arguments.
    const d = args[0] && typeof args[0].message === 'string' ? args[0] : null;
    const entry: ConsoleEntry = {
      level: levelOf(d ? d.level : args[1]),
      text: String(d ? d.message : args[2]),
      source: String(d ? d.sourceId : (args[4] ?? '')),
      line: Number(d ? d.lineNumber : (args[3] ?? 0)),
      at: new Date().toISOString(),
    };
    const list = consoles.get(id) ?? [];
    list.push(entry);
    if (list.length > MAX) list.shift();
    consoles.set(id, list);
  });
  guest.once('destroyed', () => {
    consoles.delete(id);
    networks.delete(id);
  });
};

export const readConsole = (id: number, opts: {level?: string; clear?: boolean}) => {
  const all = consoles.get(id) ?? [];
  const rank = {debug: 0, log: 1, info: 1, warning: 2, error: 3} as const;
  const min = opts.level === 'error' ? 3 : opts.level === 'warning' ? 2 : 0;
  const shown = all.filter((e) => rank[e.level] >= min);
  if (opts.clear) consoles.set(id, []);
  return shown;
};

// ---- Network -----------------------------------------------------------------

export interface NetworkEntry {
  url: string;
  method: string;
  type: string;
  status: number | null;
  mime: string | null;
  bytes: number | null;
  ms: number | null;
  error: string | null;
  fromCache: boolean;
}
interface Live extends NetworkEntry {
  startedAt: number;
}
const OWNER = 'network';
const networks = new Map<number, Map<string, Live>>();

export const isCapturingNetwork = (id: number) => networks.has(id);

export const startNetwork = async (contents: WebContents) => {
  if (networks.has(contents.id)) return;
  const table = new Map<string, Live>();
  networks.set(contents.id, table);
  const dbg = acquireDebugger(contents, OWNER, (method, p: any) => {
    const t = networks.get(contents.id);
    if (!t) return;
    const e = t.get(p.requestId);
    switch (method) {
      case 'Network.requestWillBeSent':
        if (t.size >= MAX) t.delete(t.keys().next().value as string);
        t.set(p.requestId, {
          url: p.request.url,
          method: p.request.method,
          type: p.type ?? 'Other',
          status: null,
          mime: null,
          bytes: null,
          ms: null,
          error: null,
          fromCache: false,
          startedAt: p.timestamp,
        });
        break;
      case 'Network.responseReceived':
        if (e) {
          e.status = p.response.status;
          e.mime = p.response.mimeType ?? null;
          e.fromCache = Boolean(p.response.fromDiskCache || p.response.fromServiceWorker);
        }
        break;
      case 'Network.loadingFinished':
        if (e) {
          e.bytes = p.encodedDataLength ?? null;
          e.ms = Math.round((p.timestamp - e.startedAt) * 1000);
        }
        break;
      case 'Network.loadingFailed':
        if (e && !p.canceled) {
          e.error = p.errorText ?? 'failed';
          e.ms = Math.round((p.timestamp - e.startedAt) * 1000);
        }
        break;
      default:
    }
  });
  await dbg.sendCommand('Network.enable');
};

export const stopNetwork = (contents: WebContents) => {
  networks.delete(contents.id);
  if (holdsDebugger(contents, OWNER)) releaseDebugger(contents, OWNER);
};

export const readNetwork = (id: number, opts: {failedOnly?: boolean; urlContains?: string}) =>
  [...(networks.get(id)?.values() ?? [])]
    .filter((e) => (opts.failedOnly ? e.error !== null || (e.status ?? 0) >= 400 : true))
    .filter((e) => (opts.urlContains ? e.url.includes(opts.urlContains) : true))
    .map(({startedAt: _startedAt, ...rest}) => rest as NetworkEntry);
