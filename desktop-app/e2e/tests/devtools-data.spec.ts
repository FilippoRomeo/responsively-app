import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {expect, test} from '../fixtures/electron-app';

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({name, arguments: args});
  const text = (result.content as {type: string; text?: string}[]).find((c) => c.type === 'text');
  return {isError: result.isError === true, text: text?.text ?? ''};
};

test.describe('DevTools data for agents', () => {
  let client: Client;

  test.beforeAll(async ({mainWindow, mcpPort, testServerUrl}) => {
    await mainWindow.waitForSelector('webview');
    client = new Client({name: 'devtools-data', version: '1'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`))
    );
    await call(client, 'navigate', {url: `${testServerUrl}/test-page.html`});
  });

  test.afterAll(async () => {
    await client?.close();
  });

  test('get_console returns what the page logged, filtered by level, and can clear', async () => {
    await call(client, 'evaluate', {
      expression: "console.error('probe-boom'); console.log('probe-chatter'); 1",
    });
    const errors = await call(client, 'get_console', {level: 'error'});
    expect(errors.isError).toBe(false);
    expect(errors.text).toContain('probe-boom');
    expect(errors.text).not.toContain('probe-chatter');
    const all = await call(client, 'get_console', {clear: true});
    expect(all.text).toContain('probe-chatter');
    const after = await call(client, 'get_console', {});
    expect(after.text).not.toContain('probe-boom');
  });

  test('get_network captures the requests of a reload', async () => {
    const seen = await call(client, 'get_network', {reload: true, url_contains: 'test-page'});
    expect(seen.isError).toBe(false);
    expect(seen.text).toContain('test-page.html');
    expect(seen.text).toContain('"status": 200');
  });

  test('get_styles gives the computed CSS and box of an element', async () => {
    const styles = await call(client, 'get_styles', {selector: 'body', properties: ['display']});
    expect(styles.isError).toBe(false);
    expect(styles.text).toContain('display');
    const missing = await call(client, 'get_styles', {selector: '#nope'});
    expect(missing.isError).toBe(true);
  });
});
