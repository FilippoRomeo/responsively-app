import fs from 'fs';
import path from 'path';
import {test, expect} from '../fixtures/electron-app';
import {SessionInfo, SessionRequest} from '../../src/common/sessions';
import {call, Endpoint} from '../../src/common/session-rpc';

const previewsMuted = (electronApp: import('@playwright/test').ElectronApplication) =>
  electronApp.evaluate(({webContents}) => {
    const pages = webContents.getAllWebContents().filter((c) => c.getType() === 'webview');
    return pages.length > 0 && pages.every((c) => c.isAudioMuted());
  });

test('the toolbar button mutes every preview in the main window and is remembered', async ({
  app,
  electronApp,
}) => {
  await app.dismissModals();
  const button = app.page.locator('button[title="Mute sound"]');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await previewsMuted(electronApp)).toBe(false);

  await button.click();
  const unmute = app.page.locator('button[title="Unmute sound"]');
  await expect(unmute).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => previewsMuted(electronApp)).toBe(true);
  const config = path.join(
    await electronApp.evaluate(({app: electron}) => electron.getPath('userData')),
    'config.json'
  );
  expect(JSON.parse(fs.readFileSync(config, 'utf8')).audioMuted).toBe(true);

  await unmute.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => previewsMuted(electronApp)).toBe(false);
});

test('a Session mute is one setting for Manage Sessions and its window, kept across reopen', async ({
  app,
  mainWindow,
  electronApp,
}) => {
  test.setTimeout(180_000);
  await app.dismissModals();
  const request = (value: SessionRequest) =>
    mainWindow.evaluate(
      (v) => (window as any).electron.ipcRenderer.invoke('sessions-request', v),
      value
    ) as Promise<SessionInfo>;
  const root = await electronApp.evaluate(() => process.env.RESPONSIVELY_SESSIONS_ROOT!);
  const audio = (id: string) => {
    const endpoint = JSON.parse(
      fs.readFileSync(path.join(root, 'runtimes', `${id}.json`), 'utf8')
    ) as Endpoint;
    return {
      state: () =>
        call<{pages: number; allMuted: boolean; button: string | null}>(endpoint, {
          operation: 'e2e-audio-state',
        }),
      toggle: () => call(endpoint, {operation: 'e2e-audio-toggle'}),
    };
  };

  const created = await request({operation: 'create', name: 'Audio Mute', open: true});
  const {id} = created;
  try {
    await expect
      .poll(async () => (await request({operation: 'get', id})).status, {
        timeout: 70_000,
      })
      .toBe('running');
    const runtime = audio(id);
    await expect
      .poll(async () => (await runtime.state()).pages, {timeout: 30_000})
      .toBeGreaterThan(0);
    expect(await runtime.state()).toMatchObject({allMuted: false, button: 'false'});

    // Manage Sessions → the running window mutes and its button follows.
    await mainWindow.locator('button[title="Manage Sessions"]').click();
    const row = mainWindow.getByTestId(`session-${id}`);
    await row.locator(`button[title="Mute this Session's sound"]`).click();
    await expect(row.locator(`button[title="Unmute this Session's sound"]`)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await mainWindow.keyboard.press('Escape');
    expect((await request({operation: 'get', id})).muted).toBe(true);
    await expect.poll(runtime.state).toMatchObject({allMuted: true, button: 'true'});

    // The window's own button → saved for the Session through the controller.
    await runtime.toggle();
    await expect.poll(runtime.state).toMatchObject({allMuted: false, button: 'false'});
    expect((await request({operation: 'get', id})).muted).toBe(false);

    // Muted while stopped → opens muted.
    await request({operation: 'stop', id});
    await request({operation: 'mute', id, muted: true});
    await request({operation: 'open', id});
    const reopened = audio(id);
    await expect
      .poll(async () => (await reopened.state()).pages, {timeout: 30_000})
      .toBeGreaterThan(0);
    await expect.poll(reopened.state).toMatchObject({allMuted: true, button: 'true'});
  } finally {
    await request({operation: 'stop', id}).catch(() => {});
  }
});
