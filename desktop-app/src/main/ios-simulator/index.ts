import {execFile, spawn} from 'child_process';
import {app, ipcMain, nativeImage} from 'electron';
import {existsSync, mkdtempSync, rmSync, statSync} from 'fs';
import {tmpdir} from 'os';
import path from 'path';
import {promisify} from 'util';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import type {IosSimRequest, IosSimState, IosSimStream} from '../../common/ios-simulator';
import {simulatorModel} from '../../common/ios-simulator';

const exec = promisify(execFile);
const BIG = {maxBuffer: 64 * 1024 * 1024};
// Simulators this app made carry this prefix, so Settings only lists (and
// deletes) its own, never the ones the user made in Xcode.
const PREFIX = 'Responsively ';
const UDID = /^[0-9A-F-]{36}$/i;

const simctl = async (...args: string[]) => (await exec('xcrun', ['simctl', ...args], BIG)).stdout;
const simctlJson = async (...args: string[]) => JSON.parse(await simctl(...args, '-j'));

// serve-sim ships native helpers, so it must run from the unpacked copy; Electron
// runs its CLI as plain Node.
const serveSimScript = () =>
  [
    path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'node_modules'),
    path.join(app.getAppPath(), 'node_modules'),
    path.join(process.cwd(), 'release/app/node_modules'),
  ]
    .map((dir) => path.join(dir, 'serve-sim/dist/serve-sim.js'))
    .find((file) => existsSync(file));

const serveSim = async (...args: string[]) => {
  const script = serveSimScript();
  if (!script) throw new Error('serve-sim is not installed');
  const {stdout} = await exec(process.execPath, [script, ...args, '-q'], {
    ...BIG,
    env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
  });
  return JSON.parse(stdout.trim().split('\n').pop() || '{}');
};

const dirBytes = async (dir: string) => {
  try {
    const {stdout} = await exec('du', ['-sk', dir]);
    return Number(stdout.split('\t')[0]) * 1024;
  } catch {
    return 0;
  }
};

const lastWritten = (file: string) => {
  try {
    return statSync(file).mtime.toISOString();
  } catch {
    return undefined;
  }
};

type SimDevice = {name: string; udid: string; state: string; dataPath: string; runtime: string};

const ourDevices = async (): Promise<SimDevice[]> => {
  const {devices} = await simctlJson('list', 'devices');
  return Object.entries(devices as Record<string, Omit<SimDevice, 'runtime'>[]>).flatMap(
    ([runtime, list]) => list.filter((d) => d.name.startsWith(PREFIX)).map((d) => ({...d, runtime}))
  );
};

const list = async (): Promise<IosSimState> => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return {available: false, reason: 'Needs a Mac with Apple silicon', runtimes: [], devices: []};
  }
  try {
    const [{runtimes}, images, devices] = await Promise.all([
      simctlJson('list', 'runtimes'),
      simctlJson('runtime', 'list'),
      ourDevices(),
    ]);
    const imageFor = (id: string) =>
      Object.values(
        images as Record<
          string,
          {
            runtimeIdentifier: string;
            identifier: string;
            sizeBytes: number;
            deletable: boolean;
            lastUsedAt?: string;
          }
        >
      ).find((i) => i.runtimeIdentifier === id);
    return {
      available: true,
      runtimes: (
        runtimes as {
          identifier: string;
          name: string;
          platform: string;
          isAvailable: boolean;
          supportedDeviceTypes?: {name: string}[];
        }[]
      )
        .filter((r) => r.platform === 'iOS' && r.isAvailable)
        .map((r) => ({
          id: r.identifier,
          name: r.name,
          sizeBytes: imageFor(r.identifier)?.sizeBytes ?? 0,
          deletable: imageFor(r.identifier)?.deletable ?? false,
          lastUsedAt: imageFor(r.identifier)?.lastUsedAt,
          deviceNames: (r.supportedDeviceTypes ?? []).map((t) => t.name),
        })),
      devices: await Promise.all(
        devices.map(async (d) => ({
          udid: d.udid,
          name: d.name.slice(PREFIX.length),
          runtime: d.runtime,
          booted: d.state === 'Booted',
          sizeBytes: await dirBytes(path.dirname(d.dataPath)),
          // CoreSimulator rewrites device.plist on every boot and shutdown.
          lastUsedAt: lastWritten(path.join(path.dirname(d.dataPath), 'device.plist')),
        }))
      ),
    };
  } catch (error) {
    return {
      available: false,
      reason: 'Xcode and its iOS Simulator are not installed',
      runtimes: [],
      devices: [],
    };
  }
};

