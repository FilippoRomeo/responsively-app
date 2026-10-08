/* eslint-disable @typescript-eslint/no-explicit-any -- CDP payloads are untyped by Electron */
import path from 'path';
import {ipcMain, shell, webContents, type WebContents} from 'electron';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import type {McpCaptureTargetsResult} from '../../common/mcp';
import {
  clampCpu,
  describeConditions,
  expandMatrix,
  isNoConditions,
  NETWORK_PRESET_IDS,
  networkToCdp,
  NO_CONDITIONS,
  type ColorScheme,
  type NetworkPreset,
  type TestConditions,
} from '../../common/test-conditions';
import type {CellResult, TestReport} from '../../common/test-report';
import {acquireDebugger, releaseDebugger} from '../cdp';
import {isRegisteredWebview} from '../webview-registry';
import {captureImage} from '../screenshot';
import {GetMainWindow, sendBridgeCommand} from '../mcp/bridge';
import {normalizeUrl} from '../mcp/utils';
import {
  deleteReport,
  listReports,
  newReportId,
  pruneReports,
  readReportWithImages,
  reportFolder,
  saveReport,
  saveScreenshot,
} from './reports';

const OWNER = 'tests';
const LOAD_TIMEOUT_MS = 45_000;
const RUN_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_SETTLE_MS = 500;
const MAX_MESSAGES = 10;
const NOISE = /Electron Security Warning/;

