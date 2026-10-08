import {test, expect} from '../fixtures/electron-app';
import type {Page} from '@playwright/test';

/**
 * Hardware frames and the browser bar are drawn around the page, never over
 * its size: every preview keeps its exact device size with or without them.
 */
const setSwitch = async (page: Page, label: string, on: boolean) => {
  await page.getByTestId('appearance-button').click();
  const input = page.locator(`input[aria-label="${label}"]`);
  if ((await input.isChecked()) !== on)
    await page.locator(`label:has(input[aria-label="${label}"])`).click();
  await page.keyboard.press('Escape');
};

const webviewSizes = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('webview')).map((w) => {
      const rect = w.getBoundingClientRect();
      return {id: w.id, width: Math.round(rect.width), height: Math.round(rect.height)};
    })
  );

test.describe('Device outlines', () => {
  test('are off by default and add nothing to the page when turned on', async ({app}) => {
    await app.dismissModals();
    await expect(app.page.locator('[data-bezel]')).toHaveCount(0);
    await expect(app.page.getByTestId('browser-bar')).toHaveCount(0);
    const before = await webviewSizes(app.page);

    await setSwitch(app.page, 'Hardware frames', true);
    try {
      await expect(app.page.locator('[data-bezel]')).toHaveCount(before.length);
      // The same pixels for every page, framed or not.
      expect(await webviewSizes(app.page)).toEqual(before);
      // Phone: notch and status bar; laptop: camera and base. The suite's devices
      // depend on what earlier specs left in this worker, so at least one of each.
      for (const part of ['frame-notch', 'frame-status', 'frame-camera', 'frame-base'])
        await expect(app.page.getByTestId(part).first()).toBeAttached();
      // Remembered across restarts.
      expect(
        await app.page.evaluate(() => (window as any).electron.store.get('ui.deviceFrames'))
      ).toBe(true);
    } finally {
      await setSwitch(app.page, 'Hardware frames', false);
    }
    await expect(app.page.locator('[data-bezel]')).toHaveCount(0);
    expect(
      await app.page.evaluate(() => (window as any).electron.store.get('ui.deviceFrames'))
    ).toBe(false);
  });

  test('a live browser bar sits above the laptop and follows its page', async ({
    app,
    testServerUrl,
  }) => {
    test.setTimeout(90_000);
    await app.dismissModals();
    const before = await webviewSizes(app.page);
    await setSwitch(app.page, 'Browser bar on laptops', true);
    try {
      // Laptops only, with or without frames; the page keeps its size.
      // One per laptop in the suite (earlier specs may have added more): use the first.
      const bar = app.page.getByTestId('browser-bar').first();
      await expect(bar).toBeAttached();
      expect(await webviewSizes(app.page)).toEqual(before);

      const url = app.page.getByTestId('browser-bar-url').first();
      await app.navigateTo(`${testServerUrl}/test-page.html`);
      await expect(url).toHaveText(`${testServerUrl}/test-page.html`, {timeout: 15_000});
      await app.navigateTo(`${testServerUrl}/test-page-2.html`);
      await expect(url).toHaveText(`${testServerUrl}/test-page-2.html`, {timeout: 15_000});

      // Back and forward act on this device and the bar follows.
      const back = bar.getByRole('button', {name: 'Back', exact: true});
      await expect(back).toBeEnabled();
      await back.click();
      await expect(url).toHaveText(`${testServerUrl}/test-page.html`, {timeout: 15_000});
      const forward = bar.getByRole('button', {name: 'Forward', exact: true});
      await expect(forward).toBeEnabled();
      await forward.click();
      await expect(url).toHaveText(`${testServerUrl}/test-page-2.html`, {timeout: 15_000});
      await expect(app.page.getByTestId('browser-bar-title').first()).not.toHaveText('');
      await bar.getByRole('button', {name: 'Reload', exact: true}).click();
      await expect(url).toHaveText(`${testServerUrl}/test-page-2.html`);
    } finally {
      await setSwitch(app.page, 'Browser bar on laptops', false);
    }
    await expect(app.page.getByTestId('browser-bar')).toHaveCount(0);
  });
});