const ensureDevice = async (appDeviceName: string, runtime: string) => {
  const deviceName = simulatorModel(appDeviceName);
  const existing = (await ourDevices()).find(
    (d) => d.name === PREFIX + deviceName && d.runtime === runtime
  );
  if (existing) return existing.udid;
  const {devicetypes} = await simctlJson('list', 'devicetypes');
  const type = (devicetypes as {name: string; identifier: string}[]).find(
    (t) => t.name === deviceName
  );
  if (!type) throw new Error(`No iOS Simulator model is called ${deviceName}`);
  return (await simctl('create', PREFIX + deviceName, type.identifier, runtime)).trim();
};

// Simulators this process booted; stopped again when the app quits.
const booted = new Set<string>();

const start = async (deviceName: string, runtime: string): Promise<IosSimStream> => {
  const udid = await ensureDevice(deviceName, runtime);
  const device = (await ourDevices()).find((d) => d.udid === udid);
  if (device?.state !== 'Booted') {
    await simctl('boot', udid);
    booted.add(udid);
  }
  await simctl('bootstatus', udid, '-b');
  const running = await serveSim('--list', udid);
  const stream = running?.running ? running : await serveSim(udid, '--detach');
  return {udid, streamUrl: stream.streamUrl, wsUrl: stream.wsUrl};
};

/** The Simulator's own pixels for a device showing iOS Safari; null until it has booted. */
export const simulatorScreenshot = async (appDeviceName: string, runtime: string) => {
  const deviceName = simulatorModel(appDeviceName);
  const device = (await ourDevices()).find(
    (d) => d.name === PREFIX + deviceName && d.runtime === runtime && d.state === 'Booted'
  );
  if (!device) return null;
  const dir = mkdtempSync(path.join(tmpdir(), 'responsively-sim-'));
  try {
    const file = path.join(dir, 'screen.png');
    await simctl('io', device.udid, 'screenshot', file);
    return nativeImage.createFromPath(file);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
};

const stop = async (udid: string) => {
  await serveSim('--kill', udid).catch(() => {});
  await simctl('shutdown', udid).catch(() => {});
  booted.delete(udid);
};

const handle = async (req: IosSimRequest): Promise<unknown> => {
  switch (req.operation) {
    case 'list':
      return list();
    case 'start':
      return start(req.deviceName, req.runtime);
    case 'open-url': {
      if (!UDID.test(req.udid) || !/^https?:\/\//i.test(req.url)) throw new Error('Bad request');
      await simctl('openurl', req.udid, req.url);
      return {done: true};
    }
    case 'stop':
      if (!UDID.test(req.udid)) throw new Error('Bad request');
      await stop(req.udid);
      return {done: true};
    case 'delete-device': {
      if (!(await ourDevices()).some((d) => d.udid === req.udid)) throw new Error('Not ours');
      await stop(req.udid);
      await simctl('delete', req.udid);
      return {done: true};
    }
    case 'delete-runtime': {
      const images = await simctlJson('runtime', 'list');
      const image = Object.values(
        images as Record<string, {runtimeIdentifier: string; identifier: string}>
      ).find((i) => i.runtimeIdentifier === req.runtime);
      if (!image) throw new Error('Not installed');
      await simctl('runtime', 'delete', image.identifier);
      return {done: true};
    }
    default:
      throw new Error('Unknown operation');
  }
};

export const initIosSimulatorHandlers = () => {
  ipcMain.handle(IPC_MAIN_CHANNELS.IOS_SIMULATOR, (_, req: IosSimRequest) => handle(req));
  // A shutdown takes seconds; hand it to a detached process that outlives the
  // app. serve-sim's helper exits by itself once its Simulator is down.
  app.on('will-quit', () => {
    booted.forEach((udid) => {
      spawn('xcrun', ['simctl', 'shutdown', udid], {detached: true, stdio: 'ignore'}).unref();
    });
  });
};
