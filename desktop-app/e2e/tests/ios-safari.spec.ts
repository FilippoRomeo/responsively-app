import {execFileSync} from 'child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {test, expect} from '../fixtures/electron-app';

// Boots a real iOS Simulator (~25 s, ~1.6 GB), so it runs only when asked:
// E2E_IOS=1 on an Apple-silicon Mac with Xcode and an iOS runtime that has an
// "iPhone 12 Pro" Simulator (the default suite's phone).
test.skip(!process.env.E2E_IOS, 'set E2E_IOS=1 to boot a real iOS Simulator');

const SIM = 'Responsively iPhone 12 Pro';
const simDevice = () => {
  const {devices} = JSON.parse(
    execFileSync('xcrun', ['simctl', 'list', 'devices', '-j']).toString()
  );
  return (Object.values(devices).flat() as {name: string; state: string}[]).find(
    (d) => d.name === SIM
  );
};

test('real iOS Safari: agents pick it, see it, and it stops and deletes cleanly', async ({
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

  // An agent switches the phone to Safari; the frame boots it and goes live.
  const picked = await call('set_device_browser', {device: 'iPhone 12 Pro', browser: 'ios-safari'});
  expect(picked.isError).toBeFalsy();
  const screen = app.page.getByTestId('ios-safari-screen').first();
  await expect(screen.locator('img')).toBeVisible({timeout: 180_000});
  await expect(app.page.getByTestId('browser-badge')).toContainText('Safari · iOS');

  const state = JSON.parse((await call('get_app_state')).content[0].text ?? '{}');
  expect(state.activeDevices[0].browser).toMatch(/^iOS Safari /);

  // The screenshot is the Simulator's own image, labelled as real Safari.
  await app.navigateTo('https://example.com/');
  await app.page.waitForTimeout(6000);
  const shot = await call('screenshot', {device: 'iPhone 12 Pro'});
  expect(shot.content.find((c) => c.type === 'text')?.text).toContain('real iOS Safari');
  expect(shot.content.find((c) => c.type === 'image')?.mimeType).toBe('image/jpeg');

  // Page tools say plainly that they drive Chromium devices only.
  const read = await call('read_page', {device: 'iPhone 12 Pro'});
  expect(read.isError).toBe(true);

  // Back to Chromium from the device pill stops the Simulator.
  await app.revealDevicePill(0);
  await app.page
    .locator('[data-testid="device-pill"]:visible')
    .first()
    .locator('button[title="Browser for this device"]')
    .click();
  await app.page
    .getByRole('button', {name: /Chromium/})
    .first()
    .click();
  await expect(screen).toBeHidden();
  await expect.poll(() => simDevice()?.state, {timeout: 60_000}).toBe('Shutdown');

  // Settings › Storage lists it and deletes it with two clicks.
  await app.openSettings();
  const row = app.page
    .getByTestId('settings-storage')
    .locator('div.border-t', {hasText: 'iPhone 12 Pro · iOS'});
  await row.getByRole('button', {name: /^Delete iPhone 12 Pro/}).click();
  await row.getByRole('button', {name: /^Delete .*B\?$/}).click();
  await expect.poll(() => simDevice(), {timeout: 60_000}).toBeUndefined();
  await app.dismissModals();
  await client.close();
});
