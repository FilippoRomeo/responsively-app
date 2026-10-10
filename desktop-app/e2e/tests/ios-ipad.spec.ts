import {execFileSync} from 'child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {test, expect} from '../fixtures/electron-app';

// Boots a real iPad Simulator, so it runs only when asked (see ios-safari.spec.ts).
test.skip(!process.env.E2E_IOS, 'set E2E_IOS=1 to boot a real iOS Simulator');

const SIM = 'Responsively iPad Pro 11-inch (M4)';
const simDevice = () => {
  const {devices} = JSON.parse(
    execFileSync('xcrun', ['simctl', 'list', 'devices', '-j']).toString()
  );
  return (Object.values(devices).flat() as {udid: string; name: string; state: string}[]).find(
    (d) => d.name === SIM
  );
};

test('real iPad Safari: the iPad Pro M4 preview runs in an iPad Pro 11-inch Simulator', async ({
  app,
  mcpPort,
}) => {
  test.setTimeout(300_000);
  await app.dismissModals();
  const client = new Client({name: 'responsively-e2e', version: '1.0.0'});
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`))
  );
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({name, arguments: args}) as Promise<{
      content: {type: string; text?: string; mimeType?: string}[];
      isError?: boolean;
    }>;
  try {
    const active = await call('set_active_devices', {devices: ['iPad Pro M4']});
    expect(active.isError).toBeFalsy();
    const picked = await call('set_device_browser', {device: 'iPad Pro M4', browser: 'ios-safari'});
    expect(picked.isError).toBeFalsy();
    await expect(app.page.getByTestId('ios-safari-screen').first().locator('img')).toBeVisible({
      timeout: 180_000,
    });
    expect(simDevice()?.state).toBe('Booted');
    await call('set_device_browser', {device: 'iPad Pro M4', browser: 'chromium'});
    await expect.poll(() => simDevice()?.state, {timeout: 60_000}).toBe('Shutdown');
  } finally {
    const sim = simDevice();
    if (sim) {
      try {
        execFileSync('xcrun', ['simctl', 'shutdown', sim.udid], {stdio: 'ignore'});
      } catch {
        /* already shut down */
      }
      execFileSync('xcrun', ['simctl', 'delete', sim.udid], {stdio: 'ignore'});
    }
    await client.close();
  }
});
