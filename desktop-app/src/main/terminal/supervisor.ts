import path from 'path';
import {app, utilityProcess, type UtilityProcess} from 'electron';
import log from '../logging';
import {hostCall, type HostEndpoint} from './client';

/**
 * Starts the terminal host when a terminal is first wanted, in the process that
 * outlives Session windows (the controller; or the window itself outside Sessions),
 * and tells that process whether any terminal still runs so it does not quit under one.
 */
let child: UtilityProcess | null = null;
let starting: Promise<HostEndpoint> | null = null;
let running = 0;

const start = () =>
  new Promise<HostEndpoint>((resolve, reject) => {
    const proc = utilityProcess.fork(path.join(__dirname, 'terminal-host.js'), [], {
      serviceName: 'Responsively terminals',
      stdio: 'ignore',
    });
    child = proc;
    // Ask it to end its shells and tunnels first, then make sure it is gone.
    app.once('will-quit', () => {
      proc.postMessage({type: 'shutdown'});
      setTimeout(() => proc.kill(), 800);
    });
    const timer = setTimeout(
      () => reject(new Error('The terminal service did not start.')),
      15_000
    );
    proc.on(
      'message',
      (m: {type: string; port?: number; token?: string; running?: number; message?: string}) => {
        if (m.type === 'ready' && m.port && m.token) {
          clearTimeout(timer);
          resolve({port: m.port, token: m.token});
        } else if (m.type === 'count') running = m.running ?? 0;
        else if (m.type === 'failed') {
          clearTimeout(timer);
          reject(new Error(m.message ?? 'The terminal service failed.'));
        }
      }
    );
    proc.once('exit', (code) => {
      log.warn('[terminal] host exited', code);
      clearTimeout(timer);
      if (child === proc) child = null;
      starting = null;
      running = 0;
      reject(new Error('The terminal service stopped.'));
    });
  });

export const terminalEndpoint = (): Promise<HostEndpoint> => {
  starting ??= start().catch((e) => {
    starting = null;
    throw e;
  });
  return starting;
};

export const terminalsRunning = () => running > 0;

/** Ends one Session's terminals (it was stopped, not just its window closed). */
export const killSessionTerminals = async (session: string) => {
  if (!child || !starting) return;
  try {
    await hostCall(await starting, {op: 'kill-session', session});
  } catch (e) {
    log.warn('[terminal] could not end terminals of', session, e);
  }
};
