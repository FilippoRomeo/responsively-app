import {test, expect} from '../fixtures/electron-app';
import {SessionInfo, SessionRequest} from '../../src/common/sessions';
import fs from 'fs';
import path from 'path';
import {call, Endpoint} from '../../src/common/session-rpc';

test('native Sessions menu and human lifecycle share persistent identity', async ({
  app,
  mainWindow,
  electronApp,
}) => {
  test.setTimeout(120_000);
  await app.dismissModals();
  const menu = await electronApp.evaluate(({Menu}) =>
    Menu.getApplicationMenu()?.items.map((m) => m.label)
  );
  if (process.platform === 'darwin') {
    expect(menu?.slice(-3)).toEqual(['Window', 'Sessions', 'Help']);
  }
  const request = (value: SessionRequest) =>
    mainWindow.evaluate(
      (v) => (window as any).electron.ipcRenderer.invoke('sessions-request', v),
      value
    ) as Promise<SessionInfo | SessionInfo[]>;
  let id: string | undefined;
  try {
    await mainWindow.getByTitle('Manage Sessions').click();
    await mainWindow.getByRole('button', {name: 'New Session', exact: true}).click();
    await mainWindow.getByLabel('Name', {exact: true}).fill('Human project');
    await mainWindow.getByLabel('Starting URL (optional)').fill('http://localhost:3020');
    await mainWindow.getByLabel('Open immediately').uncheck();
    await mainWindow.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(mainWindow.getByText('Human project', {exact: true})).toBeVisible();
    await expect
      .poll(() =>
        electronApp.evaluate(({Menu}) =>
          Menu.getApplicationMenu()
            ?.items.find((entry) => entry.label === 'Sessions')
            ?.submenu?.items.map((entry) => entry.label)
        )
      )
      .toContain('Human project — stopped');
    const item = ((await request({operation: 'list'})) as SessionInfo[]).find(
      (s) => s.name === 'Human project'
    )!;
    id = item.id;
    const row = mainWindow.getByTestId(`session-${id}`);
    await row.getByRole('button', {name: 'Rename', exact: true}).click();
    await mainWindow.getByLabel('Name', {exact: true}).fill('Renamed project');
    await mainWindow.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(row.getByText('Renamed project', {exact: true})).toBeVisible();
    expect(((await request({operation: 'get', id})) as SessionInfo).id).toBe(id);
    await row.getByRole('button', {name: 'Open', exact: true}).click();
    await expect
      .poll(async () => ((await request({operation: 'get', id})) as SessionInfo).status, {
        timeout: 70_000,
      })
      .toBe('running');
    await expect(row.getByRole('button', {name: 'Delete', exact: true})).toBeDisabled();
    await row.getByRole('button', {name: 'Focus', exact: true}).click();
    await expect(row.getByRole('button', {name: 'Stop', exact: true})).toBeEnabled();
    await row.getByRole('button', {name: 'Stop', exact: true}).click();
    await expect
      .poll(async () => ((await request({operation: 'get', id})) as SessionInfo).status)
      .toBe('stopped');
    await expect(row.getByRole('button', {name: 'Delete', exact: true})).toBeEnabled();
    await row.getByRole('button', {name: 'Delete', exact: true}).click();
    // Cancel really preserves the definition and all data.
    await mainWindow.getByRole('button', {name: 'Cancel', exact: true}).click();
    expect(((await request({operation: 'get', id})) as SessionInfo).id).toBe(id);
    await row.getByRole('button', {name: 'Delete', exact: true}).click();
    await mainWindow.getByRole('button', {name: 'Delete Session', exact: true}).click();
    await expect(row).toHaveCount(0);
    id = undefined;
    await mainWindow.keyboard.press('Escape');
    await expect(mainWindow.getByTestId('sessions-manager')).toBeHidden();
  } finally {
    if (id) await request({operation: 'stop', id}).catch(() => {});
  }
});

