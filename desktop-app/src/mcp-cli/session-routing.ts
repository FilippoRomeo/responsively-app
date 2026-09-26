import {sessionToolOperations} from '../common/session-controller';
import {SessionInfo, SessionRequest} from '../common/sessions';
import {Backend, createBackend} from './backend';

/**
 * Browser tools accept an optional Session UUID. The bridge resolves it to
 * the Session's current MCP port through the controller on every call —
 * ports change on every Open and are never an identity. The runtime never
 * sees this argument, so its tool definitions stay unchanged.
 */
export const SESSION_ARGUMENT = 'session';

const SESSION_PROPERTY = {
  type: 'string',
  format: 'uuid',
  description:
    'Optional Session UUID (from list_sessions or create_session). Routes this call to that ' +
    "Session's current runtime; omit to use the bridge's configured app.",
};

interface ListedTool {
  name: string;
  inputSchema: unknown;
  [key: string]: unknown;
}

type ToolCallParams = {name: string; arguments?: Record<string, unknown>};

type Manage = (request: SessionRequest) => Promise<SessionInfo | SessionInfo[]>;

const isLifecycleTool = (name: string) =>
  Object.prototype.hasOwnProperty.call(sessionToolOperations, name);

/** Adds the optional `session` property to every browser tool's input schema. */
export const withSessionArgument = <T extends ListedTool>(tools: T[]): T[] =>
  tools.map((tool) => {
    if (isLifecycleTool(tool.name)) {
      return tool;
    }
    const schema = (tool.inputSchema ?? {}) as {properties?: Record<string, unknown>};
    return {
      ...tool,
      inputSchema: {
        ...schema,
        type: 'object',
        properties: {...schema.properties, [SESSION_ARGUMENT]: SESSION_PROPERTY},
      },
    };
  });

export const hasSessionArgument = (params: ToolCallParams): boolean =>
  params.arguments !== undefined &&
  Object.prototype.hasOwnProperty.call(params.arguments, SESSION_ARGUMENT) &&
  params.arguments[SESSION_ARGUMENT] !== undefined;

const isValidPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;

/** Asks the controller where a Session's runtime serves MCP right now. */
export const resolveSessionPort = async (
  manage: Manage,
  id: string
): Promise<{port: number; name: string}> => {
  const info = (await manage({operation: 'get', id})) as SessionInfo;
  const label = `Session "${info.name}" (${info.id})`;
  switch (info.status) {
    case 'running':
      if (isValidPort(info.runtime?.mcpPort)) {
        return {port: info.runtime.mcpPort, name: info.name};
      }
      throw new Error(
        `${label} is running with MCP turned off. Turn MCP on in that Session's window, then retry.`
      );
    case 'starting':
      throw new Error(`${label} is starting. Retry in a few seconds.`);
    case 'stopping':
      throw new Error(`${label} is stopping. Call open_session once it has stopped, then retry.`);
    case 'stopped':
      throw new Error(`${label} is stopped. Call open_session with this id first, then retry.`);
    default:
      throw new Error(
        `${label} is in an error state: ${info.error ?? 'no details reported'} ` +
          'Call open_session to restart it, or ask the user to check it in the Sessions manager.'
      );
  }
};

export interface SessionRouterOptions {
  manage: Manage;
  backendFor?: (port: number, name: string) => Backend;
}

/**
 * A routed backend must never launch anything: if the Session's port stops
 * answering mid-call, the Session stopped, and the agent is told so at once.
 */
const routedBackend = (port: number, name: string) =>
  createBackend({
    port,
    launcher: async () => {
      throw new Error(
        `Session "${name}" stopped answering on its MCP port during this call. ` +
          'Check it with get_session.'
      );
    },
  });

export const createSessionRouter =
  ({manage, backendFor = routedBackend}: SessionRouterOptions) =>
  async (params: ToolCallParams) => {
    const {[SESSION_ARGUMENT]: session, ...args} = params.arguments ?? {};
    if (typeof session !== 'string' || session.length === 0) {
      throw new Error(
        `"${SESSION_ARGUMENT}" must be a Session UUID from list_sessions or create_session.`
      );
    }
    // Resolved again on every call: the port is a temporary resource.
    const {port, name} = await resolveSessionPort(manage, session);
    const backend = backendFor(port, name);
    try {
      return await backend.callTool({...params, arguments: args});
    } finally {
      await backend.invalidate();
    }
  };
