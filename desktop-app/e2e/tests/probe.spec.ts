import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

  test('a saved list of pages multiplies the run, and the report opens in a viewer', async ({
    mainWindow: page,
    testServerUrl,
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
    await panel.getByRole('button', {name: '+ New list of pages'}).click();
    await panel.getByLabel('List name').fill('Two pages');
    await panel
      .getByLabel('Pages, one address per line')
      .fill(`${testServerUrl}/test-page.html\n${testServerUrl}/test-page-2.html`);
    await panel.getByRole('button', {name: 'Save list'}).click();
    await panel.getByLabel('Try every combination ticked above').check();
    await expect(panel.getByRole('button', {name: 'Run 2 measurements'})).toBeVisible();
    await panel.getByRole('button', {name: 'Run 2 measurements'}).click();
    await expect(panel.getByTestId('probe-report')).toBeVisible({timeout: 90_000});
    await panel.getByRole('button', {name: 'Open the full report'}).click();
    const viewer = page.getByTestId('report-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('tbody tr')).toHaveCount(2);
    await viewer.getByRole('button', {name: 'Close the report'}).click();
    await expect(viewer).toHaveCount(0);
    await panel
      .getByRole('button', {name: 'Delete list'})
      .click()
      .catch(() => {});
    await panel.getByRole('button', {name: 'Close the probe'}).click();
  });

  test('"ask me first" holds an agent test until you allow it', async ({
    mainWindow: page,
    electronApp,
    mcpPort,
  }) => {
    await page.waitForSelector('webview');
    await page.getByTitle('Test probe').click();
    const panel = page.getByTestId('probe-panel');
    await panel.getByLabel('Ask me before an agent runs a test or sets conditions').check();
    const client = new Client({name: 'ask-first', version: '1'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`))
    );
    try {
      await electronApp.evaluate(({dialog}) => {
        dialog.showMessageBox = (async () => ({response: 1, checkboxChecked: false})) as never;
      });
      const denied = await client.callTool({name: 'set_conditions', arguments: {network: '4g'}});
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied.content)).toContain('declined');
      await expect(page.getByTestId('conditions-chip')).toHaveCount(0);

      await electronApp.evaluate(({dialog}) => {
        dialog.showMessageBox = (async () => ({response: 0, checkboxChecked: false})) as never;
      });
      const allowed = await client.callTool({name: 'set_conditions', arguments: {network: '4g'}});
      expect(allowed.isError).not.toBe(true);
      await expect(page.getByTestId('conditions-chip').first()).toBeVisible();
      await client.callTool({name: 'clear_conditions', arguments: {}});
    } finally {
      await client.close();
      await panel.getByLabel('Ask me before an agent runs a test or sets conditions').uncheck();
      await panel.getByRole('button', {name: 'Close the probe'}).click();
    }
  });
});