test('native Manage reuses one compact Sessions host', async ({app, electronApp}) => {
  await app.dismissModals();
  const invoke = () =>
    electronApp.evaluate(({Menu, BrowserWindow}) => {
      const item = Menu.getApplicationMenu()
        ?.items.find((entry) => entry.label === 'Sessions')
        ?.submenu?.items.find((entry) => entry.label === 'Manage Sessions…');
      item?.click?.(item, BrowserWindow.getFocusedWindow(), {triggeredByAccelerator: false});
    });
  const panelPromise = electronApp.waitForEvent('window');
  await invoke();
  const panel = await panelPromise;
  await panel.waitForURL(/sessionsPanel=1/);
  await expect(panel.getByTestId('sessions-manager')).toBeVisible();
  const firstCount = await electronApp.evaluate(
    ({BrowserWindow}) => BrowserWindow.getAllWindows().length
  );
  await invoke();
  expect(
    await electronApp.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)
  ).toBe(firstCount);
  await panel.keyboard.press('Escape');
  await expect
    .poll(() =>
      electronApp.evaluate(({BrowserWindow}) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('sessionsPanel=1'))
          ?.isVisible()
      )
    )
    .toBe(false);
  await invoke();
  await expect
    .poll(() =>
      electronApp.evaluate(({BrowserWindow}) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('sessionsPanel=1'))
          ?.isVisible()
      )
    )
    .toBe(true);
});

test('both processes retain manager content after creating an open Session', async ({
  app,
  mainWindow,
  electronApp,
}) => {
  test.setTimeout(120_000);
  await app.dismissModals();
  const invoke = () =>
    electronApp.evaluate(({Menu, BrowserWindow}) => {
      const item = Menu.getApplicationMenu()
        ?.items.find((entry) => entry.label === 'Sessions')
        ?.submenu?.items.find((entry) => entry.label === 'Manage Sessions…');
      item?.click?.(item, BrowserWindow.getFocusedWindow(), {triggeredByAccelerator: false});
    });
  const panelPromise = electronApp.waitForEvent('window');
  await invoke();
  const panel = await panelPromise;
  await expect(panel.getByTestId('sessions-manager')).toBeVisible();
  await panel.getByRole('button', {name: 'New Session', exact: true}).click();
  await panel.getByLabel('Name', {exact: true}).fill('Regression B');
  await panel.getByLabel('Open immediately').check();
  const request = (value: SessionRequest) =>
    mainWindow.evaluate(
      (v) => (window as any).electron.ipcRenderer.invoke('sessions-request', v),
      value
    ) as Promise<SessionInfo | SessionInfo[]>;
  let id: string | undefined;
  try {
    await panel.getByRole('button', {name: 'Save', exact: true}).click();
    await expect
      .poll(
        async () => {
          const item = ((await request({operation: 'list'})) as SessionInfo[]).find(
            (s) => s.name === 'Regression B'
          );
          id = item?.id;
          return item?.status;
        },
        {timeout: 70_000}
      )
      .toBe('running');
    if (process.platform === 'darwin') {
      await expect
        .poll(() =>
          electronApp.evaluate(({app: electron}) =>
            electron.dock?.getMenu()?.items.some((item) => item.label.startsWith('Regression B'))
          )
        )
        .toBe(true);
    }
    await invoke();
    await expect(panel.getByTestId(`session-${id}`)).toContainText('Regression B');
    await panel.keyboard.press('Escape');
    await invoke();
    await expect(panel.getByTestId(`session-${id}`)).toContainText('Regression B');
    expect(
      await electronApp.evaluate(
        ({BrowserWindow}) =>
          BrowserWindow.getAllWindows().filter((w) =>
            w.webContents.getURL().includes('sessionsPanel=1')
          ).length
      )
    ).toBe(1);

    const root = await electronApp.evaluate(() => process.env.RESPONSIVELY_SESSIONS_ROOT!);
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(root, 'runtimes', `${id}.json`), 'utf8')
    ) as Endpoint;
    await call(endpoint, {operation: 'e2e-show-panel'});
    await expect
      .poll(async () =>
        call<{content: string; hosts: number}>(endpoint, {operation: 'e2e-panel-state'})
      )
      .toMatchObject({content: expect.stringContaining('Regression B'), hosts: 1});
    expect(
      ((await request({operation: 'list'})) as SessionInfo[]).find((s) => s.id === id)?.id
    ).toBe(id);
  } finally {
    if (id) await request({operation: 'stop', id}).catch(() => {});
  }
  await invoke();
  await expect(panel.getByTestId('sessions-manager')).toBeVisible();
});
