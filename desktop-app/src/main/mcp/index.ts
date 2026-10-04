import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {app} from 'electron';
import http from 'http';
import {AddressInfo} from 'net';
import store from '../../store';
import log from '../logging';
import {MCP_SERVER_NAME} from '../../common/mcp';
import {IPC_MAIN_CHANNELS} from '../../common/constants';
import {writeMcpBeacon} from './beacon';
import {GetMainWindow, initMcpBridge} from './bridge';
import {registerTools} from './tools';
import {isAllowedHostHeader, resolveMcpPort} from './utils';

let httpServer: http.Server | null = null;
let activePort: number | null = null;
let lastError: string | null = null;
let getMainWindowRef: GetMainWindow | null = null;

export interface McpServerStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  endpoint: string;
  error: string | null;
}

const handleMcpRequest = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  getMainWindow: GetMainWindow
) => {
  // Stateless mode: a fresh server + transport per request, so concurrent
  // agents need no session bookkeeping.
  const server = new McpServer({name: MCP_SERVER_NAME, version: app.getVersion()});
  registerTools(server, getMainWindow);
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
};

/** The agent app behind a request: the bridge forwards its MCP client name. */
const AGENT_HEADER = 'x-responsively-agent';
const agentOf = (req: http.IncomingMessage): string => {
  const raw = req.headers[AGENT_HEADER];
  const name = (Array.isArray(raw) ? raw[0] : (raw ?? '')).replace(/[^\x20-\x7e]/g, '').trim();
  return name.slice(0, 80) || 'unidentified client';
};
const agents = (): Record<string, boolean> =>
  (store.get('mcpAgents') as Record<string, boolean> | undefined) ?? {};

/** Agent apps seen by this window, and whether each may use it. */
export const listMcpAgents = () =>
  Object.entries(agents()).map(([name, allowed]) => ({name, allowed}));

export const setMcpAgentAllowed = (name: string, allowed: boolean) => {
  if (!Object.prototype.hasOwnProperty.call(agents(), name)) throw new Error('Unknown agent');
  store.set('mcpAgents', {...agents(), [name]: allowed});
  return listMcpAgents();
};

/** First contact registers the agent as allowed, so you can block it afterwards. */
const admitAgent = (name: string): boolean => {
  const known = agents();
  if (Object.prototype.hasOwnProperty.call(known, name)) return known[name];
  store.set('mcpAgents', {...known, [name]: true});
  const win = getMainWindowRef?.();
  if (win && !win.isDestroyed())
    win.webContents.send(IPC_MAIN_CHANNELS.MCP_AGENTS_CHANGED, listMcpAgents());
  return true;
};

const startServer = (getMainWindow: GetMainWindow, portOverride?: number): void => {
  if (httpServer !== null) {
    return;
  }
  // 0 asks the OS for a fresh port (a Session's hard reset).
  const port = portOverride ?? resolveMcpPort();
  lastError = null;

  const server = http.createServer(async (req, res) => {
    try {
      const listening = activePort ?? port;
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${listening}`);
      if (url.pathname !== '/mcp') {
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'Not found — the MCP endpoint is /mcp'}));
        return;
      }
      // Reject non-loopback Host headers to block DNS-rebinding attacks.
      if (!isAllowedHostHeader(req.headers.host, listening)) {
        res.writeHead(403, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'Forbidden'}));
        return;
      }
      const agent = agentOf(req);
      if (!admitAgent(agent)) {
        res.writeHead(403, {'Content-Type': 'application/json'});
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: `"${agent}" is not allowed to use this window. Ask the user to allow it in the MCP panel.`,
            },
            id: null,
          })
        );
        return;
      }
      await handleMcpRequest(req, res, getMainWindow);
    } catch (error) {
      log.error('[mcp] Error handling request:', error);
      if (!res.headersSent) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {code: -32603, message: 'Internal server error'},
            id: null,
          })
        );
      }
    }
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    // EADDRINUSE (e.g. a second app instance): the app must keep working
    // without MCP rather than crash.

    log.warn(
      `[mcp] MCP server not started on port ${port} (${error.code ?? error.message}). ` +
        'Another Responsively App instance may already be running.'
    );
    lastError = error.code ?? error.message;
    httpServer = null;
    activePort = null;
    notifyStatus();
  });

  server.listen(port, '127.0.0.1', () => {
    activePort = (server.address() as AddressInfo).port;
    notifyStatus();
    // The beacon is how the npm bootstrap finds a running app, so it must
    // only exist while the server is actually listening.
    writeMcpBeacon(activePort);
    log.info(`[mcp] MCP server listening on http://127.0.0.1:${activePort}/mcp`);
  });

  httpServer = server;
};

const stopServer = (): void => {
  httpServer?.closeAllConnections();
  httpServer?.close();
  httpServer = null;
  activePort = null;
};

export const getMcpServerStatus = (): McpServerStatus => {
  const port = activePort ?? resolveMcpPort();
  return {
    enabled: store.get('userPreferences.mcpEnabled') !== false,
    running: httpServer !== null && activePort !== null,
    port,
    endpoint: `http://127.0.0.1:${port}/mcp`,
    error: lastError,
  };
};

/** The window's MCP panel and Agents button follow changes made from elsewhere. */
function notifyStatus() {
  const win = getMainWindowRef?.();
  if (win && !win.isDestroyed())
    win.webContents.send(IPC_MAIN_CHANNELS.MCP_STATUS_CHANGED, getMcpServerStatus());
}

/**
 * Hard reset: drop every connection and start again. A Session gets a fresh
 * port (agents find it through the controller); the main window keeps its
 * configured port, which agent configs point at.
 */
export const hardResetMcpServer = async (): Promise<McpServerStatus> => {
  const closing = httpServer;
  httpServer = null;
  activePort = null;
  if (closing) {
    closing.closeAllConnections();
    // The same port is free only once the old socket has fully closed.
    await new Promise((resolve) => {
      closing.close(resolve);
    });
  }
  if (store.get('userPreferences.mcpEnabled') !== false && getMainWindowRef !== null) {
    startServer(getMainWindowRef, process.env.RESPONSIVELY_SESSION_ID ? 0 : undefined);
    for (let i = 0; i < 40 && activePort === null && lastError === null; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
  }
  notifyStatus();
  return getMcpServerStatus();
};

/** Turns the server on or off and remembers the choice across launches. */
export const setMcpServerEnabled = (enabled: boolean): McpServerStatus => {
  store.set('userPreferences.mcpEnabled', enabled);
  if (enabled) {
    if (getMainWindowRef !== null) {
      startServer(getMainWindowRef);
    }
  } else {
    stopServer();
  }
  notifyStatus();
  return getMcpServerStatus();
};

export const initMcpServer = (getMainWindow: GetMainWindow) => {
  initMcpBridge();
  getMainWindowRef = getMainWindow;

  if (store.get('userPreferences.mcpEnabled') !== false) {
    startServer(getMainWindow);
  } else {
    log.info('[mcp] MCP server disabled by user preference');
  }

  app.on('will-quit', () => {
    stopServer();
  });
};
