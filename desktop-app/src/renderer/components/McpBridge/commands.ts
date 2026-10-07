import {Device, getDevicesMap} from 'common/deviceList';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {IosSimRequest, IosSimState, runtimeLabel} from 'common/ios-simulator';
import {
  McpActiveDevice,
  McpAppState,
  McpBridgeCommand,
  McpCaptureTargetsPayload,
  McpCaptureTargetsResult,
  McpDeviceInfo,
  McpNavigatePayload,
  McpNavigateResult,
  McpSetActiveDevicesPayload,
  McpSetActiveDevicesResult,
  McpSetDeviceBrowserPayload,
} from 'common/mcp';
import {Store} from 'redux';
import {
  selectActiveSuite,
  setDeviceBrowser,
  setSuiteDevices,
} from 'renderer/store/features/device-manager';
import {selectZoomFactor, setAddress} from 'renderer/store/features/renderer';
import type {RootState} from '../../store';
import {resolveDeviceQuery} from './deviceQuery';

type AppStore = Pick<Store<RootState>, 'getState' | 'dispatch'>;

const NAVIGATION_TIMEOUT_MS = 30_000;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const toActiveDevice = (
  device: Device,
  browsers: Record<string, string> = {}
): McpActiveDevice => ({
  id: device.id,
  name: device.name,
  width: device.width,
  height: device.height,
  type: device.type,
  browser: browsers[device.id]
    ? `iOS Safari ${runtimeLabel(browsers[device.id]).replace(/^iOS /, '')}`
    : 'Chromium',
});

const getActiveDevices = (state: RootState): Device[] => {
  const devicesMap = getDevicesMap();
  return selectActiveSuite(state)
    .devices.map((id) => devicesMap[id])
    .filter((device): device is Device => device !== undefined);
};

const getDeviceWebview = (deviceName: string): Electron.WebviewTag | null => {
  // Device names contain spaces and slashes, so getElementById instead of selectors.
  return document.getElementById(deviceName) as Electron.WebviewTag | null;
};

const getAppState = (state: RootState): McpAppState => ({
  url: state.renderer.address,
  pageTitle: state.renderer.pageTitle,
  layout: state.renderer.layout,
  zoomFactor: selectZoomFactor(state),
  activeSuite: selectActiveSuite(state).name,
  activeDevices: getActiveDevices(state).map((d) =>
    toActiveDevice(d, state.deviceManager.deviceBrowsers)
  ),
});

const listDevices = (state: RootState): McpDeviceInfo[] => {
  const activeIds = new Set(selectActiveSuite(state).devices);
  return Object.values(getDevicesMap()).map((device) => ({
    ...toActiveDevice(device, state.deviceManager.deviceBrowsers),
    isCustom: device.isCustom ?? false,
    isActive: activeIds.has(device.id),
  }));
};

const setActiveDevices = async (
  store: AppStore,
  payload: McpSetActiveDevicesPayload
): Promise<McpSetActiveDevicesResult> => {
  const queries = payload?.devices ?? [];
  if (queries.length === 0) {
    throw new Error('Provide at least one device id or name');
  }
  const devicesMap = getDevicesMap();
  const resolved: Device[] = [];
  const unmatched: string[] = [];
  queries.forEach((query) => {
    const device = resolveDeviceQuery(devicesMap, query);
    if (device === undefined) {
      unmatched.push(query);
    } else if (!resolved.some((d) => d.id === device.id)) {
      resolved.push(device);
    }
  });
  if (unmatched.length > 0) {
    throw new Error(
      `Unknown devices: ${unmatched.join(
        ', '
      )}. Use the list_devices tool to see valid ids and names.`
    );
  }
  const activeSuite = selectActiveSuite(store.getState());
  store.dispatch(
    setSuiteDevices({suite: activeSuite.id, devices: resolved.map((device) => device.id)})
  );
  // Give the new webviews a moment to mount before subsequent tool calls.
  await sleep(300);
  const {deviceBrowsers} = store.getState().deviceManager;
  return {activeDevices: resolved.map((d) => toActiveDevice(d, deviceBrowsers))};
};

const navigate = async (
  store: AppStore,
  payload: McpNavigatePayload
): Promise<McpNavigateResult> => {
  const url = payload?.url;
  if (!url) {
    throw new Error('URL is required');
  }
  const state = store.getState();
  const primaryDevice = getActiveDevices(state)[0];
  if (primaryDevice === undefined) {
    throw new Error('No active devices to navigate. Use the set_active_devices tool first.');
  }
  const webview = getDeviceWebview(primaryDevice.name);
  if (webview === null) {
    throw new Error('The device previews are not visible. Switch the app to the browser view.');
  }

  let currentUrl = '';
  try {
    currentUrl = webview.getURL();
  } catch {
    // Webview not attached yet; proceed with navigation.
  }
  if (currentUrl === url) {
    return {url, pageTitle: webview.getTitle(), loaded: true};
  }

  const loaded = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;

      clearTimeout(timer);

      webview.removeEventListener('did-stop-loading', onStopLoading);

      webview.removeEventListener('did-fail-load', onFailLoad);
      resolve(result);
    };
    const onStopLoading = () => finish(true);
    const onFailLoad = (event: Electron.DidFailLoadEvent) => {
      // -3 (ERR_ABORTED) fires for in-page interruptions; the load may still complete.
      if (event.errorCode !== -3) {
        finish(false);
      }
    };
    const timer = setTimeout(() => finish(false), NAVIGATION_TIMEOUT_MS);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('did-fail-load', onFailLoad);

    if (url === store.getState().renderer.address) {
      // Address unchanged in state (e.g. reload after user navigated away):
      // the Device effect won't fire, so drive the primary webview directly.
      webview.loadURL(url).catch(() => finish(false));
    } else {
      store.dispatch(setAddress(url));
    }
  });

  return {url: webview.getURL(), pageTitle: webview.getTitle(), loaded};
};

