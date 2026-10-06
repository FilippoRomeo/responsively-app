import {test, expect} from '../fixtures/electron-app';
import type {ResponsivelyApp} from '../models/app';

/** Every preview gets a marker; a reload drops it. */
const markPreviews = (app: ResponsivelyApp) =>
  app.electronApp.evaluate(async ({webContents}) => {
    const guests = webContents.getAllWebContents().filter((wc) => wc.getType() === 'webview');
    await Promise.all(guests.map((g) => g.executeJavaScript('window.__marker = 1')));
    return guests.length;
  });

const markedPreviews = (app: ResponsivelyApp) =>
  app.electronApp.evaluate(async ({webContents}) => {
    const guests = webContents.getAllWebContents().filter((wc) => wc.getType() === 'webview');
    const marks = await Promise.all(
      guests.map((g) => g.executeJavaScript('window.__marker === 1').catch(() => true))
    );
    return marks.filter(Boolean).length;
  });

/** Counts clearCache calls on every session of this process. */
const cacheClears = (app: ResponsivelyApp) =>
  app.electronApp.evaluate(({session}) => {
    const proto = Object.getPrototypeOf(session.defaultSession) as any;
    if (!proto.__countedClearCache) {
      const original = proto.clearCache;
      proto.clearCache = function clearCache(...args: unknown[]) {
        (globalThis as any).__clearCacheCalls = ((globalThis as any).__clearCacheCalls ?? 0) + 1;
        return original.apply(this, args);
      };
      proto.__countedClearCache = true;
    }
    return ((globalThis as any).__clearCacheCalls ?? 0) as number;
  });

/** A keystroke that lands inside a preview, not in the app's own UI. */
const pressInsideGuest = (app: ResponsivelyApp, keyCode: string, modifiers: string[]) =>
  app.electronApp.evaluate(
    ({webContents}, {keyCode: code, modifiers: mods}) => {
      const guest = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview');
      if (!guest) throw new Error('no preview webview attached');
      guest.focus();
      guest.sendInputEvent({type: 'keyDown', keyCode: code, modifiers: mods as any});
      guest.sendInputEvent({type: 'keyUp', keyCode: code, modifiers: mods as any});
    },
    {keyCode, modifiers}
  );

test.describe('Reload shortcuts', () => {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const guestMod = process.platform === 'darwin' ? 'meta' : 'control';

  test.beforeEach(async ({app}) => {
    await app.dismissModals();
    expect(await markPreviews(app)).toBeGreaterThan(0);
    await cacheClears(app);
  });

  test('Cmd+R in the toolbar reloads every preview and keeps the cache', async ({app}) => {
    const before = await cacheClears(app);
    await app.page.locator('[data-testid="nav-refresh"]').focus();
    await app.page.keyboard.press(`${mod}+r`);
    await expect.poll(() => markedPreviews(app), {timeout: 15_000}).toBe(0);
    expect(await cacheClears(app)).toBe(before);
  });

  test('Cmd+R inside a preview reloads every preview', async ({app}) => {
    await pressInsideGuest(app, 'r', [guestMod]);
    await expect.poll(() => markedPreviews(app), {timeout: 15_000}).toBe(0);
  });

  test('Cmd+Shift+R clears the cache, then reloads every preview', async ({app}) => {
    const before = await cacheClears(app);
    await pressInsideGuest(app, 'r', [guestMod, 'shift']);
    await expect.poll(() => cacheClears(app), {timeout: 10_000}).toBeGreaterThan(before);
    await expect.poll(() => markedPreviews(app), {timeout: 15_000}).toBe(0);
  });

  test('Cmd+Shift+R also clears cookies and storage, and counts them down in a toast', async ({
    app,
  }) => {
    const cookies = () =>
      app.electronApp.evaluate(
        async ({session}) => (await session.defaultSession.cookies.get({})).length
      );
    await app.electronApp.evaluate(({session}) =>
      session.defaultSession.cookies.set({url: 'http://localhost/', name: 'e2e', value: 'x'})
    );
    expect(await cookies()).toBeGreaterThan(0);
    await app.electronApp.evaluate(({webContents}) =>
      Promise.all(
        webContents
          .getAllWebContents()
          .filter((wc) => wc.getType() === 'webview')
          .map((wc) => wc.executeJavaScript("localStorage.setItem('e2e', 'x'.repeat(20000))"))
      )
    );
    await pressInsideGuest(app, 'r', [guestMod, 'shift']);
    const toast = app.page.getByTestId('clear-data-toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('reloaded', {timeout: 10_000});
    await expect(toast).toContainText(/Cleared [1-9]/);
    await expect(toast).toContainText(/Site storage\s*0 B/);
    await expect(toast).toContainText(/Cookies\s*0 · 0 B/);
    expect(await cookies()).toBe(0);
    await expect.poll(() => markedPreviews(app), {timeout: 15_000}).toBe(0);
    await expect(toast).toBeHidden({timeout: 10_000});
  });
});
