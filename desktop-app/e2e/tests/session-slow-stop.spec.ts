import fs from 'fs';
import os from 'os';
import path from 'path';
import {_electron, ElectronApplication, Page} from '@playwright/test';
import {test, expect} from '../fixtures/electron-app';
import {
  closeApp,
  endSessionProcesses,
  expectStopped,
  stopDiagnosis,
} from '../fixtures/session-processes';
import {SessionInfo, SessionRequest} from '../../src/common/sessions';
import {call, Endpoint} from '../../src/common/session-rpc';

/**
 * A Session that exits slowly after Stop (as on a loaded CI runner, where
 * Chromium's shutdown waits on its other processes) is stopping, not broken;
 * one that never exits fails with a clear reason and can be force quit; and a
 * stuck Session never holds the test worker.
 */
const sessionsApi = (window: Page) => (value: SessionRequest) =>
  window.evaluate(
    (v) => (window as any).electron.ipcRenderer.invoke('sessions-request', v),
    value
  ) as Promise<SessionInfo>;

const rootOf = (electronApp: ElectronApplication) =>
  electronApp.evaluate(() => process.env.RESPONSIVELY_SESSIONS_ROOT!);

/** Opens a Session and makes its runtime hold its exit `ms` after its endpoint closes (-1: never). */
const openSlowSession = async (
  request: ReturnType<typeof sessionsApi>,
  root: string,
  name: string,
  ms: number
) => {
  const {id} = await request({operation: 'create', name, open: true});
  await expect
    .poll(async () => (await request({operation: 'get', id})).status, {timeout: 70_000})
    .toBe('running');
  const lease = JSON.parse(
    fs.readFileSync(path.join(root, 'runtimes', `${id}.json`), 'utf8')
  ) as Endpoint & {pid: number};
  expect(await call(lease, {operation: 'e2e-slow-quit', ms})).toEqual({slowQuitMs: ms});
  return {id, pid: lease.pid};
};

test.describe('A Session that stops slowly', () => {
  test('is "stopping" until it exits, then "stopped", even past the old 15 s limit', async ({
    mainWindow,
    electronApp,
  }) => {
    test.setTimeout(180_000);
    const request = sessionsApi(mainWindow);
    const root = await rootOf(electronApp);
    const {id} = await openSlowSession(request, root, 'Slow exit', 18_000);

    const started = Date.now();
    const statuses = new Set<string>();
    const stop = request({operation: 'stop', id});
    await expectStopped(
      async () => {
        const {status} = await request({operation: 'get', id});
        statuses.add(status);
        return status;
      },
      root,
      id
    );
    expect((await stop).status).toBe('stopped');
    expect(Date.now() - started).toBeGreaterThan(15_000);
    expect(statuses.has('stopping')).toBe(true);
    expect(statuses.has('error')).toBe(false);
  });

  test('that never exits fails with the reason and can be force quit', async ({
    mainWindow,
    electronApp,
  }) => {
    test.setTimeout(220_000);
    const request = sessionsApi(mainWindow);
    const root = await rootOf(electronApp);
    const {id} = await openSlowSession(request, root, 'Never exits', -1);

    await expect(request({operation: 'stop', id})).rejects.toThrow(/did not stop/);
    expect(await stopDiagnosis(root, id)).toMatch(/alive, endpoint closed \(quitting/);
    const hung = await request({operation: 'get', id});
    expect(hung.status).toBe('error');
    expect(hung.hung).toBe(true);

    const forced = await request({operation: 'force-stop', id, confirmed: true});
    expect(forced.status).toBe('stopped');
  });

  test('never holds the worker: closing the app with a stuck Session is bounded and leaves nothing running', async () => {
    test.setTimeout(240_000);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'responsively-e2e-'));
    const root = path.join(userDataDir, 'session-test-root');
    fs.writeFileSync(
      path.join(userDataDir, 'config.json'),
      JSON.stringify({
        homepage: `file://${path.join(__dirname, '../fixtures/pages/test-page.html')}`,
      })
    );
    const own = await _electron.launch({
      args: [
        path.join(__dirname, '../../release/app'),
        ...(process.env.CI ? ['--disable-gpu'] : []),
      ],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        E2E_TEST: 'true',
        E2E_HEADLESS: 'true',
        E2E_USER_DATA_DIR: userDataDir,
        RESPONSIVELY_SESSIONS_ROOT: root,
        RESPONSIVELY_MCP_PORT: String(23_900 + test.info().workerIndex),
      } as Record<string, string>,
    });
    try {
      const window = await own.firstWindow();
      await window.waitForSelector('[data-testid="address-bar"]', {timeout: 60_000});
      const {pid} = await openSlowSession(sessionsApi(window), root, 'Stuck', -1);

      const mainPid = own.process().pid!;
      const started = Date.now();
      await closeApp(own, root);
      const took = Date.now() - started;
      // Quit waits ~35 s for the app, then each leftover gets SIGTERM, then SIGKILL after 5 s.
      expect(took).toBeLessThan(60_000);
      expect(() => process.kill(mainPid, 0)).toThrow();
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      // Whatever an early failure left running.
      await endSessionProcesses(root);
      fs.rmSync(userDataDir, {recursive: true, force: true});
    }
  });
});
