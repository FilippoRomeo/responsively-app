// @vitest-environment node
import path from 'path';
import {describe, expect, it, vi} from 'vitest';
import {McpBeacon} from '../common/mcp';
import {launchApp, launchController, LaunchDeps} from './launch';

const MAC_BRIDGE_DIR = '/Applications/ResponsivelyApp.app/Contents/Resources/mcp';
const MAC_BINARY = '/Applications/ResponsivelyApp.app/Contents/MacOS/ResponsivelyApp';

const beacon = (binaryPath: string): McpBeacon => ({
  binaryPath,
  version: '1.18.0',
  mcpPort: 12720,
  writtenAt: new Date().toISOString(),
});

const makeDeps = (
  overrides: Partial<LaunchDeps>
): {deps: LaunchDeps; spawned: any[]; opened: string[][]} => {
  const spawned: any[] = [];
  const opened: string[][] = [];
  const deps: LaunchDeps = {
    spawnFn: vi.fn((command, _args, options) => {
      spawned.push({command, options});
      return {unref: vi.fn()} as never;
    }) as never,
    execFileFn: vi.fn((_cmd: string, args: string[], cb: (e: Error | null) => void) => {
      opened.push(args);
      cb(null);
    }) as never,
    existsFn: () => false,
    platform: 'darwin',
    beacon: () => null,
    bridgeDir: MAC_BRIDGE_DIR,
    ...overrides,
  };
  return {deps, spawned, opened};
};

describe('mcp-cli launch', () => {
  it('darwin default port launches via LaunchServices bundle id', async () => {
    const {deps, spawned, opened} = makeDeps({});
    await launchApp(12720, deps);
    expect(opened).toEqual([['-b', 'app.responsively']]);
    expect(spawned).toHaveLength(0);
  });

  it('darwin custom port spawns the binary directly so env propagates', async () => {
    const {deps, spawned, opened} = makeDeps({existsFn: (p) => p.startsWith('/Applications')});
    await launchApp(23456, deps);
    expect(opened).toHaveLength(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].command).toBe(MAC_BINARY);
    expect(spawned[0].options.detached).toBe(true);
    expect(spawned[0].options.env.RESPONSIVELY_MCP_PORT).toBe('23456');
  });

  it('darwin custom port preserves the full parallel-session isolation tuple', async () => {
    const previous = {
      browserSync: process.env.RESPONSIVELY_BROWSER_SYNC_PORT,
      userData: process.env.RESPONSIVELY_USER_DATA_DIR,
      protocol: process.env.RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION,
    };
    process.env.RESPONSIVELY_BROWSER_SYNC_PORT = '12732';
    process.env.RESPONSIVELY_USER_DATA_DIR = '/tmp/responsively-project-b';
    process.env.RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION = 'true';
    try {
      const {deps, spawned} = makeDeps({existsFn: (p) => p.startsWith('/Applications')});
      await launchApp(12731, deps);
      expect(spawned).toHaveLength(1);
      const childEnv = spawned[0].options.env as NodeJS.ProcessEnv;
      expect(childEnv.RESPONSIVELY_MCP_PORT).toBe('12731');
      expect(childEnv.RESPONSIVELY_BROWSER_SYNC_PORT).toBe('12732');
      expect(childEnv.RESPONSIVELY_USER_DATA_DIR).toBe('/tmp/responsively-project-b');
      expect(childEnv.RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION).toBe('true');
    } finally {
      const restore = (key: string, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore('RESPONSIVELY_BROWSER_SYNC_PORT', previous.browserSync);
      restore('RESPONSIVELY_USER_DATA_DIR', previous.userData);
      restore('RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION', previous.protocol);
    }
  });

  it('windows launches the beacon binary detached', async () => {
    const binary = 'C:\\Somewhere\\ResponsivelyApp.exe';
    const {deps, spawned} = makeDeps({
      platform: 'win32',
      bridgeDir: 'C:\\Somewhere\\resources\\mcp',
      beacon: () => beacon(binary),
      existsFn: (p) => p === binary,
    });
    await launchApp(12720, deps);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].command).toBe(binary);
    expect(spawned[0].options.detached).toBe(true);
  });

  it('linux launches the beacon AppImage path', async () => {
    const appImage = '/home/dev/Apps/Responsively.AppImage';
    const {deps, spawned} = makeDeps({
      platform: 'linux',
      bridgeDir: '/home/dev/.config/ResponsivelyApp/mcp',
      beacon: () => beacon(appImage),
      existsFn: (p) => p === appImage,
    });
    await launchApp(12720, deps);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].command).toBe(appImage);
  });

  it('errors with actionable guidance when no binary can be found', async () => {
    const {deps} = makeDeps({platform: 'linux', bridgeDir: '/tmp/nowhere/mcp'});
    await expect(launchApp(12720, deps)).rejects.toThrow(/Launch the app manually once/);
  });

  it('darwin falls back to opening the derived .app when bundle id fails', async () => {
    const appDir = '/Users/dev/Applications/ResponsivelyApp.app';
    const {deps, opened} = makeDeps({
      bridgeDir: path.join(appDir, 'Contents', 'Resources', 'mcp'),
      existsFn: (p) => p === appDir,
      execFileFn: vi.fn((_cmd: string, args: string[], cb: (e: Error | null) => void) => {
        opened.push(args);
        // Simulate `open -b` failing (app not registered), direct open succeeding.
        cb(args[0] === '-b' ? new Error('not found') : null);
      }) as never,
    });
    const {opened: openedCalls} = {opened};
    await launchApp(12720, deps);
    expect(openedCalls).toEqual([['-b', 'app.responsively'], [appDir]]);
  });
});

describe('session controller launch', () => {
  it('uses a detached packaged binary and independent controller userData without browser port overrides', async () => {
    const previous = process.env.RESPONSIVELY_USER_DATA_DIR;
    process.env.RESPONSIVELY_USER_DATA_DIR = '/tmp/shell-profile';
    const {deps, spawned} = makeDeps({existsFn: (p) => p.startsWith('/Applications')});
    try {
      await launchController('/tmp/session-root', deps);
    } finally {
      if (previous === undefined) delete process.env.RESPONSIVELY_USER_DATA_DIR;
      else process.env.RESPONSIVELY_USER_DATA_DIR = previous;
    }
    expect(spawned).toHaveLength(1);
    expect(spawned[0].options).toMatchObject({
      detached: true,
      stdio: 'ignore',
      env: {
        RESPONSIVELY_SESSION_CONTROLLER: 'true',
        RESPONSIVELY_SESSIONS_ROOT: '/tmp/session-root',
        RESPONSIVELY_SHELL_USER_DATA_DIR: '/tmp/shell-profile',
        RESPONSIVELY_USER_DATA_DIR: '/tmp/session-root/controller',
        RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION: 'true',
      },
    });
    expect(spawned[0].options.env.RESPONSIVELY_MCP_PORT).toBeUndefined();
    expect(spawned[0].options.env.RESPONSIVELY_SESSION_ID).toBeUndefined();
  });
});
