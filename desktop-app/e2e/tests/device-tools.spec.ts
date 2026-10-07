import {test, expect} from '../fixtures/electron-app';

const firstPill = (app: {page: import('@playwright/test').Page}) =>
  app.page.locator('[data-testid="device-pill"]:visible').first();

/** What Chromium reports for each preview: muted, and the volume of a fresh <audio>. */
const previewsAudio = (app: {page: import('@playwright/test').Page}) =>
  app.page.evaluate(() =>
    Promise.all(
      Array.from(document.querySelectorAll('webview')).map(async (w: any) => ({
        name: w.id as string,
        muted: w.isAudioMuted() as boolean,
        volume: (await w.executeJavaScript(
          // The page applies it from a MutationObserver: read after that has run.
          `new Promise((done) => { const a = document.createElement('audio'); document.body.appendChild(a); setTimeout(() => { done(a.volume); a.remove(); }, 50); })`
        )) as number,
      }))
    )
  );

test.describe('Toolbar and device tools', () => {
  test('a device mutes on its own, and the Sound menu sets its volume', async ({app}) => {
    await app.dismissModals();
    const mute = firstPill(app).locator('button[title="Mute this device"]');
    await mute.click();
    await expect(firstPill(app).locator('button[title="Unmute this device"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    let audio = await previewsAudio(app);
    expect(audio[0].muted).toBe(true);
    expect(audio.slice(1).some((a) => a.muted)).toBe(false);

    await app.page.getByTestId('sound-menu-button').click();
    const row = app.page.getByTestId(`sound-row-${audio[0].name}`);
    await expect(row).toContainText('Muted');
    await row.getByRole('slider').fill('30');
    await expect.poll(async () => (await previewsAudio(app))[0].volume).toBeCloseTo(0.3);
    audio = await previewsAudio(app);
    expect(audio[1].volume).toBe(1);
    await row.getByRole('button', {name: `Unmute ${audio[0].name}`}).click();
    await expect.poll(async () => (await previewsAudio(app))[0].muted).toBe(false);
    await row.getByRole('slider').fill('100');
    await app.page.keyboard.press('Escape');
  });

  test('× takes a device out of the suite; the last one stays', async ({app}) => {
    await app.dismissModals();
    const before = await app.webviews.count();
    expect(before).toBeGreaterThan(1);
    const name = await app.webviews.first().getAttribute('id');
    await app.page.getByRole('button', {name: `Remove ${name}`}).click();
    await expect(app.webviews).toHaveCount(before - 1);
    await expect(app.page.getByTestId('devices-button')).toContainText(`${before - 1}`);

    // Put it back through Devices ▾ so later tests see the default suite.
    await app.openSuiteSelector();
    await app.page.getByRole('button', {name: new RegExp(`^${name}`)}).click();
    await app.page.keyboard.press('Escape');
    await expect(app.webviews).toHaveCount(before);
  });

  test('⋮ › Manage Sessions… opens the Sessions manager', async ({app}) => {
    await app.dismissModals();
    await app.openManageSessions();
    await expect(app.page.getByTestId('sessions-dialog')).toBeVisible();
    await expect(app.page.getByTestId('sessions-manager')).toBeVisible();
    await app.page.keyboard.press('Escape');
    await expect(app.page.getByTestId('sessions-dialog')).toBeHidden();
  });

  test('Appearance › Colour changes the palette and is remembered', async ({app}) => {
    await app.dismissModals();
    const palette = () => app.page.evaluate(() => document.documentElement.dataset.palette);
    expect(await palette()).toBe('graphite');
    await app.page.getByTestId('appearance-button').click();
    await app.page.getByRole('radio', {name: /Stone/}).click();
    expect(await palette()).toBe('stone');
    expect(await app.page.evaluate(() => (window as any).electron.store.get('ui.palette'))).toBe(
      'stone'
    );
    await app.page.getByRole('radio', {name: /Graphite/}).click();
    await app.page.keyboard.press('Escape');
    expect(await palette()).toBe('graphite');
  });

  test('nothing in the toolbar is cut off in a 960 px window', async ({app, electronApp}) => {
    await app.dismissModals();
    const bounds = await electronApp.evaluate(({BrowserWindow}) =>
      BrowserWindow.getAllWindows()[0].getBounds()
    );
    await electronApp.evaluate(({BrowserWindow}) =>
      BrowserWindow.getAllWindows()[0].setBounds({x: 0, y: 0, width: 960, height: 900})
    );
    try {
      await expect
        .poll(() =>
          app.page.getByTestId('toolbar-slider').evaluate((el) => el.scrollWidth - el.clientWidth)
        )
        .toBeLessThanOrEqual(0);
    } finally {
      await electronApp.evaluate(
        ({BrowserWindow}, b) => BrowserWindow.getAllWindows()[0].setBounds(b),
        bounds
      );
    }
  });
});
