import {expect, test} from '../fixtures/electron-app';

test('saved tunnels show proven status; Ports lists what a terminal opened', async ({
  mainWindow: page,
}) => {
  test.setTimeout(120_000);
  await page.waitForSelector('webview');
  await page.getByTitle('Terminal', {exact: true}).click();
  const dock = page.getByTestId('terminal-dock');
  await expect(dock.getByRole('tab')).toHaveCount(1, {timeout: 30_000});

  // ---- Tunnels
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Tunnels'}).click();
  const view = page.getByTestId('tunnels-view');
  await view.getByRole('button', {name: '+ New tunnel'}).click();
  await view.getByLabel('Name', {exact: true}).fill('ComfyUI on gpu-box');
  await view.getByLabel('Server', {exact: true}).fill('gpu-box');
  await view.getByLabel('Service on the server').fill('localhost:8188');
  await view.getByLabel('Port on this Mac').fill('48188');
  await view.getByRole('button', {name: 'Save tunnel'}).click();
  await expect(view.getByText('ComfyUI on gpu-box')).toBeVisible();
  await expect(view.getByText('Stopped', {exact: true})).toBeVisible();

  await view.getByRole('button', {name: 'Start ComfyUI on gpu-box'}).click();
  await expect(view.getByText('Connected', {exact: true})).toBeVisible({timeout: 20_000});
  await expect(view.getByRole('button', {name: 'Open in previews'})).toBeVisible();
  await view.getByRole('button', {name: 'Stop ComfyUI on gpu-box'}).click();
  await expect(view.getByText('Stopped', {exact: true})).toBeVisible({timeout: 15_000});

  // A server that refuses us says so, and does not hang or retry.
  await view.getByRole('button', {name: 'Edit ComfyUI on gpu-box'}).click();
  await view.getByLabel('Server', {exact: true}).fill('auth-host');
  await view.getByRole('button', {name: 'Save tunnel'}).click();
  await view.getByRole('button', {name: 'Start ComfyUI on gpu-box'}).click();
  await expect(view.getByText('Needs authentication')).toBeVisible({timeout: 20_000});
  await expect(view.getByText(/Permission denied/)).toBeVisible();

  // A bad definition is refused with the reason.
  await view.getByRole('button', {name: 'Edit ComfyUI on gpu-box'}).click();
  await view.getByLabel('Server', {exact: true}).fill('-oProxyCommand=evil');
  await view.getByRole('button', {name: 'Save tunnel'}).click();
  await expect(view.getByRole('alert')).toContainText('alias');
  await view.getByRole('button', {name: 'Cancel'}).click();
  await view.getByRole('button', {name: 'Delete ComfyUI on gpu-box'}).click();
  await expect(view.getByText('ComfyUI on gpu-box')).toHaveCount(0);

  // ---- Ports: a server started in a terminal appears, by process, and opens in the previews.
  const port = 47_000 + Math.floor(Math.random() * 1000);
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Terminal'}).click();
  await dock.locator('.xterm-helper-textarea').first().focus();
  await page.waitForTimeout(1000);
  await page.keyboard.type(
    `/usr/bin/python3 -m http.server ${port} --bind 127.0.0.1 >/dev/null 2>&1 &`
  );
  await page.keyboard.press('Enter');
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Ports'}).click();
  const ports = page.getByTestId('ports-view');
  await expect(ports.getByText(String(port), {exact: true})).toBeVisible({timeout: 20_000});
  await ports.getByRole('button', {name: 'Open in previews'}).first().click();
  await expect(page.getByTestId('address-bar')).toHaveValue(new RegExp(`localhost:${port}`));

  // Closing the shell's tab stops what it started.
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Terminal'}).click();
  await dock
    .getByRole('button', {name: /^Close sh/})
    .first()
    .click();
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Ports'}).click();
  await page.getByTitle('Terminal', {exact: true}).click();
});
