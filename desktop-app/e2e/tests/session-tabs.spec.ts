import fs from 'fs';
import path from 'path';
import {test, expect} from '../fixtures/electron-app';
import {SessionInfo, SessionRequest, WindowBounds} from '../../src/common/sessions';
import {call, Endpoint} from '../../src/common/session-rpc';

type Request = (value: SessionRequest) => Promise<SessionInfo>;

test.describe('Session tabs', () => {
  test.describe.configure({mode: 'serial'});
  const ids: string[] = [];
  let request: Request;
  let root: string;
  const sessionWindow = (id: string) =>
    call<{bounds: WindowBounds; focused: boolean}>(
      JSON.parse(fs.readFileSync(path.join(root, 'runtimes', `${id}.json`), 'utf8')) as Endpoint,
      {operation: 'e2e-window'}
    );
  // macOS keeps windows inside the usable area (below the menu bar, beside the
  // Dock); put this window there, as any window you work in already is.
  const placeMain = (app: any): Promise<WindowBounds> =>
    app.electronApp.evaluate(({BrowserWindow, screen}: any) => {
      const win = BrowserWindow.getAllWindows().find(
        (w: any) => !w.webContents.getURL().includes('sessionsPanel=1')
      );
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      win.setBounds({x: area.x + 40, y: area.y + 40, width: 1200, height: 760});
      return win.getBounds();
    });
  const placeholder = (app: any) =>
    app.electronApp.windows().find((w: any) => w.url().includes('placeholder=1'));

  test.beforeAll(async ({mainWindow, electronApp}) => {
    request = (value) =>
      mainWindow.evaluate(
        (v) => (window as any).electron.ipcRenderer.invoke('sessions-request', v),
        value
      ) as Promise<SessionInfo>;
    root = await electronApp.evaluate(() => process.env.RESPONSIVELY_SESSIONS_ROOT!);
  });

  test.afterAll(async () => {
    for (const id of ids) await request({operation: 'stop', id}).catch(() => {});
  });

  test('a tab click and Ctrl+Tab bring that Session to this window, in place', async ({app}) => {
    test.setTimeout(150_000);
    await app.dismissModals();
    for (const name of ['Tab One', 'Tab Two']) {
      const {id} = await request({operation: 'create', name, open: true});
      ids.push(id);
    }
    for (const id of ids)
      await expect
        .poll(async () => (await request({operation: 'get', id})).status, {timeout: 70_000})
        .toBe('running');
    // The strip polls only while its window has focus (hidden in E2E): focus it.
    await app.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const strip = app.page.getByTestId('session-tabs');
    await expect(strip.getByRole('tab')).toHaveCount(2, {timeout: 10_000});

    const here = await placeMain(app);
    await app.page.getByTestId(`session-tab-${ids[1]}`).click();
    await expect.poll(async () => (await sessionWindow(ids[1])).bounds).toEqual(here);

    // From the main window (no current Session) Ctrl+Tab goes to the first tab.
    await app.page.bringToFront();
    await app.page.keyboard.press('Control+Tab');
    await expect.poll(async () => (await sessionWindow(ids[0])).bounds).toEqual(here);
  });

  test('Cmd+T shows the New Session form in place; Save opens the Session there', async ({app}) => {
    test.setTimeout(150_000);
    await app.dismissModals();
    const here = await placeMain(app);
    await app.page.getByRole('button', {name: 'New Session tab'}).click();
    await expect.poll(() => Boolean(placeholder(app)), {timeout: 15_000}).toBe(true);
    const form = placeholder(app)!;
    await expect
      .poll(() =>
        app.electronApp.evaluate(({BrowserWindow}: any) =>
          BrowserWindow.getAllWindows()
            .find((w: any) => w.webContents.getURL().includes('placeholder=1'))
            ?.getBounds()
        )
      )
      .toEqual(here);
    await form.getByLabel('Name', {exact: true}).fill('Tab Three');
    await form.getByRole('button', {name: 'Save', exact: true}).click();
    let id: string | undefined;
    await expect
      .poll(
        async () => {
          const item = ((await request({operation: 'list'})) as unknown as SessionInfo[]).find(
            (s) => s.name === 'Tab Three'
          );
          id = item?.id;
          return item?.status;
        },
        {timeout: 70_000}
      )
      .toBe('running');
    ids.push(id!);
    await expect.poll(() => Boolean(placeholder(app))).toBe(false);
    expect((await sessionWindow(id!)).bounds).toEqual(here);
  });

  test('Cmd+N shows the form offset like a new window; Cancel creates nothing', async ({app}) => {
    await app.dismissModals();
    const before = ((await request({operation: 'list'})) as unknown as SessionInfo[]).length;
    const here = await placeMain(app);
    await app.page.bringToFront();
    await app.page.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
    await expect.poll(() => Boolean(placeholder(app)), {timeout: 15_000}).toBe(true);
    const bounds = await app.electronApp.evaluate(({BrowserWindow}: any) =>
      BrowserWindow.getAllWindows()
        .find((w: any) => w.webContents.getURL().includes('placeholder=1'))
        ?.getBounds()
    );
    expect(bounds).toMatchObject({x: here.x + 30, width: here.width, height: here.height});
    await placeholder(app)!.getByRole('button', {name: 'Cancel', exact: true}).click();
    await expect.poll(() => Boolean(placeholder(app))).toBe(false);
    expect(((await request({operation: 'list'})) as unknown as SessionInfo[]).length).toBe(before);
  });
});
