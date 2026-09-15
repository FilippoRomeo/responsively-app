import {describe, expect, it} from 'vitest';
import {
  BROWSER_SYNC_PORT_ENV_VAR,
  DEFAULT_BROWSER_SYNC_PORT,
  DISABLE_PROTOCOL_REGISTRATION_ENV_VAR,
  USER_DATA_DIR_ENV_VAR,
  resolveBrowserSyncPort,
  resolveUserDataDir,
  shouldRegisterProtocol,
} from './runtime-isolation';

describe('runtime isolation', () => {
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
