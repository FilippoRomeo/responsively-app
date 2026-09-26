// @vitest-environment node
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import http from 'http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SessionInfo, SessionRequest} from '../common/sessions';
import {Backend} from './backend';
import {
  createSessionRouter,
  hasSessionArgument,
  resolveSessionPort,
  withSessionArgument,
} from './session-routing';

const ID = '8b6f2f0e-3c4d-4e5f-9a1b-2c3d4e5f6a7b';

const session = (overrides: Partial<SessionInfo>): SessionInfo => ({
  id: ID,
  name: 'Shop',
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  status: 'stopped',
  ...overrides,
});

const runningOn = (mcpPort: number | null) =>
  session({
    status: 'running',
    runtime: {
      pid: 4242,
      mcpPort,
      browserSyncPort: 50001,
      userDataDir: '/tmp/profile',
      startedAt: '2026-09-26T00:00:00.000Z',
    },
  });

const running: Array<() => Promise<void>> = [];

/** A stand-in Session runtime whose `whoami` tool reports which runtime answered. */
const startFakeRuntime = async (label: string): Promise<number> => {
  const httpServer = http.createServer(async (req, res) => {
    const server = new McpServer({name: 'responsively', version: '0.0.1-test'});
    server.registerTool('whoami', {description: 'who answered'}, async () => ({
      content: [{type: 'text', text: label}],
    }));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  running.push(
    () =>
      new Promise((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      })
  );
  return (httpServer.address() as {port: number}).port;
};

const freePort = async (): Promise<number> => {
  const probe = http.createServer();
  await new Promise<void>((resolve) => {
    probe.listen(0, '127.0.0.1', () => resolve());
  });
  const {port} = probe.address() as {port: number};
  await new Promise<void>((resolve) => {
    probe.close(() => resolve());
  });
  return port;
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((close) => close()));
});

describe('withSessionArgument', () => {
  it('adds an optional session property to browser tools and keeps their own schema', () => {
    const [navigate, state] = withSessionArgument([
      {
        name: 'navigate',
        inputSchema: {type: 'object', properties: {url: {type: 'string'}}, required: ['url']},
      },
      {name: 'get_app_state', inputSchema: {type: 'object'}},
    ]);
    expect(navigate.inputSchema).toMatchObject({
      type: 'object',
      properties: {url: {type: 'string'}, session: {type: 'string', format: 'uuid'}},
      required: ['url'],
    });
    expect(state.inputSchema).toMatchObject({properties: {session: {type: 'string'}}});
  });

  it('leaves lifecycle tools unchanged', () => {
    const tool = {name: 'get_session', inputSchema: {type: 'object', properties: {id: {}}}};
    expect(withSessionArgument([tool])[0]).toBe(tool);
  });
});

describe('hasSessionArgument', () => {
  it('is true only when a session value is present', () => {
    expect(hasSessionArgument({name: 'navigate', arguments: {url: 'x', session: ID}})).toBe(true);
    expect(hasSessionArgument({name: 'navigate', arguments: {url: 'x'}})).toBe(false);
    expect(hasSessionArgument({name: 'navigate', arguments: {session: undefined}})).toBe(false);
    expect(hasSessionArgument({name: 'get_app_state'})).toBe(false);
  });
});

describe('resolveSessionPort', () => {
  const resolveWith = (info: SessionInfo) => resolveSessionPort(async () => info, ID);

  it('returns the verified runtime port of a running Session', async () => {
    await expect(resolveWith(runningOn(51874))).resolves.toEqual({port: 51874, name: 'Shop'});
  });

  it('asks the controller for exactly this Session', async () => {
    const manage = vi.fn(async (_request: SessionRequest) => runningOn(51874));
    await resolveSessionPort(manage, ID);
    expect(manage).toHaveBeenCalledWith({operation: 'get', id: ID});
  });

  it.each([
    [runningOn(null), /is running with MCP turned off/],
    [session({status: 'starting'}), /is starting\. Retry/],
    [session({status: 'stopping'}), /is stopping/],
    [session({status: 'stopped'}), /is stopped\. Call open_session/],
    [
      session({status: 'error', error: 'Session process exited unexpectedly. Open to restart it.'}),
      /error state: Session process exited unexpectedly/,
    ],
  ])('refuses a Session that cannot serve browser tools (%#)', async (info, message) => {
    await expect(resolveWith(info)).rejects.toThrow(message);
  });

  it('names the Session in every refusal', async () => {
    await expect(resolveWith(session({status: 'stopped'}))).rejects.toThrow(
      `Session "Shop" (${ID})`
    );
  });

  it('relays controller errors such as an unknown UUID', async () => {
    const manage = async () => {
      throw new Error('Session not found');
    };
    await expect(resolveSessionPort(manage, ID)).rejects.toThrow('Session not found');
  });
});

describe('createSessionRouter', () => {
  it('forwards the call without the session argument and closes the connection', async () => {
    const callTool = vi.fn(async (_params: unknown) => ({content: []}));
    const invalidate = vi.fn(async () => {});
    const backendFor = vi.fn(() => ({callTool, invalidate}) as unknown as Backend);
    const route = createSessionRouter({manage: async () => runningOn(51874), backendFor});

    await route({name: 'navigate', arguments: {url: 'http://localhost:3000', session: ID}});

    expect(backendFor).toHaveBeenCalledWith(51874, 'Shop');
    expect(callTool).toHaveBeenCalledWith({
      name: 'navigate',
      arguments: {url: 'http://localhost:3000'},
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('resolves the port again on every call, so a restarted Session is reached', async () => {
    const before = await startFakeRuntime('first runtime');
    const after = await startFakeRuntime('restarted runtime');
    let port = before;
    const manage = vi.fn(async () => runningOn(port));
    const route = createSessionRouter({manage});

    const first = await route({name: 'whoami', arguments: {session: ID}});
    port = after; // stop + Open: same UUID, new OS-assigned port
    const second = await route({name: 'whoami', arguments: {session: ID}});

    expect(first.content).toEqual([{type: 'text', text: 'first runtime'}]);
    expect(second.content).toEqual([{type: 'text', text: 'restarted runtime'}]);
    expect(manage).toHaveBeenCalledTimes(2);
  });

  it('fails fast without launching anything when the routed port is dead', async () => {
    const dead = await freePort();
    const route = createSessionRouter({manage: async () => runningOn(dead)});
    const startedAt = Date.now();

    await expect(route({name: 'whoami', arguments: {session: ID}})).rejects.toThrow(
      'Session "Shop" stopped answering on its MCP port during this call'
    );
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it('rejects a non-string session without asking the controller', async () => {
    const manage = vi.fn(async () => runningOn(51874));
    const route = createSessionRouter({manage});

    await expect(route({name: 'navigate', arguments: {session: 42}})).rejects.toThrow(
      '"session" must be a Session UUID'
    );
    expect(manage).not.toHaveBeenCalled();
  });
});
