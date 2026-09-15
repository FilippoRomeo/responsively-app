export const DEFAULT_BROWSER_SYNC_PORT = 12719;

export const BROWSER_SYNC_PORT_ENV_VAR = 'RESPONSIVELY_BROWSER_SYNC_PORT';

export const DISABLE_PROTOCOL_REGISTRATION_ENV_VAR = 'RESPONSIVELY_DISABLE_PROTOCOL_REGISTRATION';

export const USER_DATA_DIR_ENV_VAR = 'RESPONSIVELY_USER_DATA_DIR';

export const resolveUserDataDir = (env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const explicitDir = env[USER_DATA_DIR_ENV_VAR];

  if (explicitDir !== undefined) {
    if (explicitDir.length === 0) {
      throw new Error(`${USER_DATA_DIR_ENV_VAR} must not be empty`);
    }
    return explicitDir;
  }

  return env.E2E_USER_DATA_DIR;
};

const parsePort = (raw: string): number => {
  const value = raw.trim();
  const port = Number(value);

  if (value.length === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid ${BROWSER_SYNC_PORT_ENV_VAR}: expected an integer from 1 to 65535, received ${JSON.stringify(
        raw
      )}`
    );
  }

  return port;
};

export const resolveBrowserSyncPort = (
  env: NodeJS.ProcessEnv = process.env,
  random: () => number = Math.random
): number => {
  const explicitPort = env[BROWSER_SYNC_PORT_ENV_VAR];

  if (explicitPort !== undefined) {
    return parsePort(explicitPort);
  }

  if (env.E2E_TEST === 'true') {
    return DEFAULT_BROWSER_SYNC_PORT + Math.floor(random() * 10000);
  }

  return DEFAULT_BROWSER_SYNC_PORT;
};

export const shouldRegisterProtocol = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env[DISABLE_PROTOCOL_REGISTRATION_ENV_VAR] !== 'true';
