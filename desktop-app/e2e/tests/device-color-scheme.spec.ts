import {test, expect} from '../fixtures/electron-app';
import type {ElectronApplication} from '@playwright/test';

/**
 * Set the preferred color scheme on webview content via CDP.
 * Electron's nativeTheme.themeSource does not propagate to webview
 * guest pages, so we use CDP Emulation.setEmulatedMedia directly.
 */
async function setWebviewColorScheme(electronApp: ElectronApplication, scheme: 'dark' | 'light') {
  await electronApp.evaluate(async ({webContents}, s) => {
    const wv = webContents.getAllWebContents().find((wc) => (wc as any).getType() === 'webview');
    if (!wv) return;
    try {
      wv.debugger.attach('1.3');
    } catch {
      // Already attached
    }
    await wv.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{name: 'prefers-color-scheme', value: s}],
    });
  }, scheme);
}

/**
 * Capture a screenshot of the first webview's rendered content
 * and return the center pixel's RGB values.
 */
async function captureWebviewCenterPixel(electronApp: ElectronApplication) {
  return electronApp.evaluate(async ({webContents}) => {
    const wv = webContents.getAllWebContents().find((wc) => (wc as any).getType() === 'webview');
    if (!wv) return {r: 0, g: 0, b: 0};

    const image = await wv.capturePage();
    const size = image.getSize();
    const bitmap = image.toBitmap();

    const y = Math.floor(size.height / 2);
    const x = Math.floor(size.width / 2);
    const offset = (y * size.width + x) * 4;
    return {
      r: bitmap[offset],
      g: bitmap[offset + 1],
      b: bitmap[offset + 2],
    };
  });
}

/** prefers-color-scheme: dark, as each preview's page sees it. */
const darkInPreviews = (app: {page: import('@playwright/test').Page}) =>
  app.page.evaluate(() =>
    Promise.all(
      Array.from(document.querySelectorAll('webview')).map((w) =>
        (w as any).executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches")
      )
    )
  ) as Promise<boolean[]>;

const setForAllDevices = async (
  app: {page: import('@playwright/test').Page},
  label: 'Site default' | 'Light' | 'Dark'
) => {
  await app.page.getByTestId('appearance-button').click();
  await app.page
    .getByRole('radiogroup', {name: 'Previews colour scheme'})
    .getByRole('radio', {name: label})
    .click();
  await app.page.keyboard.press('Escape');
};

test.describe('Device Color Scheme', () => {
  test('Appearance › Previews sets dark or light on every device', async ({app}) => {
    await app.dismissModals();
    await setForAllDevices(app, 'Dark');
    await expect.poll(() => darkInPreviews(app)).toEqual(expect.arrayContaining([true]));
    expect((await darkInPreviews(app)).every(Boolean)).toBe(true);

    await setForAllDevices(app, 'Light');
    await expect.poll(async () => (await darkInPreviews(app)).some(Boolean)).toBe(false);
    await setForAllDevices(app, 'Site default');
  });

  test("a device's own scheme overrides the all-devices one for that device only", async ({
    app,
  }) => {
    await app.dismissModals();
    await setForAllDevices(app, 'Light');
    await expect.poll(async () => (await darkInPreviews(app)).some(Boolean)).toBe(false);

    const own = app.page
      .locator('[data-testid="device-pill"]:visible')
      .first()
      .locator('button[title^="Colour scheme"]');
    await own.click(); // dark, this device only
    await expect
      .poll(async () => {
        const [first, ...others] = await darkInPreviews(app);
        return first && !others.some(Boolean);
      })
      .toBe(true);
    await own.click(); // light
    await expect.poll(async () => (await darkInPreviews(app))[0]).toBe(false);
    await own.click(); // back to the all-devices setting
    await expect(own).toHaveAttribute('aria-pressed', 'false');

    // "All devices" replaces any device's own choice.
    await own.click();
    await expect.poll(async () => (await darkInPreviews(app))[0]).toBe(true);
    await setForAllDevices(app, 'Light');
    await expect.poll(async () => (await darkInPreviews(app)).some(Boolean)).toBe(false);
    await expect(own).toHaveAttribute('aria-pressed', 'false');
    await setForAllDevices(app, 'Site default');
  });

  test('dark color scheme changes webview background color', async ({app, testServerUrl}) => {
    await app.dismissModals();

    await app.navigateTo(`${testServerUrl}/color-scheme-test.html`);
    await app.page.waitForTimeout(2000);

    // Light explicitly: the machine's own appearance (dark at night) must not decide this.
    await setWebviewColorScheme(app.electronApp, 'light');
    await app.page.waitForTimeout(1000);

    // Capture webview screenshot in light mode
    const lightPixel = await captureWebviewCenterPixel(app.electronApp);

    // Switch to dark color scheme
    await setWebviewColorScheme(app.electronApp, 'dark');
    await app.page.waitForTimeout(1000);

    // Capture webview screenshot in dark mode
    const darkPixel = await captureWebviewCenterPixel(app.electronApp);

    // Light should be bright (near white), dark should be noticeably darker
    const lightBrightness = lightPixel.r + lightPixel.g + lightPixel.b;
    const darkBrightness = darkPixel.r + darkPixel.g + darkPixel.b;

    expect(lightBrightness).toBeGreaterThan(600);
    expect(darkBrightness).toBeLessThan(300);

    // Reset
    await setWebviewColorScheme(app.electronApp, 'light');
  });

  test('toggling back to light restores light background', async ({app, testServerUrl}) => {
    await app.dismissModals();

    await app.navigateTo(`${testServerUrl}/color-scheme-test.html`);
    await app.page.waitForTimeout(2000);

    // Switch to dark, then back to light
    await setWebviewColorScheme(app.electronApp, 'dark');
    await app.page.waitForTimeout(1000);
    await setWebviewColorScheme(app.electronApp, 'light');
    await app.page.waitForTimeout(1000);

    // Capture webview screenshot after restoring light mode
    const pixel = await captureWebviewCenterPixel(app.electronApp);

    // Should be back to bright (light background)
    const brightness = pixel.r + pixel.g + pixel.b;
    expect(brightness).toBeGreaterThan(600);
  });
});
