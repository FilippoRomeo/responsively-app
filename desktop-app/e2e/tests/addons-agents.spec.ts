import fs from 'fs';
import os from 'os';
import path from 'path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {test, expect} from '../fixtures/electron-app';

/**
 * A folder add-on as people already have them: a skills folder (SKILL.md) and
 * a small MCP server package — installed as they are, then used by an agent.
 */
const agentFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-addon-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({name: 'e2e-agent-addon', keywords: ['mcp'], bin: {'e2e-mcp': 'server.js'}})
  );
  fs.writeFileSync(
    path.join(dir, 'server.js'),
    `const {McpServer} = require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/mcp.js'))});
const {StdioServerTransport} = require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'))});
const {z} = require(${JSON.stringify(require.resolve('zod'))});
const server = new McpServer({name: 'e2e-addon', version: '1.0.0'});
server.registerTool('echo', {description: 'Echo the text back', inputSchema: {text: z.string()}},
  async ({text}) => ({content: [{type: 'text', text: 'echo:' + text}]}));
server.connect(new StdioServerTransport());
`
  );
  fs.mkdirSync(path.join(dir, 'ios-check'));
  fs.writeFileSync(
    path.join(dir, 'ios-check', 'SKILL.md'),
    '---\nname: ios-check\ndescription: Check a page on real iOS Safari\n---\n\nSwitch the phone to iOS Safari, then screenshot.'
  );
  return dir;
};

test('agents use add-on tools, rules and prompts, and evaluate in the page', async ({
  app,
  mcpPort,
  testServerUrl,
}) => {
  test.setTimeout(120_000);
  await app.dismissModals();
  await app.page.getByTestId('addons-button').click();
  await app.page.getByTestId('addon-source').fill(agentFolder());
  await app.page.getByRole('button', {name: 'Look inside'}).click();
  // Found as they are: the skill as a rule, the package as an MCP server.
  await expect(app.page.getByLabel('Rule name')).toHaveValue('ios-check');
  await expect(app.page.getByLabel(/MCP server/)).toHaveValue('node server.js');
  await app.page.getByRole('button', {name: '+ Prompt'}).click();
  await app.page.getByLabel('Prompt name').fill('smoke-test');
  await app.page.getByLabel('Description').last().fill('Quick check of the page');
  await app.page
    .getByLabel('Prompt', {exact: true})
    .fill('Open the page, screenshot every device.');
  await app.page.getByRole('button', {name: 'Continue'}).click();
  await expect(app.page.getByText('Run "node server.js" on this Mac')).toBeVisible();
  await app.page.getByRole('button', {name: 'Allow and install'}).click();
  await app.page.getByRole('button', {name: 'Close'}).click();

  const client = new Client({name: 'responsively-e2e', version: '1.0.0'});
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`))
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({name, arguments: args})) as {
      content: {type: string; text?: string}[];
      isError?: boolean;
    };
    return {
      text: result.content.find((c) => c.type === 'text')?.text ?? '',
      isError: result.isError,
    };
  };
  try {
    expect(client.getInstructions()).toContain('get_rules');

    const tools = JSON.parse((await call('list_addon_tools')).text);
    expect(tools).toContainEqual(expect.objectContaining({addon: 'e2e-agent-addon', tool: 'echo'}));
    const echoed = await call('call_addon_tool', {
      addon: 'e2e-agent-addon',
      tool: 'echo',
      arguments: {text: 'hi'},
    });
    expect(echoed.text).toBe('echo:hi');

    const rules = JSON.parse((await call('get_rules')).text);
    expect(rules.onDemand).toContainEqual({
      name: 'ios-check',
      description: 'Check a page on real iOS Safari',
    });
    expect(JSON.parse((await call('get_rules', {name: 'ios-check'})).text).body).toContain(
      'Switch the phone to iOS Safari'
    );
    expect(JSON.parse((await call('get_prompts', {name: 'smoke-test'})).text).text).toBe(
      'Open the page, screenshot every device.'
    );

    await app.navigateTo(`${testServerUrl}/test-page.html`);
    const evaluated = JSON.parse((await call('evaluate', {expression: 'document.title'})).text);
    expect(evaluated.result).toBe('"Test Page 1"');

    // Switched off in the stack: its tools and rules are gone for agents.
    await app.page.getByTestId('addons-button').click();
    await app.page
      .getByRole('switch', {name: 'e2e-agent-addon on in this stack'})
      .locator('xpath=..')
      .click();
    await expect(
      app.page.getByRole('switch', {name: 'e2e-agent-addon on in this stack'})
    ).not.toBeChecked();
    await app.page.getByRole('button', {name: 'Close'}).click();
    expect(JSON.parse((await call('list_addon_tools')).text)).toEqual([]);
    expect(JSON.parse((await call('get_rules')).text).onDemand).toEqual([]);
  } finally {
    await client.close();
  }
});
