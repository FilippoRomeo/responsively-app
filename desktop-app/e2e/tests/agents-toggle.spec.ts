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

test('the toolbar Agents button disconnects and reconnects this window', async ({
  app,
  mainWindow,
  mcpPort,
}) => {
  await app.dismissModals();
  const disconnect = app.page.locator('button[title="Disconnect AI agents from this window"]');
  const connect = app.page.locator('button[title="Connect AI agents to this window"]');
  const status = () =>
    mainWindow.evaluate(() =>
      (window as any).electron.ipcRenderer.invoke('mcp-status')
    ) as Promise<{enabled: boolean; running: boolean}>;
  await expect(disconnect).toHaveAttribute('aria-pressed', 'true');
  try {
    await disconnect.click();
    await expect(connect).toHaveAttribute('aria-pressed', 'false');
    expect(await status()).toMatchObject({enabled: false, running: false});
    await expect.poll(() => listening(mcpPort)).toBe(false);
    // The MCP panel follows the change made elsewhere.
    await app.page.locator('button[title="MCP server — connect AI tools"]').click();
    await expect(app.page.getByTestId('mcp-status')).toContainText('off');
    await app.page.keyboard.press('Escape');

    await connect.click();
    await expect(disconnect).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => listening(mcpPort)).toBe(true);
  } finally {
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

    await mainWindow.locator('button[title="Manage Sessions"]').click();
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
