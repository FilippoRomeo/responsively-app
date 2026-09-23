import fs from 'fs';
import os from 'os';
import path from 'path';
import {Endpoint, call} from './session-rpc';
import {SessionInfo, SessionRequest} from './sessions';

export const controllerRoot = (appData?: string) =>
  process.env.RESPONSIVELY_SESSIONS_ROOT ||
  path.join(
    appData ??
      (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : process.platform === 'win32'
          ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
          : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')),
    'ResponsivelySessions'
  );

/** Shared discovery only. The dedicated Electron controller is the sole authority. */
export const controllerClient = (root: string, launch: () => Promise<void>) => {
  let starting: Promise<Endpoint> | undefined;
  const probe = async () => {
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(root, 'controller.json'), 'utf8')
    ) as Endpoint;
    await call(endpoint, {operation: 'list'}, 5000);
    return endpoint;
  };
  const discover = async () => {
    try {
      return await probe();
    } catch {
      /* cold/stale beacon */
    }
    if (!starting)
      starting = (async () => {
        await launch();
        for (let i = 0; i < 100; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          try {
            return await probe();
          } catch {
            /* wait for instance-lock winner */
          }
        }
        throw new Error('Sessions controller did not become ready');
      })().finally(() => {
        starting = undefined;
      });
    return starting;
  };
  return async (request: SessionRequest) =>
    call<SessionInfo | SessionInfo[]>(await discover(), request, 90_000);
};

/**
 * Quit asks the controller to stop every Session. Success is judged by the runtime
 * leases left on disk (the same signal the controller uses to relaunch the shell),
 * so a timed-out or failed stop is reported, never assumed.
 */
export const stopAllSessions = async (
  request: (value: SessionRequest) => Promise<SessionInfo | SessionInfo[]>,
  runningIds: () => string[],
  timeoutMs: number
) => {
  const names = new Map<string, string>();
  const active: string[] = [];
  const attempt = (async () => {
    const all = (await request({operation: 'list'})) as SessionInfo[];
    for (const s of all) {
      names.set(s.id, s.name);
      if (s.status === 'running' || s.status === 'starting') active.push(s.id);
    }
    await Promise.all(
      all
        .filter((s) => s.status !== 'stopped')
        .map((s) => request({operation: 'stop', id: s.id}).catch(() => {}))
    );
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    attempt.catch(() => {}),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return {active, blocked: runningIds().map((id) => ({id, name: names.get(id) ?? id}))};
};

/** Reopen Sessions left active at the last clean Quit; deleted or running ones are skipped. */
export const reopenSessions = async (
  request: (value: SessionRequest) => Promise<SessionInfo | SessionInfo[]>,
  ids: string[]
) => {
  const opened: string[] = [];
  for (const id of ids) {
    try {
      if (((await request({operation: 'get', id})) as SessionInfo).status !== 'stopped') continue;
      await request({operation: 'open', id});
      opened.push(id);
    } catch {
      /* Deleted since Quit, or failed to start: the manager shows its state. */
    }
  }
  return opened;
};

export const sessionToolOperations = {
  list_sessions: 'list',
  create_session: 'create',
  get_session: 'get',
  open_session: 'open',
  focus_session: 'focus',
  stop_session: 'stop',
} as const;
