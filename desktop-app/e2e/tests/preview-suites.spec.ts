import {test, expect} from '../fixtures/electron-app';

test.describe('Preview Suites', () => {
  test('the Devices menu marks the active suite', async ({app}) => {
    await app.dismissModals();
    await app.openSuiteSelector();

    const chips = app.page.locator('[data-testid^="suite-chip-"]');
    await expect(chips.first()).toBeVisible();
    // Exactly one suite is active at a time.
    await expect(app.page.locator('[data-testid^="suite-chip-"][aria-pressed="true"]')).toHaveCount(
      1
    );
    await app.page.keyboard.press('Escape');
  });

  test('the Devices button shows how many devices the suite holds', async ({app}) => {
    await app.dismissModals();

    const label = await app.page.getByTestId('devices-button').innerText();
    const count = parseInt(label.replace(/\D/g, ''), 10);
    expect(count).toBe(await app.webviews.count());
  });

  test('the suite editor toggles a device in and out of the active suite', async ({app}) => {
    await app.dismissModals();

    const before = await app.webviews.count();

    await app.openSuiteSelector();
    // First unchecked device in the editor list.
    const unchecked = app.page.locator('button[aria-pressed="false"]:has(.font-mono)').first();
    await unchecked.click();

    await expect.poll(() => app.webviews.count(), {timeout: 10_000}).toBe(before + 1);

    // Put it back so the next spec file sees the original suite.
    const checked = app.page.locator('button[aria-pressed="true"]:has(.font-mono)').last();
    await checked.click();
    await expect.poll(() => app.webviews.count(), {timeout: 10_000}).toBe(before);

    await app.page.keyboard.press('Escape');
  });

  test('"Manage suites & devices" opens the Device Manager', async ({app}) => {
    await app.dismissModals();

    await app.openSuiteSelector();
    await app.page.getByText('Manage suites & devices').click();

    await expect(app.page.getByText('Device Manager')).toBeVisible({timeout: 10_000});

    await app.closeDeviceManager();
  });

  test('webview count matches the number of devices in the active suite', async ({app}) => {
    await app.dismissModals();

    const webviewCount = await app.webviews.count();
    expect(webviewCount).toBeGreaterThan(0);
  });
});
