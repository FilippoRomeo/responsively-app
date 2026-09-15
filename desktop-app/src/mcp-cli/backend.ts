import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {CallToolResultSchema, ErrorCode, McpError} from '@modelcontextprotocol/sdk/types.js';
import {MCP_SERVER_NAME} from '../common/mcp';
import {launchApp} from './launch';
import {log} from './log';

export interface BackendOptions {
  port: number;
  probeTimeoutMs?: number;
  launchTimeoutMs?: number;
  pollIntervalMs?: number;
  launcher?: (port: number) => Promise<void>;
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const isTransportError = (error: unknown): boolean => {
  if (error instanceof McpError && error.code === ErrorCode.ConnectionClosed) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|network error/i.test(message);
};

const WINDOW_NOT_READY_MESSAGE =
  'The Responsively App window is not open. Open the app window and retry.';

const isWindowNotReadyResult = (result: unknown): boolean => {
  if (typeof result !== 'object' || result === null) {
    return false;
  }

  const candidate = result as {isError?: unknown; content?: unknown};

  if (candidate.isError !== true || !Array.isArray(candidate.content)) {
    return false;
  }

  return candidate.content.some((item) => {
    if (typeof item !== 'object' || item === null) {
      return false;
    }

    const block = item as {type?: unknown; text?: unknown};

    return block.type === 'text' && block.text === WINDOW_NOT_READY_MESSAGE;
  });
};

export const createBackend = (options: BackendOptions) => {
  const {
    port,
    probeTimeoutMs = 3_000,
    launchTimeoutMs = 60_000,
    pollIntervalMs = 500,
    launcher = launchApp,
  } = options;

  let cached: Client | null = null;
  let launching: Promise<Client> | null = null;
  let launchGeneration = 0;
  let lastLaunchStartedAt = 0;

  // One MCP initialize round-trip; the transport itself sends the required
  // `Accept: application/json, text/event-stream` headers on every POST.
  const connectOnce = async (): Promise<Client | null> => {
    const client = new Client({name: 'responsively-mcp-bridge', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    try {
      await withTimeout(client.connect(transport), probeTimeoutMs);
      if (client.getServerVersion()?.name !== MCP_SERVER_NAME) {
        log(`port ${port} answered MCP but is not Responsively App — ignoring it`);
        await client.close();
        return null;
      }
      return client;
    } catch {
      await client.close().catch(() => {});
      return null;
    }
  };

  const getIfRunning = async (): Promise<Client | null> => {
    if (cached !== null) {
      return cached;
    }
    cached = await connectOnce();
    return cached;
  };

  const ensure = async (): Promise<Client> => {
    const running = await getIfRunning();
    if (running !== null) {
      return running;
    }
    if (launching === null) {
      launching = (async () => {
        launchGeneration += 1;
        lastLaunchStartedAt = Date.now();
        log(`Responsively App is not running — launching it (port ${port})`);
        await launcher(port);
        const deadline = Date.now() + launchTimeoutMs;
        while (Date.now() < deadline) {
          const client = await connectOnce();
          if (client !== null) {
            cached = client;
            return client;
          }

          await sleep(pollIntervalMs);
        }
        throw new Error(
          `Launched Responsively App but 127.0.0.1:${port}/mcp did not become reachable within ` +
            `${Math.round(
              launchTimeoutMs / 1000
            )}s. Another instance may already be running on a ` +
            'different port (set RESPONSIVELY_MCP_PORT to match it), or the app may still be ' +
            'starting — retry the tool call.'
        );
      })().finally(() => {
        launching = null;
      });
    }
    return launching;
  };

  const invalidate = async (): Promise<void> => {
    const stale = cached;
    cached = null;
    await stale?.close().catch(() => {});
  };

  const callTool = async (params: unknown) => {
    const launchGenerationBeforeCall = launchGeneration;

    const attempt = async () =>
      (await ensure()).request({method: 'tools/call', params} as never, CallToolResultSchema);

    const requestWithTransportRetry = async () => {
      try {
        return await attempt();
      } catch (error) {
        if (!isTransportError(error)) {
          // A real backend answer (e.g. unknown tool) — pass through.
          throw error;
        }

        // The app quit mid-session: probe/launch again and retry once.
        await invalidate();
        return attempt();
      }
    };

    let result = await requestWithTransportRetry();

    // The HTTP MCP server starts before Electron creates its BrowserWindow.
    // Retry only the exact pre-window result, and only when this call caused
    // a launch/relaunch. No renderer command ran when this result is returned.
    if (launchGeneration !== launchGenerationBeforeCall && isWindowNotReadyResult(result)) {
      const deadline = lastLaunchStartedAt + launchTimeoutMs;

      while (isWindowNotReadyResult(result) && Date.now() < deadline) {
        await sleep(pollIntervalMs);
        result = await requestWithTransportRetry();
      }
    }

    return result;
  };

  return {getIfRunning, ensure, invalidate, callTool};
};

export type Backend = ReturnType<typeof createBackend>;
