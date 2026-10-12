import fs from 'fs';
import path from 'path';
import type {ElectronApplication, Page} from '@playwright/test';
import {test, expect} from '../fixtures/electron-app';
import {endSessionProcesses, expectStopped} from '../fixtures/session-processes';
import {call, Endpoint} from '../../src/common/session-rpc';
import type {SessionInfo, SessionRequest} from '../../src/common/sessions';
import type {HostMessage} from '../../src/common/terminal';
import {HostConnection, HostEndpoint} from '../../src/main/terminal/client';

/**
 * Terminals belong to the controller's host, not to a Session window: closing
 * the window leaves them running, reopening finds them, and stopping or
 * quitting ends them.
 */
const sessionsApi = (window: Page) => (value: SessionRequest) =>
  window.evaluate(
    (v) => (window as any).electron.ipcRenderer.invoke('sessions-request', v),
    value
  ) as Promise<SessionInfo>;

const rootOf = (electronApp: ElectronApplication) =>
  electronApp.evaluate(() => process.env.RESPONSIVELY_SESSIONS_ROOT!);

test('terminals survive closing a Session window and end when it is stopped', async ({
  mainWindow,
  electronApp,
}) => {
  test.setTimeout(240_000);
  const request = sessionsApi(mainWindow);
  const root = await rootOf(electronApp);
  const {id} = await request({operation: 'create', name: 'Terminals', open: true});
  const host = new HostConnection(
    () => {},
    () => {}
  );
  try {
    await expect
      .poll(async () => (await request({operation: 'get', id})).status, {timeout: 70_000})
      .toBe('running');
    const controller = JSON.parse(
      fs.readFileSync(path.join(root, 'controller.json'), 'utf8')
    ) as Endpoint & {pid: number};
    const hostEndpoint = (await call(controller, {operation: 'terminal-host'})) as HostEndpoint;
    await host.open(hostEndpoint);
    const created = (await host.request({
      op: 'create',
      session: id,
      cols: 80,
      rows: 24,
    })) as Extract<HostMessage, {type: 'created'}>;
    const listed = async () =>
      ((await host.request({op: 'list', session: id})) as Extract<HostMessage, {type: 'list'}>)
        .terminals;
    expect((await listed()).map((t) => t.id)).toEqual([created.terminal.id]);

    // The window is closed (⌘W): the Session stops, its terminal does not.
    await call(controller, {operation: 'stop', id, source: 'window'});
    await expectStopped(async () => (await request({operation: 'get', id})).status, root, id);
    expect((await listed()).map((t) => t.id)).toEqual([created.terminal.id]);
    expect((await listed())[0].state).toBe('running');

    // The controller does not quit under a running terminal (it idles out after 15 s without one).
    await new Promise((resolve) => {
      setTimeout(resolve, 20_000);
    });
    expect(() => process.kill(controller.pid, 0)).not.toThrow();
    expect((await listed()).length).toBe(1);

    // Reopened, the Session finds it; an explicit Stop ends it.
    await request({operation: 'open', id});
    await expect
      .poll(async () => (await request({operation: 'get', id})).status, {timeout: 70_000})
      .toBe('running');
    expect((await listed()).length).toBe(1);
    await call(controller, {operation: 'stop', id, source: 'user'});
    await expectStopped(async () => (await request({operation: 'get', id})).status, root, id);
    expect(await listed()).toEqual([]);
  } finally {
    host.close();
    await endSessionProcesses(root);
  }
});
