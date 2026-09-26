import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {MCP_SERVER_NAME} from '../common/mcp';
import {createBackend} from './backend';
import {readBeacon, resolveTargetPort} from './beacon';
import {log} from './log';
import {loadManifest} from './manifest';
import {
  controllerClient,
  controllerRoot,
  sessionToolOperations,
} from '../common/session-controller';
import {launchController} from './launch';
import {SessionRequest} from '../common/sessions';
import {createSessionRouter, hasSessionArgument, withSessionArgument} from './session-routing';

/** Lifecycle calls through this bridge are an agent's, whatever the arguments claim. */
export const agentLifecycleRequest = (
  args: Record<string, unknown> | undefined,
  operation: SessionRequest['operation']
): SessionRequest => ({...args, operation, source: 'agent'}) as SessionRequest;

export const startBridge = async () => {
  const manifest = loadManifest();
  const port = resolveTargetPort(process.env, readBeacon());
  const backend = createBackend({port});
  const root = controllerRoot();
  const manage = controllerClient(root, () => launchController(root));
  const routeToSession = createSessionRouter({manage});

  const server = new Server(
    {name: MCP_SERVER_NAME, version: manifest.version},
    {capabilities: {tools: {}}}
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Lazy by design: listing tools must never launch the app. Serve the
    // build-time manifest until the app is up, then proxy the live list.
    const client = await backend.getIfRunning();
    if (client !== null) {
      const live = await client.listTools();
      // Lifecycle tools belong to this bridge/controller, even if an older
      // browser runtime is already listening on the configured browser port.
      return {
        tools: withSessionArgument([
          ...live.tools.filter(
            (tool) => !Object.prototype.hasOwnProperty.call(sessionToolOperations, tool.name)
          ),
          ...manifest.tools.filter((tool) =>
            Object.prototype.hasOwnProperty.call(sessionToolOperations, tool.name)
          ),
        ]),
      };
    }
    return {tools: withSessionArgument(manifest.tools)};
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const operation =
        sessionToolOperations[request.params.name as keyof typeof sessionToolOperations];
      if (Object.prototype.hasOwnProperty.call(sessionToolOperations, request.params.name)) {
        const value = await manage(agentLifecycleRequest(request.params.arguments, operation));
        return {content: [{type: 'text' as const, text: JSON.stringify(value, null, 2)}]};
      }
      if (hasSessionArgument(request.params)) {
        return await routeToSession(request.params);
      }
      return await backend.callTool(request.params);
    } catch (error) {
      if (error instanceof McpError) {
        // Backend protocol error (e.g. unknown tool) — relay verbatim.
        throw error;
      }
      // Launch/timeout failures: model-visible, actionable text.
      return {
        content: [{type: 'text', text: error instanceof Error ? error.message : String(error)}],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  log(`bridge ready (app port ${port}, manifest v${manifest.version})`);
};
