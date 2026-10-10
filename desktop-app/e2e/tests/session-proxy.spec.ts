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
