import {test, expect} from '../fixtures/electron-app';
import type {ResponsivelyApp} from '../models/app';

/**
 * Regression cover for #694/#651: docked devtools is a native WebContentsView
 * that paints above every DOM element, so overlays overlapping it were simply
 * invisible. The main process detaches the view while an overlay is open.
 */
const devtoolsAttached = (app: ResponsivelyApp): Promise<boolean> =>
  app.electronApp.evaluate(({BrowserWindow}) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.contentView.children.length > 0;
  });

test.describe('Devtools overlay coordination', () => {
  test.afterAll(async ({app}) => {
    // Devtools is worker-scoped state; leave it closed for the next spec file.
    // The resizer's controls are unlabelled — close is the last one.
    const resizer = app.page.locator('[data-testid="devtools-resizer"]');
    if (await resizer.isVisible().catch(() => false)) {
      await resizer.locator('button').last().click();
      await app.page.waitForTimeout(500);
    }
  });

  test('docked devtools detaches while a modal is open and returns after', async ({app}) => {
    await app.dismissModals();

    // Open devtools on the first device.
    await app.revealDevicePill();
    await app.page.locator('button[title="Open devtools"]').first().click();
    await expect.poll(() => devtoolsAttached(app), {timeout: 15_000}).toBe(true);

    // Opening a modal must get the native view out of the way.
    await app.openSettings();
    await expect.poll(() => devtoolsAttached(app), {timeout: 10_000}).toBe(false);

    // Closing it puts devtools back.
    await app.page.keyboard.press('Escape');
    await expect.poll(() => devtoolsAttached(app), {timeout: 10_000}).toBe(true);
  });

  test('docked devtools detaches while a popover is open', async ({app}) => {
    await app.dismissModals();

    await expect.poll(() => devtoolsAttached(app), {timeout: 15_000}).toBe(true);

    await app.page.locator('button[title="Site tools"]').click();
    await expect.poll(() => devtoolsAttached(app), {timeout: 10_000}).toBe(false);

    await app.page.keyboard.press('Escape');
    await expect.poll(() => devtoolsAttached(app), {timeout: 10_000}).toBe(true);
  });

  test('close removes devtools after it was reopened on another device', async ({app}) => {
    await app.dismissModals();
    // The previous test's Site tools popover can outlive its Escape and cover the pills.
    const siteToolsItem = app.page.locator('button[title="Delete Storage"]');
    if (await siteToolsItem.isVisible()) {
      await app.page.locator('button[title="Site tools"]').click();
    }
    await expect(siteToolsItem).toBeHidden();
    const childViews = () =>
      app.electronApp.evaluate(
        ({BrowserWindow}) => BrowserWindow.getAllWindows()[0].contentView.children.length
      );
    const openOn = async (index: number) => {
      await app.revealDevicePill(index);
      await app.page
        .locator('[data-testid="device-pill"]:visible')
        .nth(index)
        .locator('button[title="Open devtools"]')
        .click();
    };

    await openOn(0);
    await expect.poll(childViews, {timeout: 15_000}).toBe(1);
    // Opening on a second device must replace the panel, not stack a second one.
    await openOn(1);
    await app.page.waitForTimeout(1000);
    expect(await childViews()).toBe(1);

    await app.page.locator('[data-testid="devtools-resizer"]').locator('button').last().click();
    await expect.poll(childViews, {timeout: 10_000}).toBe(0);
  });
});
