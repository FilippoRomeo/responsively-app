import {expect, test} from '../fixtures/electron-app';

test('a terminal tab runs a real shell and keeps running while the panel is closed', async ({
  mainWindow: page,
}) => {
  test.setTimeout(90_000);
  await page.waitForSelector('webview');
  await page.getByTitle('Terminal', {exact: true}).click();
  const dock = page.getByTestId('terminal-dock');
  await expect(dock).toBeVisible();
  await expect(dock.getByRole('tab')).toHaveCount(1, {timeout: 30_000});

  // Type into it like a user: the screen shows what the shell printed.
  const screen = dock.locator('.xterm').first();
  await expect(screen).toBeVisible();
  await dock.locator('.xterm-helper-textarea').first().focus();
  await page.waitForTimeout(1500); // let the login shell finish starting
  await page.keyboard.type('echo MARK_$((6*7))_END');
  await page.keyboard.press('Enter');
  await expect(dock.locator('.xterm-rows').first()).toContainText('MARK_42_END', {timeout: 20_000});

  // Close the panel: the shell is still there. Reopen: same tab, same screen.
  await page.getByRole('button', {name: 'Close the terminal panel'}).click();
  await expect(dock).toHaveCount(0);
  await page.getByTitle('Terminal', {exact: true}).click();
  await expect(dock.getByRole('tab')).toHaveCount(1, {timeout: 30_000});
  await expect(dock.locator('.xterm-rows').first()).toContainText('MARK_42_END', {timeout: 20_000});

  // A second tab, then both closed: the panel starts a fresh one when opened again.
  await dock.getByRole('button', {name: 'New terminal'}).click();
  await expect(dock.getByRole('tab')).toHaveCount(2, {timeout: 30_000});
  await dock
    .getByRole('button', {name: /^Close sh/})
    .last()
    .click();
  await expect(dock.getByRole('tab')).toHaveCount(1, {timeout: 20_000});
  await dock
    .getByRole('button', {name: /^Close /})
    .first()
    .click();
  await expect(dock.getByRole('tab')).toHaveCount(0, {timeout: 20_000});
  await page.getByRole('button', {name: 'Close the terminal panel'}).click();
});
