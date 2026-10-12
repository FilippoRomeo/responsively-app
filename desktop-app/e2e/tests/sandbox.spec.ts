import {expect, test} from '../fixtures/electron-app';

// Without colima (as on CI) the Environment view says so and offers nothing it cannot do.
test.skip(!!process.env.E2E_SANDBOX, 'this runs where colima is deliberately absent');

test('Environment: Local by default, and a Sandbox says plainly when colima is missing', async ({
  mainWindow: page,
}) => {
  await page.waitForSelector('webview');
  await page.getByTitle('Terminal', {exact: true}).click();
  const dock = page.getByTestId('terminal-dock');
  await expect(dock.getByTestId('environment-chip')).toContainText('Local · your Mac');
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Environment'}).click();
  const view = page.getByTestId('environment-view');
  await expect(view.getByRole('button', {name: /^Local/})).toHaveAttribute('aria-pressed', 'true');
  await expect(view).toContainText('an agent running here would have your whole Mac');

  await view.getByRole('button', {name: /^Sandbox/}).click();
  await expect(view.getByRole('status')).toContainText('brew install colima');
  await expect(view.getByRole('button', {name: 'Create sandbox'})).toHaveCount(0);
  await expect(dock.getByTestId('environment-chip')).toContainText('Sandbox');

  // The terminal does not start a shell on the Mac behind your back.
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Terminal'}).click();
  await expect(dock).toContainText('The sandbox is');
  await expect(dock.getByRole('tab')).toHaveCount(0);

  // Back to Local: the terminal works again.
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Environment'}).click();
  await view.getByRole('button', {name: /^Local/}).click();
  await dock.getByRole('group', {name: 'Panel'}).getByRole('button', {name: 'Terminal'}).click();
  await expect(dock.getByRole('tab').first()).toBeVisible({timeout: 30_000});
  await page.getByRole('button', {name: 'Close the terminal panel'}).click();
});
