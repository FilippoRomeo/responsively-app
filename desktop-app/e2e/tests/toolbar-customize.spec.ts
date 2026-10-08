import {test, expect} from '../fixtures/electron-app';
import type {Page} from '@playwright/test';

const barTitles = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="toolbar-tools"] button[title]')).map((b) =>
      b.getAttribute('title')
    )
  );

/** ⋮ open, whatever state it was in. */
const openFlyout = async (page: Page) => {
  if (!(await page.getByText('Customize toolbar…').isVisible()))
    await page.getByTestId('menu-button').click();
  await expect(page.getByText('Customize toolbar…')).toBeVisible();
};

const openCustomizer = async (page: Page) => {
  await openFlyout(page);
  await page.getByText('Customize toolbar…').click();
  await expect(page.getByTestId('toolbar-customizer')).toBeVisible();
};

/** The switch is a visually hidden checkbox: click its label. */
const hide = async (page: Page, name: string) => {
  const input = page.locator(`input[aria-label="Show ${name}"]`);
  if (await input.isChecked())
    await page.locator(`label:has(input[aria-label="Show ${name}"])`).click();
  await expect(input).not.toBeChecked();
};

const reset = async (page: Page) => {
  if (!(await page.getByTestId('toolbar-customizer').isVisible())) await openCustomizer(page);
  await page.getByRole('button', {name: 'Reset to default'}).click();
  await page.getByRole('button', {name: 'Done', exact: true}).click();
  await expect(page.getByTestId('toolbar-customizer')).toBeHidden();
};

test.describe('Customize toolbar', () => {
  test('hide, reorder and bring back buttons; hidden ones stay under More tools', async ({app}) => {
    test.setTimeout(90_000);
    await app.dismissModals();
    await expect(app.page.getByTestId('hidden-tools-count')).toHaveCount(0);
    const before = await barTitles(app.page);
    expect(before.slice(0, 3)).toEqual([
      'Rotate Devices',
      'Inspect Elements',
      'Screenshot All WebViews',
    ]);

    await openCustomizer(app.page);
    try {
      // Hide Capture: gone from the bar, counted on ⋮, listed under More tools.
      await hide(app.page, 'Capture all devices');
      await expect(
        app.page.locator('[data-testid="toolbar-tools"] button[title="Screenshot All WebViews"]')
      ).toHaveCount(0);
      await app.page.getByRole('button', {name: 'Done', exact: true}).click();
      await expect(app.page.getByTestId('hidden-tools-count')).toHaveText('1');
      expect(
        await app.page.evaluate(() => (window as any).electron.store.get('ui.toolbarLayout').hidden)
      ).toEqual(['capture']);
      await openFlyout(app.page);
      await expect(app.page.getByText('More tools')).toBeVisible();
      await expect(app.page.getByRole('button', {name: 'Capture all devices'})).toBeVisible();

      // Reorder with the arrows: Inspect moves in front of Rotate.
      await openCustomizer(app.page);
      await app.page.getByRole('button', {name: 'Move Inspect up'}).click();
      expect((await barTitles(app.page)).slice(0, 2)).toEqual([
        'Inspect Elements',
        'Rotate Devices',
      ]);
      // ...and with drag and drop: Sound to the front.
      await app.page
        .getByTestId('customize-row-sound')
        .dragTo(app.page.getByTestId('customize-row-inspect'));
      expect((await barTitles(app.page))[0]).toBe('Sound on — click to mute');
    } finally {
      await reset(app.page);
    }
    expect(await barTitles(app.page)).toEqual(before);
    await expect(app.page.getByTestId('hidden-tools-count')).toHaveCount(0);
  });

  test('a hidden tool opens its own menu or acts from ⋮ › More tools', async ({app}) => {
    test.setTimeout(90_000);
    await app.dismissModals();
    await openCustomizer(app.page);
    try {
      await hide(app.page, 'Appearance');
      await hide(app.page, 'Inspect');
      await app.page.getByRole('button', {name: 'Done', exact: true}).click();
      await expect(app.page.getByTestId('hidden-tools-count')).toHaveText('2');
      await expect(app.page.getByTestId('appearance-button')).not.toBeVisible();

      // A tool with a menu: its usual menu opens.
      await openFlyout(app.page);
      await app.page.getByRole('button', {name: 'Appearance', exact: true}).click();
      await expect(app.page.getByTestId('appearance-menu')).toBeVisible();
      await app.page.keyboard.press('Escape');

      // A plain action: it runs (Inspect turns on, then off the same way).
      const inspecting = async () =>
        (await app.page
          .locator('[data-tool="inspect"] button')
          .first()
          .getAttribute('aria-pressed')) === 'true';
      expect(await inspecting()).toBe(false);
      await openFlyout(app.page);
      await app.page.getByRole('button', {name: 'Inspect', exact: true}).click();
      await expect.poll(inspecting).toBe(true);
      await openFlyout(app.page);
      await app.page.getByRole('button', {name: 'Inspect', exact: true}).click();
      await expect.poll(inspecting).toBe(false);
    } finally {
      await reset(app.page);
    }
    await expect(app.page.getByTestId('appearance-button')).toBeVisible();
  });
});
