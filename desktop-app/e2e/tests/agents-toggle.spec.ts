import net from 'net';
import {test, expect} from '../fixtures/electron-app';
import {SessionInfo, SessionRequest} from '../../src/common/sessions';

const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({port, host: '127.0.0.1'});
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

test('the MCP panel Agents switch disconnects and reconnects this window', async ({
  app,
  mainWindow,
  mcpPort,
}) => {
  await app.dismissModals();
  const status = () =>
    mainWindow.evaluate(() =>
      (window as any).electron.ipcRenderer.invoke('mcp-status')
    ) as Promise<{enabled: boolean; running: boolean}>;
  await app.page.locator('button[title="MCP server — connect AI tools"]').click();
  const agents = app.page.getByRole('button', {name: 'Agents', exact: true});
  await expect(agents).toHaveAttribute('aria-pressed', 'true');
  try {
    await agents.click();
    await expect(agents).toHaveAttribute('aria-pressed', 'false');
    await expect(app.page.getByTestId('mcp-status')).toContainText('off');
    expect(await status()).toMatchObject({enabled: false, running: false});
    await expect.poll(() => listening(mcpPort)).toBe(false);

    await agents.click();
    await expect(agents).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => listening(mcpPort)).toBe(true);
  } finally {
    await app.page.keyboard.press('Escape');
    // Worker-shared app: the MCP specs need the server running.
    await mainWindow.evaluate(() =>
      (window as any).electron.ipcRenderer.invoke('mcp-set-enabled', {enabled: true})
    );
    await expect.poll(() => listening(mcpPort)).toBe(true);
  }
});

test('Manage Sessions connects and disconnects agents for a running Session', async ({
  app,
  mainWindow,
}) => {
  test.setTimeout(120_000);
  await app.dismissModals();
  const request = (value: SessionRequest) =>
    mainWindow.evaluate(
      (v) => (window as any).electron.ipcRenderer.invoke('sessions-request', v),
      value
    ) as Promise<SessionInfo>;
  const {id} = await request({operation: 'create', name: 'Agents Toggle', open: true});
  try {
    await expect
      .poll(async () => (await request({operation: 'get', id})).status, {timeout: 70_000})
      .toBe('running');
    expect((await request({operation: 'get', id})).runtime?.mcpPort).toEqual(expect.any(Number));

    expect((await request({operation: 'agents', id, enabled: false})).runtime?.mcpPort).toBeNull();

    await app.openManageSessions();
    const row = mainWindow.getByTestId(`session-${id}`);
    await row.locator('button[title="Connect AI agents to this Session"]').click();
    await expect(
      row.locator('button[title="Disconnect AI agents from this Session"]')
    ).toHaveAttribute('aria-pressed', 'true');
    await mainWindow.keyboard.press('Escape');
    expect((await request({operation: 'get', id})).runtime?.mcpPort).toEqual(expect.any(Number));
  } finally {
    await request({operation: 'stop', id}).catch(() => {});
  }
});
