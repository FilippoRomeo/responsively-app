import {test, expect} from '../fixtures/electron-app';
import {SessionInfo, SessionRequest} from '../../src/common/sessions';

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
    await expect(mainWindow.getByTestId('sessions-manager')).toHaveCount(0);
  } finally {
    if (id) await request({operation: 'stop', id}).catch(() => {});
  }
});
