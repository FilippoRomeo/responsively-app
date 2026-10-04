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

/**
 * Lifecycle calls through this bridge are an agent's, whatever the arguments
 * claim. Agents pass only what the tools define: never window placement or
 * UI-only switches.
 */
export const agentLifecycleRequest = (
  args: Record<string, unknown> | undefined,
  operation: SessionRequest['operation']
): SessionRequest => {
  const {bounds: _bounds, enabled: _enabled, muted: _muted, ...rest} = args ?? {};
  return {...rest, operation, source: 'agent'} as SessionRequest;
};

/**
 * Agents work in the Sessions you made: creating one is hidden from them
 * unless the bridge is explicitly started with the opt-in (Gate C does).
 */
export const hiddenTools = (env: NodeJS.ProcessEnv): Set<string> =>
  env.RESPONSIVELY_MCP_ALLOW_CREATE_SESSION === '1' ? new Set() : new Set(['create_session']);

export const startBridge = async () => {
  const hidden = hiddenTools(process.env);
  const visible = <T extends {name: string}>(tools: T[]) =>
    tools.filter((tool) => !hidden.has(tool.name));
  const manifest = loadManifest();
  const port = resolveTargetPort(process.env, readBeacon());
  const server = new Server(
    {name: MCP_SERVER_NAME, version: manifest.version},
    {capabilities: {tools: {}}}
  );
  // The agent app that started this bridge, known once it has initialized.
  const agentName = () => server.getClientVersion()?.name;
  const backend = createBackend({port, agentName});
  const root = controllerRoot();
  const manage = controllerClient(root, () => launchController(root));
  const routeToSession = createSessionRouter({manage, agentName});

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Lazy by design: listing tools must never launch the app. Serve the
    // build-time manifest until the app is up, then proxy the live list.
    const client = await backend.getIfRunning();
    if (client !== null) {
      const live = await client.listTools();
      // Lifecycle tools belong to this bridge/controller, even if an older
      // browser runtime is already listening on the configured browser port.
      return {
        tools: withSessionArgument(
          visible([
            ...live.tools.filter(
              (tool) => !Object.prototype.hasOwnProperty.call(sessionToolOperations, tool.name)
            ),
            ...manifest.tools.filter((tool) =>
              Object.prototype.hasOwnProperty.call(sessionToolOperations, tool.name)
            ),
          ])
        ),
      };
    }
    return {tools: withSessionArgument(visible(manifest.tools))};
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (hidden.has(request.params.name)) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `${request.params.name} is not available to agents. Use a running Session from ` +
              'list_sessions (pass its id as "session"), or ask the user to create one.',
          },
        ],
        isError: true,
      };
    }
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
