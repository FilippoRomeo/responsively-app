import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {expect, test} from '../fixtures/electron-app';

const AGENT = 'e2e-agent';

test('agents see ports and tunnels freely, and starting a tunnel asks you each time', async ({
  mainWindow: page,
  mcpPort,
}) => {
  test.setTimeout(120_000);
  await page.waitForSelector('webview');
  const client = new Client({name: 'agent-env', version: '1'});
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: {headers: {'x-responsively-agent': AGENT}},
    })
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({name, arguments: args});
    const t = (r.content as {type: string; text?: string}[]).find((c) => c.type === 'text');
    return {isError: r.isError === true, text: t?.text ?? ''};
  };
  const ipc = <R>(channel: string, ...args: unknown[]) =>
    page.evaluate(
      ([c, a]) => (window as any).electron.ipcRenderer.invoke(c, ...(a as unknown[])),
      [channel, args]
    ) as Promise<R>;

  try {
    // The user saves a tunnel; nothing else can.
    await ipc('tunnel-save', {
      name: 'ComfyUI on gpu-box',
      host: 'gpu-box',
      remote: 'localhost:8188',
      localPort: 48_300,
      anyPort: true,
    });

    // Reads need no question.
    const status = JSON.parse((await call('env_status')).text);
    expect(status.tunnels.map((t: {name: string}) => t.name)).toContain('ComfyUI on gpu-box');
    expect((await call('list_ports')).isError).toBe(false);
    expect((await call('list_tunnels')).text).toContain('stopped');

    // Unknown tunnels are not invented, and the reply says what is saved.
    const unknown = await call('start_tunnel', {tunnel: 'nope'});
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('ComfyUI on gpu-box');

    // Ask: Deny.
    const prompt = page.getByTestId('agent-prompt');
    const denied = call('start_tunnel', {tunnel: 'comfyui on gpu-box'});
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(AGENT);
    await expect(prompt).toContainText('gpu-box');
    await prompt.getByRole('button', {name: 'Deny'}).click();
    const d = await denied;
    expect(d.isError).toBe(true);
    expect(d.text).toContain('did not allow');
    expect(JSON.parse((await call('list_tunnels')).text)[0].state).toBe('stopped');

    // Ask: Allow once → connected.
    const allowed = call('start_tunnel', {tunnel: 'ComfyUI on gpu-box'});
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', {name: 'Allow once'}).click();
    const a = await allowed;
    expect(a.isError).toBe(false);
    expect(JSON.parse(a.text).state).toBe('connected');

    // Already running: no second question.
    const again = await call('start_tunnel', {tunnel: 'ComfyUI on gpu-box'});
    expect(again.isError).toBe(false);
    await expect(prompt).toHaveCount(0);

    // Stopping is always safe.
    expect(JSON.parse((await call('stop_tunnel', {tunnel: 'ComfyUI on gpu-box'})).text).state).toBe(
      'stopped'
    );

    // Off: refused at once, no question shown.
    await ipc('env-grant-set', AGENT, 'off');
    const off = await call('start_tunnel', {tunnel: 'ComfyUI on gpu-box'});
    expect(off.isError).toBe(true);
    expect(off.text).toContain('switched tunnels off');
    await expect(prompt).toHaveCount(0);

    // Every call left an audit line.
    const audit = (await ipc<{text: string; outcome: string}[]>('env-audit-list')).map(
      (l) => `${l.outcome}: ${l.text}`
    );
    expect(audit.some((l) => l.startsWith('refused') && l.includes('no, or no answer'))).toBe(true);
    expect(
      audit.some((l) => l.startsWith('allowed') && l.includes('allowed once') && l.includes(AGENT))
    ).toBe(true);
    expect(audit.some((l) => l.startsWith('refused') && l.includes('off for this agent'))).toBe(
      true
    );
  } finally {
    await ipc('env-grant-set', AGENT, 'ask').catch(() => {});
    const saved = await ipc<{def: {id: string}}[]>('tunnels-list').catch(() => []);
    for (const t of saved) await ipc('tunnel-delete', t.def.id).catch(() => {});
    await client.close();
  }
});