let getWindow: GetMainWindow | undefined;
const send = (channel: string, payload: unknown) => {
  const win = getWindow?.();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// ---- Conditions on a device -------------------------------------------------

/** What each device shows right now: set by an agent, or by a run in progress. */
const active = new Map<number, TestConditions>();
const publish = () =>
  send(
    IPC_MAIN_CHANNELS.TEST_CONDITIONS,
    Object.fromEntries([...active].map(([id, c]) => [id, describeConditions(c)]))
  );

const applyToPage = async (dbg: Electron.Debugger, c: TestConditions) => {
  await dbg.sendCommand('Network.enable');
  await dbg.sendCommand('Network.emulateNetworkConditions', networkToCdp(c.network));
  await dbg.sendCommand('Emulation.setCPUThrottlingRate', {rate: c.cpu});
};

const targetOf = (id: number): WebContents => {
  const contents = isRegisteredWebview(id) ? webContents.fromId(id) : undefined;
  if (!contents || contents.isDestroyed()) throw new Error('That preview is no longer open.');
  return contents;
};

export const setConditions = async (webContentsId: number, next: Partial<TestConditions>) => {
  if (running) throw new Error('A test is running; wait for it to finish or stop it first.');
  const contents = targetOf(webContentsId);
  const merged: TestConditions = {
    ...(active.get(webContentsId) ?? NO_CONDITIONS),
    ...next,
    cpu: clampCpu(next.cpu ?? active.get(webContentsId)?.cpu ?? 1),
  };
  const dbg = acquireDebugger(contents, OWNER);
  await applyToPage(dbg, merged);
  if (next.scheme !== undefined)
    await dbg.sendCommand('Emulation.setEmulatedMedia', {
      features: [{name: 'prefers-color-scheme', value: merged.scheme ?? ''}],
    });
  if (isNoConditions(merged)) {
    active.delete(webContentsId);
    releaseDebugger(contents, OWNER);
  } else active.set(webContentsId, merged);
  publish();
  return merged;
};

export const clearConditions = async (webContentsId: number) => {
  if (!active.has(webContentsId)) return;
  const contents = webContents.fromId(webContentsId);
  active.delete(webContentsId);
  if (contents && !contents.isDestroyed()) {
    try {
      const dbg = acquireDebugger(contents, OWNER);
      await applyToPage(dbg, NO_CONDITIONS);
      await dbg.sendCommand('Emulation.setEmulatedMedia', {
        features: [{name: 'prefers-color-scheme', value: ''}],
      });
    } finally {
      releaseDebugger(contents, OWNER);
    }
    // The device's own colour scheme was cleared with it: tell the window to put it back.
    send(IPC_MAIN_CHANNELS.TEST_RESTORE_SCHEME, webContentsId);
  }
  publish();
};

// ---- One measurement --------------------------------------------------------

interface Collector {
  requests: number;
  bytes: number;
  urls: Map<string, string>;
  failed: {url: string; error: string}[];
  errors: number;
  warnings: number;
  messages: string[];
}
const newCollector = (): Collector => ({
  requests: 0,
  bytes: 0,
  urls: new Map(),
  failed: [],
  errors: 0,
  warnings: 0,
  messages: [],
});

const collect = (c: Collector, method: string, params: any) => {
  const note = (kind: 'error' | 'warning', text: string) => {
    if (NOISE.test(text)) return;
    if (kind === 'error') c.errors += 1;
    else c.warnings += 1;
    if (c.messages.length < MAX_MESSAGES) c.messages.push(`${kind}: ${text.slice(0, 200)}`);
  };
  switch (method) {
    case 'Network.requestWillBeSent':
      c.requests += 1;
      c.urls.set(params.requestId, params.request?.url ?? '');
      break;
    case 'Network.loadingFinished':
      c.bytes += params.encodedDataLength ?? 0;
      break;
    case 'Network.loadingFailed':
      if (!params.canceled && c.failed.length < 20)
        c.failed.push({
          url: c.urls.get(params.requestId) ?? '',
          error: params.errorText ?? 'failed',
        });
      break;
    case 'Runtime.consoleAPICalled':
      if (params.type === 'error' || params.type === 'warning')
        note(
          params.type,
          params.args?.map((a: any) => a.value ?? a.description ?? '').join(' ') ?? ''
        );
      break;
    case 'Runtime.exceptionThrown':
      note(
        'error',
        params.exceptionDetails?.exception?.description ??
          params.exceptionDetails?.text ??
          'exception'
      );
      break;
    case 'Log.entryAdded':
      if (params.entry?.level === 'error' || params.entry?.level === 'warning')
        note(params.entry.level, params.entry.text ?? '');
      break;
    default:
  }
};

const PAGE_PROBE = `(async () => {
  const nav = performance.getEntriesByType('navigation')[0];
  const last = (type) => new Promise((resolve) => {
    try {
      let value = null;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) value = e; }).observe({type, buffered: true});
      setTimeout(() => resolve(value), 100);
    } catch { resolve(null); }
  });
  const lcp = await last('largest-contentful-paint');
  let cls = 0;
  try {
    await new Promise((resolve) => {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({type: 'layout-shift', buffered: true});
      setTimeout(resolve, 100);
    });
  } catch { cls = null; }
  const root = document.documentElement;
  return {
    ttfb: nav ? nav.responseStart : null,
    dcl: nav ? nav.domContentLoadedEventEnd : null,
    load: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null,
    lcp: lcp ? lcp.startTime : null,
    cls,
    scrollWidth: root.scrollWidth,
    viewportWidth: window.innerWidth,
    url: location.href,
  };
})()`;

const metricsOf = async (dbg: Electron.Debugger) => {
  const {metrics} = await dbg.sendCommand('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m: any) => [m.name, m.value])) as Record<string, number>;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

interface Target {
  webContentsId: number;
  deviceName: string;
  width: number;
  height: number;
  url: string;
}

let stopRequested = false;
let stopWake: (() => void) | undefined;
const stopped = () =>
  new Promise<'stopped'>((resolve) => {
    stopWake = () => resolve('stopped');
    if (stopRequested) resolve('stopped');
  });

const measure = async (
  contents: WebContents,
  dbg: Electron.Debugger,
  target: Target,
  page: string,
  conditions: TestConditions,
  index: number,
  opts: {settleMs: number; reportId: string; screenshots: boolean}
): Promise<CellResult> => {
  const collector = newCollector();
  const listener = (_e: unknown, method: string, params: any) => collect(collector, method, params);
  dbg.on('message', listener);
  const result: CellResult = {
    index,
    device: {name: target.deviceName, width: target.width, height: target.height},
    page,
    finalUrl: null,
    conditions,
    loaded: false,
    timings: {ttfbMs: null, domContentLoadedMs: null, loadMs: null, lcpMs: null, cls: null},
    transfer: {requests: 0, bytes: 0, failed: []},
    cpu: {scriptMs: null, taskMs: null},
    memory: {jsHeapMB: null},
    console: {errors: 0, warnings: 0, messages: []},
    layout: {horizontalOverflow: null, scrollWidth: null, viewportWidth: null},
  };
  try {
    await applyToPage(dbg, conditions);
    await dbg.sendCommand('Emulation.setEmulatedMedia', {
      features: [{name: 'prefers-color-scheme', value: conditions.scheme ?? ''}],
    });
    const before = await metricsOf(dbg);
    let failure: string | undefined;
    const onFail = (
      _e: unknown,
      _code: number,
      description: string,
      _url: string,
      isMain: boolean
    ) => {
      if (isMain) failure = description;
    };
    contents.on('did-fail-load', onFail as never);
    const finished = new Promise<'done'>((resolve) =>
      contents.once('did-stop-loading', () => resolve('done'))
    );
    contents.loadURL(page).catch(() => undefined);
    const outcome = await Promise.race([
      finished,
      sleep(LOAD_TIMEOUT_MS).then(() => 'timeout' as const),
      stopped(),
    ]);
    contents.removeListener('did-fail-load', onFail as never);
    if (outcome === 'timeout') {
      contents.stop();
      result.error = `The page did not finish loading in ${LOAD_TIMEOUT_MS / 1000} s under ${describeConditions(conditions)}.`;
    } else if (outcome === 'stopped') {
      result.error = 'Stopped before this page finished loading.';
    } else if (failure) result.error = `Load failed: ${failure}`;
    else result.loaded = true;

    if (outcome === 'done') await sleep(opts.settleMs);
    if (outcome !== 'stopped') {
      try {
        const probe: any = await contents.executeJavaScript(PAGE_PROBE, true);
        result.finalUrl = probe.url ?? null;
        result.timings = {
          ttfbMs: probe.ttfb,
          domContentLoadedMs: probe.dcl,
          loadMs: probe.load,
          lcpMs: probe.lcp,
          cls: probe.cls === null ? null : Math.round(probe.cls * 1000) / 1000,
        };
        result.layout = {
          horizontalOverflow: probe.scrollWidth > probe.viewportWidth + 1,
          scrollWidth: probe.scrollWidth,
          viewportWidth: probe.viewportWidth,
        };
      } catch {
        // an error page or a page that blocks scripts: the numbers below still stand
      }
      const after = await metricsOf(dbg);
      result.cpu = {
        scriptMs: Math.round(((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000),
        taskMs: Math.round(((after.TaskDuration ?? 0) - (before.TaskDuration ?? 0)) * 1000),
      };
      result.memory.jsHeapMB = Math.round(((after.JSHeapUsedSize ?? 0) / 1e6) * 10) / 10;
      if (opts.screenshots) {
        const image = await captureImage(target.webContentsId).catch(() => undefined);
        if (image && !image.isEmpty()) {
          const name = `cell-${String(index + 1).padStart(2, '0')}.jpg`;
          const small = image.getSize().width > 800 ? image.resize({width: 800}) : image;
          saveScreenshot(opts.reportId, name, small.toJPEG(70));
          result.screenshot = name;
        }
      }
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    dbg.removeListener('message', listener as never);
    result.transfer = {
      requests: collector.requests,
      bytes: collector.bytes,
      failed: collector.failed,
    };
    result.console = {
      errors: collector.errors,
      warnings: collector.warnings,
      messages: collector.messages,
    };
  }
  return result;
};

// ---- A run ------------------------------------------------------------------

export interface RunRequest {
  pages?: string[];
  devices?: string[];
  networks?: NetworkPreset[];
  cpus?: number[];
  schemes?: (ColorScheme | null)[];
  settleMs?: number;
  screenshots?: boolean;
  startedBy: 'agent' | 'user';
}

let running = false;
export const isTestRunning = () => running;

export const stopRun = () => {
  stopRequested = true;
  stopWake?.();
};

export const runTest = async (
  getMainWindow: GetMainWindow,
  req: RunRequest
): Promise<TestReport> => {
  if (running) throw new Error('A test is already running.');
  running = true;
  stopRequested = false;
  getWindow = getMainWindow;
  const id = newReportId();
  const report: TestReport = {
    id,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    startedBy: req.startedBy,
    skipped: [],
    request: {
      pages: [],
      devices: [],
      networks: req.networks ?? ['none'],
      cpus: req.cpus ?? [1],
      schemes: req.schemes ?? [null],
    },
    cells: [],
  };
  const held: {contents: WebContents; originalUrl: string}[] = [];
  const priorManual = new Map(active);
  try {
    // Which previews, in the window's order; real iOS Safari is screenshot-only.
    const wanted = req.devices ?? [];
    const lookups =
      wanted.length > 0
        ? await Promise.all(
            wanted.map((device) =>
              sendBridgeCommand<McpCaptureTargetsResult>(getMainWindow, 'get-capture-targets', {
                device,
              })
            )
          )
        : [
            await sendBridgeCommand<McpCaptureTargetsResult>(
              getMainWindow,
              'get-capture-targets',
              {}
            ),
          ];
    const targets: Target[] = [];
    lookups
      .flatMap((l) => l.targets)
      .forEach((t) => {
        if (targets.some((x) => x.webContentsId === t.webContentsId)) return;
        if (t.iosRuntime)
          report.skipped.push({
            device: t.deviceName,
            reason: 'Real iOS Safari: only screenshots work there, not measurements.',
          });
        else targets.push(t as Target);
      });
    lookups
      .flatMap((l) => l.skipped ?? [])
      .forEach((s) => report.skipped.push({device: s.deviceName, reason: s.reason}));
    if (targets.length === 0) throw new Error('No Chromium preview to test: open a device first.');
    const pages = (req.pages && req.pages.length > 0 ? req.pages : [targets[0].url]).map(
      normalizeUrl
    );
    if (pages.some((p) => p === 'about:blank' || p === ''))
      throw new Error('Nothing is loaded yet: give a page to test.');
    const cells = expandMatrix({
      pages,
      devices: targets.map((t) => t.deviceName),
      networks: report.request.networks as NetworkPreset[],
      cpus: report.request.cpus,
      schemes: report.request.schemes as (ColorScheme | null)[],
    });
    report.request.pages = pages;
    report.request.devices = targets.map((t) => t.deviceName);
    saveReport(report);
    const started = Date.now();
    send(IPC_MAIN_CHANNELS.TEST_RUN_STATE, {
      running: true,
      done: 0,
      total: cells.length,
      label: 'Starting',
      id,
    });
    for (const cell of cells) {
      if (stopRequested) {
        report.status = 'stopped';
        break;
      }
      if (Date.now() - started > RUN_TIMEOUT_MS) {
        report.status = 'stopped';
        report.note = 'Stopped after 15 minutes; later measurements were not taken.';
        break;
      }
      const target = targets.find((t) => t.deviceName === cell.device)!;
      const contents = targetOf(target.webContentsId);
      if (!held.some((h) => h.contents.id === contents.id))
        held.push({contents, originalUrl: contents.getURL()});
      const dbg = acquireDebugger(contents, OWNER);
      await dbg.sendCommand('Network.enable');
      await dbg.sendCommand('Performance.enable');
      await dbg.sendCommand('Runtime.enable');
      await dbg.sendCommand('Log.enable');
      await dbg.sendCommand('Network.setCacheDisabled', {cacheDisabled: true});
      active.set(contents.id, cell.conditions);
      publish();
      send(IPC_MAIN_CHANNELS.TEST_RUN_STATE, {
        running: true,
        done: cell.index,
        total: cells.length,
        label: `${cell.device} · ${describeConditions(cell.conditions)}`,
        id,
      });
      report.cells.push(
        await measure(contents, dbg, target, cell.page, cell.conditions, cell.index, {
          settleMs: Math.min(5000, Math.max(0, req.settleMs ?? DEFAULT_SETTLE_MS)),
          reportId: id,
          screenshots: req.screenshots !== false,
        })
      );
      saveReport(report);
    }
    if (report.status === 'running') report.status = stopRequested ? 'stopped' : 'complete';
  } catch (error) {
    report.status = 'failed';
    report.note = error instanceof Error ? error.message : String(error);
  } finally {
    // Always put every preview back: conditions, cache, colour scheme and page.
    for (const {contents, originalUrl} of held) {
      if (contents.isDestroyed()) continue;
      try {
        const dbg = acquireDebugger(contents, OWNER);
        await dbg.sendCommand('Network.setCacheDisabled', {cacheDisabled: false});
        const manual = priorManual.get(contents.id) ?? NO_CONDITIONS;
        await applyToPage(dbg, manual);
        await dbg.sendCommand('Emulation.setEmulatedMedia', {
          features: [{name: 'prefers-color-scheme', value: manual.scheme ?? ''}],
        });
        if (isNoConditions(manual)) active.delete(contents.id);
        else active.set(contents.id, manual);
        send(IPC_MAIN_CHANNELS.TEST_RESTORE_SCHEME, contents.id);
        if (originalUrl && contents.getURL() !== originalUrl)
          contents.loadURL(originalUrl).catch(() => undefined);
      } catch {
        // the preview closed during the run
      } finally {
        releaseDebugger(contents, OWNER);
      }
    }
    report.finishedAt = new Date().toISOString();
    try {
      saveReport(report);
      pruneReports();
    } catch {
      /* the report folder could not be written: the result is still returned */
    }
    publish();
    send(IPC_MAIN_CHANNELS.TEST_RUN_STATE, {
      running: false,
      done: report.cells.length,
      total: report.cells.length,
      label: '',
      id,
    });
    running = false;
  }
  return report;
};

// ---- The window's side ------------------------------------------------------

export const initTestEngine = (windowGetter: GetMainWindow) => {
  getWindow = windowGetter;
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TEST_RUN_STOP);
  ipcMain.handle(IPC_MAIN_CHANNELS.TEST_RUN_STOP, () => stopRun());
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TEST_CONDITIONS_CLEAR);
  ipcMain.handle(IPC_MAIN_CHANNELS.TEST_CONDITIONS_CLEAR, (_e, webContentsId: unknown) => {
    if (typeof webContentsId === 'number') return clearConditions(webContentsId);
    return undefined;
  });
  // The probe panel: apply conditions to one preview, or run a list of them.
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TEST_CONDITIONS_SET);
  ipcMain.handle(IPC_MAIN_CHANNELS.TEST_CONDITIONS_SET, (_e, webContentsId: unknown, next: any) => {
    if (typeof webContentsId !== 'number') throw new Error('Expected a preview id');
    const patch: Partial<TestConditions> = {};
    if (NETWORK_PRESET_IDS.includes(next?.network)) patch.network = next.network;
    if (typeof next?.cpu === 'number') patch.cpu = next.cpu;
    if (next?.scheme === 'light' || next?.scheme === 'dark' || next?.scheme === null)
      patch.scheme = next.scheme;
    return setConditions(webContentsId, patch);
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TEST_RUN_START);
  ipcMain.handle(IPC_MAIN_CHANNELS.TEST_RUN_START, (_e, req: any) => {
    const strings = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string').slice(0, 8)
        : undefined;
    return runTest(windowGetter, {
      pages: Array.isArray(req?.pages)
        ? req.pages.filter((p: unknown): p is string => typeof p === 'string').slice(0, 10)
        : undefined,
      devices: strings(req?.devices),
      networks: (strings(req?.networks) ?? []).filter((n): n is NetworkPreset =>
        NETWORK_PRESET_IDS.includes(n as NetworkPreset)
      ),
      cpus: Array.isArray(req?.cpus)
        ? req.cpus.filter((c: unknown): c is number => typeof c === 'number').slice(0, 4)
        : undefined,
      schemes: Array.isArray(req?.schemes)
        ? req.schemes
            .filter((s: unknown) => s === 'light' || s === 'dark' || s === null)
            .slice(0, 2)
        : undefined,
      startedBy: 'user',
    });
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TEST_REPORT_READ);
  ipcMain.handle(IPC_MAIN_CHANNELS.TEST_REPORT_READ, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Expected a report id');
    return readReportWithImages(id);
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TEST_REPORT_REVEAL);
  ipcMain.handle(IPC_MAIN_CHANNELS.TEST_REPORT_REVEAL, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Expected a report id');
    shell.showItemInFolder(path.join(reportFolder(id), 'report.md'));
  });
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TEST_REPORTS_LIST);
  ipcMain.handle(IPC_MAIN_CHANNELS.TEST_REPORTS_LIST, () => listReports());
  ipcMain.removeHandler(IPC_MAIN_CHANNELS.TEST_REPORTS_DELETE);
  ipcMain.handle(IPC_MAIN_CHANNELS.TEST_REPORTS_DELETE, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Expected a report id');
    deleteReport(id);
  });
};
