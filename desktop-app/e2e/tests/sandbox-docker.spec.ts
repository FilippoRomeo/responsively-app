import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {expect, test} from '../fixtures/electron-app';

// A real colima machine with its own Docker (several minutes, about 3 GB of memory): only with E2E_SANDBOX=1.
test.skip(!process.env.E2E_SANDBOX, 'set E2E_SANDBOX=1 to create a real sandbox with Docker');

test('Docker and Compose inside a sandbox: a stack runs, its containers and ports show, and the port opens', async ({
  mainWindow: page,
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
  await view.getByLabel('On', {exact: true}).check();
  await view.getByRole('button', {name: 'Create sandbox'}).click();
  await expect(view.getByRole('status')).toContainText('Proved running', {timeout: 20 * 60_000});
  await expect(view.getByText('None running')).toBeVisible({timeout: 30_000});

  const client = new Client({name: 'docker-agent', version: '1'});
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: {headers: {'x-responsively-agent': 'docker-agent'}},
    })
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({name, arguments: args}, undefined, {timeout: 300_000});
    const t = (r.content as {type: string; text?: string}[]).find((c) => c.type === 'text');
    return {isError: r.isError === true, text: t?.text ?? ''};
  };
  const prompt = page.getByTestId('agent-prompt');
  const port = 18_900 + Math.floor(Math.random() * 50);

  // Reads need no question, and say there is nothing yet.
  expect(JSON.parse((await call('list_containers')).text).containers).toEqual([]);

  // The agent writes a Compose file and brings the stack up (one question, for the Session).
  const wrote = call('write_file', {
    path: 'stack/compose.yml',
    content: `services:\n  web:\n    image: nginx:alpine\n    ports: ["${port}:80"]\n  cache:\n    image: redis:7-alpine\n`,
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', {name: 'Allow for this Session'}).click();
  expect((await wrote).isError).toBe(false);
  const up = call('run_command', {
    command: 'docker compose up -d 2>&1 | tail -3',
    cwd: 'stack',
    timeout_s: 240,
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', {name: 'Allow for this Session'}).click();
  const ran = await up;
  expect(ran.isError).toBe(false);
  expect(ran.text).toContain('"exitCode": 0');

  // The Environment view lists the containers; Ports names the port by its container.
  await expect(view.getByTestId('containers')).toContainText('stack-web-1', {timeout: 30_000});
  await expect(view.getByTestId('containers')).toContainText('stack-cache-1');
  const list = JSON.parse((await call('list_containers')).text).containers as {
    name: string;
    ports: number[];
  }[];
  expect(list.find((c) => c.name === 'stack-web-1')?.ports).toContain(port);

  await panel.getByRole('button', {name: 'Ports'}).click();
  const ports = page.getByTestId('ports-view');
  await expect(ports.getByText(/stack-web-1 · nginx:alpine/)).toBeVisible({timeout: 30_000});
  await ports.getByRole('button', {name: `Publish port ${port}`}).click();
  const shown = ports.getByText(/published at localhost:\d+/);
  await expect(shown).toBeVisible({timeout: 30_000});
  const hostPort = Number(/localhost:(\d+)/.exec(await shown.innerText())![1]);
  await expect
    .poll(async () => (await fetch(`http://127.0.0.1:${hostPort}/`)).status, {timeout: 30_000})
    .toBe(200);

  // Down, then the machine goes: Docker's disk goes with it.
  expect(
    (
      await call('run_command', {
        command: 'docker compose down 2>&1 | tail -2',
        cwd: 'stack',
        timeout_s: 120,
      })
    ).isError
  ).toBe(false);
  await expect(view.getByText('None running'))
    .toBeVisible({timeout: 30_000})
    .catch(() => {});
  await client.close();
  await panel.getByRole('button', {name: 'Environment'}).click();
  await view.getByRole('button', {name: 'Stop', exact: true}).click();
  await expect(view).toContainText('Stopped', {timeout: 5 * 60_000});
  await view.getByRole('button', {name: 'Destroy sandbox…'}).click();
  const name = await view.locator('b.font-mono').first().innerText();
  await view.getByLabel('Type the Session name to confirm').fill(name);
  await view.getByRole('button', {name: 'Delete for good'}).click();
  await expect(view).toContainText('Not created', {timeout: 5 * 60_000});
});
