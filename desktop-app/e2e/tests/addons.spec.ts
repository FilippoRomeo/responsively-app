import fs from 'fs';
import os from 'os';
import path from 'path';
import {test, expect} from '../fixtures/electron-app';
import type {ResponsivelyApp} from '../models/app';

/** A folder add-on that is just a package with a browser bundle, used as it is. */
const markerFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marker-addon-'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({name: 'marker-addon', description: 'Sets a marker', unpkg: 'dist/marker.js'})
  );
  fs.writeFileSync(path.join(dir, 'dist/marker.js'), "window.__addonMark = 'set';");
  return dir;
};

const seen = (app: ResponsivelyApp) =>
  app.electronApp.evaluate(async ({webContents}) => {
    const guest = webContents
      .getAllWebContents()
      .find((wc) => wc.getType() === 'webview' && wc.getURL().includes('addon-test'));
    return guest ? guest.executeJavaScript('window.__seenAddon') : 'no preview';
  });

const install = async (app: ResponsivelyApp, source: string, edit?: () => Promise<void>) => {
  const dialog = app.page.getByTestId('addon-install');
  if (!(await dialog.isVisible()))
    await app.page.getByRole('button', {name: '+ Install add-on'}).click();
  await app.page.getByTestId('addon-source').fill(source);
  await app.page.getByRole('button', {name: 'Look inside'}).click();
  await expect(app.page.getByRole('button', {name: 'Continue'})).toBeEnabled({timeout: 10_000});
  if (edit) await edit();
  await app.page.getByRole('button', {name: 'Continue'}).click();
  await app.page.getByRole('button', {name: 'Allow and install'}).click();
  await expect(dialog).toBeHidden();
};

test.describe('Add-ons', () => {
  test('a web app docks as a panel; a folder bundle runs in previews first; parts switch off; uninstall removes', async ({
    app,
    testServerUrl,
  }) => {
    await app.dismissModals();
    await app.page.getByTestId('addons-button').click();

    // 1. A web address becomes an app panel in its own tab.
    await install(app, `${testServerUrl}/test-page-2.html`);
    await app.page.getByRole('button', {name: 'Close'}).click();
    const dock = app.page.getByTestId('addon-dock');
    await expect(dock).toBeVisible();
    await expect(dock.locator('webview')).toHaveAttribute('src', /test-page-2\.html/);

    // 2. A folder with a browser bundle becomes a page script on 127.0.0.1.
    await app.page.getByTestId('addons-button').click();
    await install(app, markerFolder(), async () => {
      await app.page.getByLabel('Runs on sites').fill('127.0.0.1:*');
      await app.page.getByRole('button', {name: /Advanced/}).click();
      await app.page.getByLabel('When it runs').selectOption('start');
      // Its build runs in a small terminal, in the add-on's folder.
      await app.page.getByLabel(/Build command/).fill('echo built-$((40 + 2)) && ls dist');
      await app.page.getByRole('button', {name: 'Run', exact: true}).click();
      await expect(app.page.getByTestId('addon-terminal')).toContainText('built-42');
      await expect(app.page.getByTestId('addon-terminal')).toContainText('marker.js');
      await expect(app.page.getByText('Built.')).toBeVisible();
    });
    await app.page.getByRole('button', {name: 'Close'}).click();
    await app.navigateTo(`${testServerUrl}/addon-test.html`);
    await expect.poll(() => seen(app), {timeout: 15_000}).toBe('before');

    // 3. Switching the part off stops it on the next load.
    await app.page.getByTestId('addons-button').click();
    await app.page.getByRole('button', {name: /marker-addon/}).click();
    const scriptSwitch = app.page.getByRole('switch', {name: 'Page script on'});
    // Click the visible track, as a person does (the input itself is visually hidden).
    await scriptSwitch.locator('xpath=..').click();
    await expect(scriptSwitch).not.toBeChecked();
    await app.page.getByRole('button', {name: 'Close'}).click();
    await app.navigateTo(`${testServerUrl}/test-page.html`);
    await app.navigateTo(`${testServerUrl}/addon-test.html`);
    await expect.poll(() => seen(app), {timeout: 15_000}).toBe('missing');

    // 4. A saved stack keeps the set; uninstalling the panel add-on removes its tab.
    await app.page.getByTestId('addons-button').click();
    await app.page.getByRole('button', {name: 'Save these switches as a stack…'}).click();
    await app.page.getByLabel('New stack name').fill('E2E stack');
    await app.page.getByRole('button', {name: 'Save', exact: true}).click();
    await expect(app.page.getByLabel('Stack for this window')).toHaveValue(/e2e-stack/);
    await app.page
      .getByRole('button', {name: /127\.0\.0\.1/})
      .first()
      .click();
    await app.page.getByRole('button', {name: 'Uninstall'}).click();
    await app.page.getByRole('button', {name: 'Uninstall, with its data?'}).click();
    await app.page.getByRole('button', {name: 'Close'}).click();
    await expect(dock).toBeHidden();
  });
});
