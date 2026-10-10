import {execFileSync} from 'child_process';
import http from 'http';
import type {AddressInfo} from 'net';
import {expect, test} from '../fixtures/electron-app';

test('a Session can send its previews through a proxy, and turn it off again', async ({
  mainWindow: page,
  app,
}) => {
  const seen: string[] = [];
  const proxy = http.createServer((req, res) => {
    seen.push(req.url ?? '');
    if (req.url?.startsWith('http://echo.test/')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ip: '203.0.113.9'}));
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>reached through the proxy</title><h1>via proxy</h1>');
  });
  await new Promise<void>((resolve) => {
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const port = (proxy.address() as AddressInfo).port;
  try {
    await page.waitForSelector('webview');
    await page.getByTitle('Network for this Session').click();
    const panel = page.getByTestId('network-panel');
    await panel.getByLabel('Send this Session').check();

    // A bad address changes nothing and says why.
    await panel.getByLabel('Proxy address').fill('127.0.0.1:1');
    await panel.getByRole('button', {name: 'Test and apply'}).click();
    await expect(panel.getByRole('status')).toContainText('Use socks5://');

    await panel.getByLabel('Proxy address').fill(`http://127.0.0.1:${port}`);
    await panel.getByRole('button', {name: 'Test and apply'}).click();
    await expect(panel.getByRole('status')).toContainText('Pages now leave from 203.0.113.9');
    await expect(page.getByTestId('network-button')).toContainText('proxy');

    // A page that only the proxy can reach now loads in the previews.
    await app.navigateTo('http://proxied.test/', {timeout: 15_000});
    await expect
      .poll(() => seen.some((u) => u.startsWith('http://proxied.test/')), {timeout: 15_000})
      .toBe(true);

    // The popover closes when the page takes focus: open it again to switch the proxy off.
    if (!(await panel.isVisible())) await page.getByTitle('Network for this Session').click();
    await panel.getByLabel('Send this Session').uncheck();
    await expect(page.getByTestId('network-button')).not.toContainText('proxy');
  } finally {
    await page.keyboard.press('Escape');
    proxy.close();
  }
});

const KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';
const helperRunning = () => {
  try {
    return execFileSync('pgrep', ['-f', 'assets/bin/wireproxy']).toString().trim() !== '';
  } catch {
    return false; // pgrep exits 1 when nothing matches
  }
};

test('a WireGuard config that cannot connect changes nothing and leaves no helper running', async ({
  mainWindow: page,
}) => {
  test.setTimeout(90_000);
  await page.waitForSelector('webview');
  const panel = page.getByTestId('network-panel');
  if (!(await panel.isVisible())) await page.getByTitle('Network for this Session').click();
  await panel.getByLabel('Send this Session').check();
  await expect(panel.getByLabel('Send this Session')).toBeChecked();
  await panel
    .getByRole('group', {name: 'Kind'})
    .getByRole('button', {name: 'WireGuard config'})
    .click();

  // Nothing pasted: nothing to apply.
  await expect(panel.getByRole('button', {name: 'Test and apply'})).toBeDisabled();

  // Not a WireGuard config, or one with a section that could open a listener: refused with the reason.
  await panel.getByLabel('WireGuard config').fill('hello');
  await panel.getByRole('button', {name: 'Test and apply'}).click();
  await expect(panel.getByRole('status')).toContainText('not a WireGuard config');
  await panel
    .getByLabel('WireGuard config')
    .fill(
      `[Interface]\nPrivateKey = ${KEY}\n[Peer]\nPublicKey = ${KEY}\nEndpoint = 127.0.0.1:9\n[Socks5]\nBindAddress = 0.0.0.0:1080\n`
    );
  await panel.getByRole('button', {name: 'Test and apply'}).click();
  await expect(panel.getByRole('status')).toContainText('not allowed');

  // A well-formed config whose server never answers: the helper starts, the test fails, all is undone.
  await panel
    .getByLabel('WireGuard config')
    .fill(
      `[Interface]\nPrivateKey = ${KEY}\nAddress = 10.2.0.2/32\n[Peer]\nPublicKey = ${KEY}\nAllowedIPs = 0.0.0.0/0\nEndpoint = 127.0.0.1:9\n`
    );
  await panel.getByRole('button', {name: 'Test and apply'}).click();
  await expect(panel.getByRole('status')).toContainText('Could not connect through that config', {
    timeout: 45_000,
  });
  await expect(page.getByTestId('network-button')).not.toContainText('vpn');
  await expect(panel.getByText(/Saved config/)).toHaveCount(0);
  await expect.poll(helperRunning, {timeout: 10_000}).toBe(false);
  await panel.getByLabel('Send this Session').uncheck();
});
