import {execFileSync} from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import electronPath from 'electron';
import type {ElectronApplication} from '@playwright/test';
import {expect} from '@playwright/test';

/**
 * The controller gives a quitting runtime STOP_EXIT_MS (60 s) to exit, so a
 * test waits that long plus a margin before calling a stop failed.
 */
export const SESSION_STOP_TIMEOUT = 75_000;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

/** This test's Electron binary, not some other process that reused the PID. */
const isOurElectron = (pid: number) => {
  try {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    return command.startsWith(electronPath as unknown as string);
  } catch {
    return false;
  }
};

const readJson = <T>(file: string): T | undefined => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

/** The controller and runtimes this test's Sessions root recorded. */
const sessionPids = (root: string) => {
  const pids: number[] = [];
  const controller = readJson<{pid?: number}>(path.join(root, 'controller.json'));
  if (controller?.pid) pids.push(controller.pid);
  const dir = path.join(root, 'runtimes');
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const lease = readJson<{pid?: number}>(path.join(dir, f));
      if (lease?.pid) pids.push(lease.pid);
    }
  return pids;
};

const waitUntil = async (done: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (done()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return done();
};

/** Ends what is left of this test's Sessions: SIGTERM, then SIGKILL after 5 s. */
export const endSessionProcesses = async (root: string) => {
  const pids = sessionPids(root).filter((pid) => alive(pid) && isOurElectron(pid));
  pids.forEach((pid) => process.kill(pid, 'SIGTERM'));
  if (await waitUntil(() => !pids.some(alive), 5000)) return pids;
  pids.filter(alive).forEach((pid) => process.kill(pid, 'SIGKILL'));
  await waitUntil(() => !pids.some(alive), 5000);
  return pids;
};

/**
 * Quit the app and wait for it, bounded: the window's Quit waits for its
 * Sessions (and cancels if one does not stop), and Playwright's own close has
 * no timeout, so a slow or stuck Session must not hold the worker.
 */
export const closeApp = async (electronApp: ElectronApplication, root: string, waitMs = 35_000) => {
  const child = electronApp.process();
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  await Promise.race([
    electronApp.evaluate(({app}) => app.quit()),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).catch(() => {});
  if (!(await waitUntil(exited, waitMs)) && child.pid) child.kill('SIGKILL');
  await waitUntil(exited, 5000);
  await Promise.race([
    electronApp.close(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).catch(() => {});
  await endSessionProcesses(root);
};

const portState = (port: number) =>
  new Promise<string>((resolve) => {
    const socket = net.connect({host: '127.0.0.1', port});
    const done = (state: string) => {
      socket.destroy();
      resolve(state);
    };
    socket.setTimeout(1000, () => done('not answering'));
    socket.once('connect', () => done('open'));
    socket.once('error', (e: NodeJS.ErrnoException) =>
      done(e.code === 'ECONNREFUSED' ? 'closed' : String(e.code))
    );
  });

/** Why a Session is not stopped: still running, quitting slowly, or gone. */
export const stopDiagnosis = async (root: string, id: string) => {
  const lease = readJson<{pid: number; port: number}>(path.join(root, 'runtimes', `${id}.json`));
  if (!lease) return 'no runtime lease (the controller removed it)';
  const port = lease.port > 0 ? await portState(lease.port) : 'not published';
  return `runtime ${lease.pid} ${alive(lease.pid) ? 'alive' : 'exited'}, endpoint ${port}${
    port === 'closed' && alive(lease.pid) ? ' (quitting: slow exit)' : ''
  }`;
};

/** Waits for `stopped` as long as the controller does; a failure says why. */
export const expectStopped = async (
  status: () => Promise<string>,
  root: string,
  id: string,
  timeout = SESSION_STOP_TIMEOUT
) => {
  try {
    await expect.poll(status, {timeout}).toBe('stopped');
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${await stopDiagnosis(root, id)}`);
  }
};