const getCaptureTargets = (
  state: RootState,
  payload: McpCaptureTargetsPayload
): McpCaptureTargetsResult => {
  let devices = getActiveDevices(state);
  if (payload?.device !== undefined && payload.device !== '') {
    const device = resolveDeviceQuery(getDevicesMap(), payload.device);
    if (device === undefined) {
      throw new Error(
        `Unknown device: ${payload.device}. Use the list_devices tool to see valid ids and names.`
      );
    }
    if (!devices.some((d) => d.id === device.id)) {
      throw new Error(
        `Device "${device.name}" is not in the active preview. Use the set_active_devices tool to activate it first.`
      );
    }
    devices = [device];
  }

  const result: McpCaptureTargetsResult = {targets: [], skipped: []};
  devices.forEach((device) => {
    const iosRuntime = state.deviceManager.deviceBrowsers[device.id];
    if (iosRuntime) {
      result.targets.push({
        deviceName: device.name,
        width: device.width,
        height: device.height,
        webContentsId: -1,
        url: state.renderer.address,
        iosRuntime,
      });
      return;
    }
    const webview = getDeviceWebview(device.name);
    if (webview === null) {
      result.skipped.push({
        deviceName: device.name,
        reason: 'preview is not mounted (the Focused layout shows a single device)',
      });
      return;
    }
    try {
      result.targets.push({
        deviceName: device.name,
        width: device.width,
        height: device.height,
        webContentsId: webview.getWebContentsId(),
        url: webview.getURL(),
      });
    } catch {
      result.skipped.push({deviceName: device.name, reason: 'preview is still loading'});
    }
  });
  return result;
};

const setBrowser = async (store: AppStore, payload: McpSetDeviceBrowserPayload) => {
  const device = resolveDeviceQuery(getDevicesMap(), payload?.device ?? '');
  if (device === undefined || !getActiveDevices(store.getState()).some((d) => d.id === device.id)) {
    throw new Error(
      `"${payload?.device}" is not an active device. Use list_devices and set_active_devices first.`
    );
  }
  if (payload.browser === 'chromium') {
    store.dispatch(setDeviceBrowser({id: device.id}));
    return {device: device.name, browser: 'Chromium'};
  }
  const sim = await window.electron.ipcRenderer.invoke<IosSimRequest, IosSimState>(
    IPC_MAIN_CHANNELS.IOS_SIMULATOR,
    {operation: 'list'}
  );
  if (!sim.available) throw new Error(`iOS Safari is not available: ${sim.reason}`);
  const fits = sim.runtimes.filter((r) => r.deviceNames.includes(device.name));
  const runtime = payload.iosVersion
    ? fits.find((r) => r.name === `iOS ${payload.iosVersion}`)
    : fits[fits.length - 1];
  if (!runtime) {
    throw new Error(
      `No installed iOS ${payload.iosVersion ?? 'version'} runs a "${device.name}" Simulator. ` +
        `Installed: ${sim.runtimes.map((r) => r.name).join(', ') || 'none'}.`
    );
  }
  store.dispatch(setDeviceBrowser({id: device.id, runtime: runtime.id}));
  return {
    device: device.name,
    browser: `iOS Safari ${runtime.name.replace(/^iOS /, '')}`,
    note: 'Real Safari in the iOS Simulator; the first start takes about 25 s. Then use navigate and screenshot.',
  };
};

export const executeMcpCommand = async (
  store: AppStore,
  command: McpBridgeCommand,
  payload: unknown
): Promise<unknown> => {
  switch (command) {
    case 'get-app-state':
      return getAppState(store.getState());
    case 'list-devices':
      return listDevices(store.getState());
    case 'set-active-devices':
      return setActiveDevices(store, payload as McpSetActiveDevicesPayload);
    case 'navigate':
      return navigate(store, payload as McpNavigatePayload);
    case 'get-capture-targets':
      return getCaptureTargets(store.getState(), (payload ?? {}) as McpCaptureTargetsPayload);
    case 'set-device-browser':
      return setBrowser(store, payload as McpSetDeviceBrowserPayload);
    default:
      throw new Error(`Unknown MCP command: ${command}`);
  }
};
