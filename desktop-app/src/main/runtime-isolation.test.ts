import {describe, expect, it} from 'vitest';
import {
  BROWSER_SYNC_PORT_ENV_VAR,
  DEFAULT_BROWSER_SYNC_PORT,
  DISABLE_PROTOCOL_REGISTRATION_ENV_VAR,
  USER_DATA_DIR_ENV_VAR,
  LOCAL_MCP_BUNDLE_ID,
  isLocalMcpBundle,
  resolveBrowserSyncPort,
  resolveUserDataDir,
  shouldCheckForUpdates,
  shouldRegisterProtocol,
} from './runtime-isolation';

const localBundle = {__CFBundleIdentifier: LOCAL_MCP_BUNDLE_ID};
const stableBundle = {__CFBundleIdentifier: 'app.responsively'};

describe('runtime isolation', () => {
  describe('isLocalMcpBundle', () => {
    it('matches only the local MCP bundle identity', () => {
      expect(isLocalMcpBundle(localBundle)).toBe(true);
      expect(isLocalMcpBundle(stableBundle)).toBe(false);
      expect(isLocalMcpBundle({__CFBundleIdentifier: 'com.microsoft.VSCode'})).toBe(false);
      expect(isLocalMcpBundle({})).toBe(false);
    });
  });

  describe('local MCP bundle defaults', () => {
    it('keeps stable defaults for the stable bundle', () => {
      expect(resolveBrowserSyncPort(stableBundle)).toBe(12719);
      expect(resolveUserDataDir(stableBundle, '/Users/dev')).toBeUndefined();
      expect(shouldRegisterProtocol(stableBundle)).toBe(true);
    });

    it('bakes in isolated defaults for the local bundle', () => {
      expect(resolveBrowserSyncPort(localBundle)).toBe(12722);
      expect(resolveUserDataDir(localBundle, '/Users/dev')).toBe(
        '/Users/dev/Library/Application Support/ResponsivelyMCP'
      );
      expect(shouldRegisterProtocol(localBundle)).toBe(false);
    });

    it('lets explicit env vars override the local bundle defaults', () => {
      const env = {
        ...localBundle,
        [BROWSER_SYNC_PORT_ENV_VAR]: '23000',
        [USER_DATA_DIR_ENV_VAR]: '/tmp/custom',
        [DISABLE_PROTOCOL_REGISTRATION_ENV_VAR]: 'false',
      };
      expect(resolveBrowserSyncPort(env)).toBe(23000);
      expect(resolveUserDataDir(env, '/Users/dev')).toBe('/tmp/custom');
      expect(shouldRegisterProtocol(env)).toBe(true);
    });

    it('keeps E2E behaviour ahead of the local bundle defaults', () => {
      expect(resolveBrowserSyncPort({...localBundle, E2E_TEST: 'true'}, () => 0.5)).toBe(
        DEFAULT_BROWSER_SYNC_PORT + 5000
      );
      expect(
        resolveUserDataDir({...localBundle, E2E_USER_DATA_DIR: '/tmp/e2e'}, '/Users/dev')
      ).toBe('/tmp/e2e');
    });
  });

  describe('shouldCheckForUpdates', () => {
    it('checks for updates in a packaged stable build', () => {
      expect(shouldCheckForUpdates(true, stableBundle)).toBe(true);
      expect(shouldCheckForUpdates(true, {})).toBe(true);
    });

    it('skips unpackaged, CI and E2E runs as before', () => {
      expect(shouldCheckForUpdates(false, {})).toBe(false);
      expect(shouldCheckForUpdates(true, {CI: 'true'})).toBe(false);
      expect(shouldCheckForUpdates(true, {E2E_TEST: 'true'})).toBe(false);
    });

    it('skips managed runtimes and controller without depending on LaunchServices or CI', () => {
      expect(shouldCheckForUpdates(true, {RESPONSIVELY_SESSION_ID: 'a-session'})).toBe(false);
      expect(shouldCheckForUpdates(true, {RESPONSIVELY_SESSION_CONTROLLER: 'true'})).toBe(false);
    });

    it('skips the local MCP bundle without CI=true', () => {
      expect(shouldCheckForUpdates(true, localBundle)).toBe(false);
    });
  });

  describe('resolveBrowserSyncPort', () => {
    it('preserves the upstream default when no override is present', () => {
      expect(resolveBrowserSyncPort({})).toBe(DEFAULT_BROWSER_SYNC_PORT);
    });

    it('preserves the upstream E2E random-port behaviour', () => {
      expect(resolveBrowserSyncPort({E2E_TEST: 'true'}, () => 0.5)).toBe(
        DEFAULT_BROWSER_SYNC_PORT + 5000
      );
    });

    it('uses the explicit port override', () => {
      expect(
        resolveBrowserSyncPort({
          [BROWSER_SYNC_PORT_ENV_VAR]: '12722',
        })
      ).toBe(12722);
    });

    it('gives the explicit port override precedence over E2E behaviour', () => {
      expect(
        resolveBrowserSyncPort(
          {
            E2E_TEST: 'true',
            [BROWSER_SYNC_PORT_ENV_VAR]: '12722',
          },
          () => 0.9
        )
      ).toBe(12722);
    });

    it.each(['', 'abc', '0', '65536', '1.5'])(
      'rejects invalid explicit port %j instead of silently using 12719',
      (value) => {
        expect(() =>
          resolveBrowserSyncPort({
            [BROWSER_SYNC_PORT_ENV_VAR]: value,
          })
        ).toThrow(BROWSER_SYNC_PORT_ENV_VAR);
      }
    );
  });

  describe('resolveUserDataDir', () => {
    it('returns undefined when no override exists', () => {
      expect(resolveUserDataDir({})).toBeUndefined();
    });

    it('uses the permanent user-data override', () => {
      expect(
        resolveUserDataDir({
          [USER_DATA_DIR_ENV_VAR]: '/tmp/responsively-mcp',
        })
      ).toBe('/tmp/responsively-mcp');
    });

    it('preserves E2E_USER_DATA_DIR as a fallback', () => {
      expect(
        resolveUserDataDir({
          E2E_USER_DATA_DIR: '/tmp/e2e',
        })
      ).toBe('/tmp/e2e');
    });

    it('gives the permanent override precedence over E2E', () => {
      expect(
        resolveUserDataDir({
          [USER_DATA_DIR_ENV_VAR]: '/tmp/permanent',
          E2E_USER_DATA_DIR: '/tmp/e2e',
        })
      ).toBe('/tmp/permanent');
    });

    it('rejects an empty permanent override', () => {
      expect(() =>
        resolveUserDataDir({
          [USER_DATA_DIR_ENV_VAR]: '',
        })
      ).toThrow(USER_DATA_DIR_ENV_VAR);
    });
  });

  describe('shouldRegisterProtocol', () => {
    it('preserves normal protocol registration by default', () => {
      expect(shouldRegisterProtocol({})).toBe(true);
    });

    it('disables protocol registration only when explicitly true', () => {
      expect(
        shouldRegisterProtocol({
          [DISABLE_PROTOCOL_REGISTRATION_ENV_VAR]: 'true',
        })
      ).toBe(false);
    });

    it('does not disable registration for other values', () => {
      expect(
        shouldRegisterProtocol({
          [DISABLE_PROTOCOL_REGISTRATION_ENV_VAR]: 'false',
        })
      ).toBe(true);
    });
  });
});
