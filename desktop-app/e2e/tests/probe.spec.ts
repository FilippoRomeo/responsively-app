import {expect, test} from '../fixtures/electron-app';

test.describe('test probe', () => {
  test('plugs into a device, applies conditions live, and unplugs', async ({mainWindow: page}) => {
    await page.waitForSelector('webview');
    const name = (await page
      .locator('[data-device-label]')
      .first()
      .getAttribute('data-device-label'))!;
    await page.getByTitle('Test probe').click();
    const panel = page.getByTestId('probe-panel');
    await expect(panel).toBeVisible();

    await panel
      .getByRole('group', {name: 'Plug into'})
      .getByRole('button', {name, exact: true})
      .click();
    await expect(panel).toContainText(`plugged into ${name}`);
    // 4G is the default: it is on the device now, shown in its header.
    await expect(page.getByTestId('conditions-chip')).toHaveText(/4G/);

    await panel
      .getByRole('group', {name: 'Network'})
      .getByRole('button', {name: 'Slow 3G'})
      .click();
    await panel.getByRole('group', {name: 'CPU'}).getByRole('button', {name: '×4'}).click();
    await expect(page.getByTestId('conditions-chip')).toHaveText(/Slow 3G · CPU ×4/);

    await panel
      .getByRole('group', {name: 'Plug into'})
      .getByRole('button', {name: 'Nothing'})
      .click();
    await expect(page.getByTestId('conditions-chip')).toHaveCount(0);
    await panel.getByRole('button', {name: 'Close the probe'}).click();
    await expect(panel).toHaveCount(0);
  });

  test('clearing the chip on the device unplugs the probe', async ({mainWindow: page}) => {
    await page.waitForSelector('webview');
    const name = (await page
      .locator('[data-device-label]')
      .first()
      .getAttribute('data-device-label'))!;
    await page.getByTitle('Test probe').click();
    const panel = page.getByTestId('probe-panel');
    await panel
      .getByRole('group', {name: 'Plug into'})
      .getByRole('button', {name, exact: true})
      .click();
    await expect(page.getByTestId('conditions-chip')).toBeVisible();
    await page.getByTestId('conditions-chip').click();
    await expect(panel).toContainText('floating');
    await panel.getByRole('button', {name: 'Close the probe'}).click();
  });

  test('runs every combination on the plugged device and shows the report', async ({
    mainWindow: page,
  }) => {
    test.setTimeout(120_000);
    await page.waitForSelector('webview');
    const name = (await page
      .locator('[data-device-label]')
      .first()
      .getAttribute('data-device-label'))!;
    await page.getByTitle('Test probe').click();
    const panel = page.getByTestId('probe-panel');
    await panel
      .getByRole('group', {name: 'Plug into'})
      .getByRole('button', {name, exact: true})
      .click();
    await panel.getByLabel('Try every combination ticked above').check();
    await panel.getByRole('group', {name: 'Network'}).getByRole('button', {name: 'Wi-Fi'}).click();
    await expect(panel.getByRole('button', {name: 'Run 2 measurements'})).toBeVisible();
    await panel.getByRole('button', {name: 'Run 2 measurements'}).click();
    await expect(page.getByTestId('probe-report').or(panel.getByRole('alert'))).toBeVisible({
      timeout: 90_000,
    });
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('probe-report').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('test-run-bar')).toHaveCount(0);
    await panel.getByRole('button', {name: 'Close the probe'}).click();
  });
});
