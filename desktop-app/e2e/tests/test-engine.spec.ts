import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {expect, test} from '../fixtures/electron-app';

const DEFAULT_DEVICE_IDS = ['10008', '10013', '10015'];

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({name, arguments: args});
  const text = (result.content as {type: string; text?: string}[]).find((c) => c.type === 'text');
  return {isError: result.isError === true, text: text?.text ?? ''};
};

test.describe('test engine', () => {
  let client: Client;

  test.beforeAll(async ({mainWindow, mcpPort, testServerUrl}) => {
    await mainWindow.waitForSelector('webview');
    client = new Client({name: 'responsively-e2e', version: '1.0.0'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`))
    );
    await call(client, 'set_active_devices', {devices: DEFAULT_DEVICE_IDS});
    await call(client, 'navigate', {url: `${testServerUrl}/test-page.html`});
  });

  test.afterAll(async () => {
    await client?.close();
  });

  test('conditions show on the device, and clearing them removes the chip', async ({
    mainWindow,
  }) => {
    const set = await call(client, 'set_conditions', {network: '4g', cpu: 4});
    expect(set.isError).toBe(false);
    const chips = mainWindow.getByTestId('conditions-chip');
    await expect(chips.first()).toContainText('4G · CPU ×4');
    await chips.first().click();
    await call(client, 'clear_conditions');
    await expect(chips).toHaveCount(0);
  });

  test('a run measures every combination, leaves the previews as they were, and keeps a report', async ({
    mainWindow,
    testServerUrl,
    app,
  }) => {
    test.setTimeout(120_000);
    const page = `${testServerUrl}/test-page.html`;
    const run = await call(client, 'run_test', {
      pages: [page],
      devices: ['10008'],
      networks: ['none', '4g'],
      cpu: [1],
      screenshots: false,
    });
    expect(run.isError).toBe(false);
    const result = JSON.parse(run.text);
    expect(result.status).toBe('complete');
    expect(result.measurements).toBe(2);
    expect(result.markdown).toContain('4G');
    expect(result.markdown).toMatch(/\d+ ms/);

    // Nothing is left throttled and the page is back.
    await expect(mainWindow.getByTestId('conditions-chip')).toHaveCount(0);
    await expect(mainWindow.getByTestId('test-run-bar')).toHaveCount(0);
    const state = JSON.parse((await call(client, 'get_app_state')).text);
    expect(state.url).toContain('test-page.html');

    const list = JSON.parse((await call(client, 'list_reports')).text);
    expect(JSON.stringify(list)).toContain(result.id);
    const report = await call(client, 'get_report', {id: result.id});
    expect(report.text).toContain(`Test report ${result.id}`);

    await app.openSettings();
    await expect(mainWindow.getByTestId('settings-storage')).toContainText(`Report ${result.id}`);
  });

  test('a run that is too big is refused with the limit', async ({testServerUrl}) => {
    const page = `${testServerUrl}/test-page.html`;
    const run = await call(client, 'run_test', {
      pages: [page],
      networks: ['none', 'wifi', '5g', '4g', '3g-fast', '3g-slow'],
      cpu: [1, 2, 4, 6],
      color_schemes: ['light', 'dark'],
      devices: DEFAULT_DEVICE_IDS,
    });
    expect(run.isError).toBe(true);
    expect(run.text).toContain('limit is 60');
  });
});
