import {test, expect} from '../fixtures/electron-app';

test('a narrow window slides the toolbar group sideways; dropdowns still open', async ({app}) => {
  await app.dismissModals();
  const setWidth = (width: number) =>
    app.electronApp.evaluate(({BrowserWindow}, w) => {
      const win = BrowserWindow.getAllWindows().find(
        (x) => !x.webContents.getURL().includes('sessionsPanel=1')
      )!;
      win.setBounds({...win.getBounds(), width: w});
    }, width);
  const slider = app.page.getByTestId('toolbar-slider');
  const metrics = () =>
    slider.evaluate((e) => ({left: e.scrollLeft, overflow: e.scrollWidth - e.clientWidth}));
  try {
    await setWidth(720);
    await expect.poll(async () => (await metrics()).overflow).toBeGreaterThan(0);
    // ⋮ stays reachable outside the slider.
    await expect(app.page.getByTestId('menu-button')).toBeVisible();
    const box = (await slider.boundingBox())!;
    await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await app.page.mouse.wheel(0, 400);
    await expect.poll(async () => (await metrics()).left).toBeGreaterThan(0);
    await app.page.locator('button[title="MCP server — connect AI tools"]').click();
    await expect(app.page.getByTestId('mcp-panel')).toBeVisible();
    await app.page.keyboard.press('Escape');
  } finally {
    await setWidth(1500);
  }
});
