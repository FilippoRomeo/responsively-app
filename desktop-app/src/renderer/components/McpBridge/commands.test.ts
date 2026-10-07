import {configureStore} from '@reduxjs/toolkit';
import {runtimeLabel} from 'common/ios-simulator';
import {McpCaptureTargetsResult} from 'common/mcp';
import {deviceManagerSlice, DEFAULT_SUITE} from 'renderer/store/features/device-manager';
import {rendererSlice} from 'renderer/store/features/renderer';
import {executeMcpCommand} from './commands';

// DEFAULT_SUITE = iPhone 12 Pro, iPad, MacBook Pro.
const makeStore = () =>
  configureStore({
    reducer: {deviceManager: deviceManagerSlice.reducer, renderer: rendererSlice.reducer},
  }) as any;

const runtime = (version: string, deviceNames: string[]) => ({
  id: `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace('.', '-')}`,
  name: `iOS ${version}`,
  sizeBytes: 8e9,
  deletable: true,
  deviceNames,
});

describe('set-device-browser', () => {
  beforeEach(() => {
    vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
      available: true,
      runtimes: [runtime('18.6', ['iPhone 12 Pro']), runtime('26.1', ['iPhone 12 Pro'])],
      devices: [],
    });
  });
  afterEach(() => vi.mocked(window.electron.ipcRenderer.invoke).mockReset());

  it('puts a device on the newest iOS that runs it, and screenshots come from its Simulator', async () => {
    const store = makeStore();
    expect(DEFAULT_SUITE.devices[0]).toBe('10008');
    const result = await executeMcpCommand(store, 'set-device-browser', {
      device: 'iPhone 12 Pro',
      browser: 'ios-safari',
    });
    expect(result).toMatchObject({device: 'iPhone 12 Pro', browser: 'iOS Safari 26.1'});
    expect(store.getState().deviceManager.deviceBrowsers['10008']).toBe(
      'com.apple.CoreSimulator.SimRuntime.iOS-26-1'
    );
    const {targets} = (await executeMcpCommand(store, 'get-capture-targets', {
      device: 'iPhone 12 Pro',
    })) as McpCaptureTargetsResult;
    expect(targets[0]).toMatchObject({deviceName: 'iPhone 12 Pro', iosRuntime: expect.any(String)});

    await executeMcpCommand(store, 'set-device-browser', {device: '10008', browser: 'chromium'});
    expect(store.getState().deviceManager.deviceBrowsers['10008']).toBeUndefined();
  });

  it('picks a requested version, and explains when nothing can run the device', async () => {
    const store = makeStore();
    await executeMcpCommand(store, 'set-device-browser', {
      device: 'iPhone 12 Pro',
      browser: 'ios-safari',
      iosVersion: '18.6',
    });
    expect(runtimeLabel(store.getState().deviceManager.deviceBrowsers['10008'])).toBe('iOS 18.6');
    await expect(
      executeMcpCommand(store, 'set-device-browser', {device: 'iPad', browser: 'ios-safari'})
    ).rejects.toThrow(
      'No installed iOS version runs a "iPad" Simulator. Installed: iOS 18.6, iOS 26.1.'
    );
  });
});
