import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {expect, test} from '../fixtures/electron-app';

// Boots a real colima machine (minutes, about 2 GB of memory): only when asked, with E2E_SANDBOX=1.
test.skip(!process.env.E2E_SANDBOX, 'set E2E_SANDBOX=1 to create a real sandbox');

test('a real sandbox: create it, work in a terminal that is tmux, publish a port, let an agent work in it, stop it, destroy it', async ({
  mainWindow: page,
  app,
  mcpPort,
}) => {
  test.setTimeout(25 * 60_000);
  await page.waitForSelector('webview');
  await page.getByTitle('Terminal', {exact: true}).click();
  const dock = page.getByTestId('terminal-dock');
  const panel = dock.getByRole('group', {name: 'Panel'});
  await panel.getByRole('button', {name: 'Environment'}).click();
  const view = page.getByTestId('environment-view');
  await view.getByRole('button', {name: /^Sandbox/}).click();
  await view
    .getByRole('group', {name: 'Size'})
    .getByRole('button', {name: /^1 CPU/})
    .click();
  await view.getByRole('button', {name: 'Create sandbox'}).click();
  await expect(view).toContainText('Creating');
  await expect(view.getByRole('status')).toContainText('Proved running', {timeout: 20 * 60_000});
  // Fixed once created.
  await expect(
    view.getByRole('group', {name: 'Size'}).getByRole('button', {name: /^2 CPU/})
  ).toBeDisabled();

  // A terminal in it is a tmux session in the machine, not a shell on the Mac.
  await panel.getByRole('button', {name: 'Terminal'}).click();
  await expect(dock.getByRole('tab').first()).toContainText('sandbox', {timeout: 60_000});
  await dock.locator('.xterm-helper-textarea').first().focus();
  await page.waitForTimeout(2500);
  await page.keyboard.type(
    'echo "IN_$(uname -s)_$(whoami | wc -c)_$TMUX_END"; ls /Users/*/.ssh 2>&1 | head -1'
  );
  await page.keyboard.press('Enter');
  await expect(dock.locator('.xterm-rows').first()).toContainText('IN_Linux_', {timeout: 30_000});
  await expect(dock.locator('.xterm-rows').first()).toContainText('No such file');

  // A server started there is found, published on the Mac's localhost, and opens in the previews.
  const port = 18_700 + Math.floor(Math.random() * 100);
  await page.keyboard.type(`python3 -m http.server ${port} --bind 127.0.0.1 >/dev/null 2>&1 &`);
  await page.keyboard.press('Enter');
  await panel.getByRole('button', {name: 'Ports'}).click();
  const ports = page.getByTestId('ports-view');
  await expect(ports.getByText(String(port), {exact: true})).toBeVisible({timeout: 30_000});
  await ports.getByRole('button', {name: `Publish port ${port}`}).click();
  // The port is the same number on this Mac unless something there already uses it.
  await expect(ports.getByText(/published at localhost:\d+/)).toBeVisible({timeout: 30_000});
  await ports.getByRole('button', {name: 'Open in previews'}).first().click();
  await expect(page.getByTestId('address-bar')).toHaveValue(/localhost:\d+/);
  await app.navigateTo('about:blank').catch(() => {});

  // An agent works in it: asked the first time, then remembered for this Session.
  const client = new Client({name: 'sbx-agent', version: '1'});
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: {headers: {'x-responsively-agent': 'sbx-agent'}},
    })
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({name, arguments: args});
    const t = (r.content as {type: string; text?: string}[]).find((c) => c.type === 'text');
    return {isError: r.isError === true, text: t?.text ?? ''};
  };
  const prompt = page.getByTestId('agent-prompt');
  const first = call('run_command', {command: 'echo from-the-sandbox; uname -s; pwd'});
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('echo from-the-sandbox');
  await prompt.getByRole('button', {name: 'Allow for this Session'}).click();
  const ran = await first;
  expect(ran.isError).toBe(false);
  expect(ran.text).toContain('from-the-sandbox');
  expect(ran.text).toContain('Linux');
  expect(ran.text).toContain('workspace');
  // No second question for the same permission; files are a separate permission.
  expect((await call('run_command', {command: 'echo again'})).text).toContain('again');
  await expect(prompt).toHaveCount(0);
  const wrote = call('write_file', {path: 'notes/a.txt', content: 'hello from an agent\n'});
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', {name: 'Allow once'}).click();
  expect((await wrote).isError).toBe(false);
  const readBack = call('read_file', {path: 'notes/a.txt'});
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', {name: 'Deny'}).click();
  expect((await readBack).text).toContain('did not allow');
  // The workspace is the limit.
  const escape = call('read_file', {path: '../../etc/passwd'});
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', {name: 'Allow once'}).click();
  expect((await escape).text).toContain('inside the sandbox workspace');
  await client.close();

  // Stop, then destroy with the typed name.
  await panel.getByRole('button', {name: 'Environment'}).click();
  await view.getByRole('button', {name: 'Stop', exact: true}).click();
  await expect(view).toContainText('Stopped', {timeout: 5 * 60_000});
  await view.getByRole('button', {name: 'Destroy sandbox…'}).click();
  const name = await view.locator('b.font-mono').first().innerText();
  await view.getByLabel('Type the Session name to confirm').fill(name);
  await view.getByRole('button', {name: 'Delete for good'}).click();
  await expect(view).toContainText('Not created', {timeout: 5 * 60_000});
});
