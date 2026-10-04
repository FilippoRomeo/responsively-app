import fs from 'fs';
import path from 'path';
import {test, expect} from '../fixtures/electron-app';
import {SessionInfo, SessionRequest} from '../../src/common/sessions';
import {call, Endpoint} from '../../src/common/session-rpc';

/** One MCP initialize, as the agent app named in the bridge's header. */
const initialize = (port: number, agent: string) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-responsively-agent': agent,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {name: agent, version: '1'},
      },
    }),
  }).then((r) => r.status);

test.describe('MCP agents panel', () => {
  test.describe.configure({mode: 'serial'});

  test('an agent app appears when it connects and can be blocked and allowed again', async ({
    app,
    mcpPort,
  }) => {
    await app.dismissModals();
    expect(await initialize(mcpPort, 'e2e-agent')).toBe(200);
    await app.page.locator('button[title="MCP server — connect AI tools"]').click();
    const allow = app.page.getByRole('checkbox', {name: 'Allow e2e-agent'});
    await expect(allow).toBeChecked();

    await allow.uncheck();
    await expect(app.page.getByTestId('mcp-agents')).toContainText('blocked');
    await expect.poll(() => initialize(mcpPort, 'e2e-agent')).toBe(403);
    // Other agents are not affected.
    expect(await initialize(mcpPort, 'e2e-other-agent')).toBe(200);

    await allow.check();
    await expect.poll(() => initialize(mcpPort, 'e2e-agent')).toBe(200);
    await app.page.keyboard.press('Escape');
  });

  test('hard reset restarts MCP; the main window keeps its configured port', async ({
    app,
    mcpPort,
  }) => {
    await app.dismissModals();
    await app.page.locator('button[title="MCP server — connect AI tools"]').click();
    await app.page.getByRole('button', {name: 'Hard reset MCP'}).click();
    await expect(app.page.getByTestId('mcp-status')).toContainText('running');
    await expect.poll(() => initialize(mcpPort, 'e2e-agent')).toBe(200);
    await app.page.keyboard.press('Escape');
  });

  test('a Session hard reset moves its MCP to a fresh port that answers', async ({
    app,
    mainWindow,
    electronApp,
  }) => {
    test.setTimeout(120_000);
    await app.dismissModals();
    const request = (value: SessionRequest) =>
      mainWindow.evaluate(
        (v) => (window as any).electron.ipcRenderer.invoke('sessions-request', v),
        value
      ) as Promise<SessionInfo>;
    const root = await electronApp.evaluate(() => process.env.RESPONSIVELY_SESSIONS_ROOT!);
    const {id} = await request({operation: 'create', name: 'Hard Reset', open: true});
    try {
      await expect
        .poll(async () => (await request({operation: 'get', id})).status, {timeout: 70_000})
        .toBe('running');
      const before = (await request({operation: 'get', id})).runtime!.mcpPort!;
      expect(await initialize(before, 'e2e-agent')).toBe(200);
      await call(
        JSON.parse(fs.readFileSync(path.join(root, 'runtimes', `${id}.json`), 'utf8')) as Endpoint,
        {operation: 'e2e-mcp-hard-reset'}
      );
      const after = (await request({operation: 'get', id})).runtime!.mcpPort!;
      expect(after).not.toBe(before);
      expect(await initialize(after, 'e2e-agent')).toBe(200);
      await expect.poll(() => initialize(before, 'e2e-agent').catch(() => 0)).toBe(0);
    } finally {
      await request({operation: 'stop', id}).catch(() => {});
    }
  });
});
